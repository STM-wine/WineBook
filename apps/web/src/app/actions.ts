"use server";

import { revalidatePath } from "next/cache";
import { applyDiContainerRecommendations, diCapacityViolations, orderPath } from "@/lib/di-planning";
import { asNumber, formatInteger } from "@/lib/order-data";
import {
  APPROVAL_DECISIONS,
  APPROVER_NAMES,
  AVAILABILITY_STATUSES,
  CONVERSION_STATUSES,
  PLACEMENT_TYPES,
  buildOrderingWorkflowPayload,
  buildSupplierCatalogWine,
  decisionToRequestStatus,
  detectPriceChange,
  type ApprovalDecision,
  type AvailabilityStatus,
  type ConversionStatus
} from "@/lib/supplier-catalog";
import { fetchAllRecommendationsForRun } from "@/lib/supabase/recommendations";
import { createClient } from "@/lib/supabase/server";
import type { Recommendation, SupplierCatalogWine, WineRequest } from "@/lib/types";

const WRITE_ROLES = new Set(["buyer", "admin"]);
const VALID_STATUSES = new Set(["rejected", "approved", "edited", "deferred"]);
const VALID_ORDER_PATHS = new Set(["stateside", "di"]);
const ACTIVE_PO_STATUSES = ["draft", "ready_for_entry"];
const VALID_PO_STATUSES = new Set(["draft", "ready_for_entry", "entered_in_quickbooks", "cancelled"]);
const VALID_AVAILABILITY_STATUSES = new Set<string>(AVAILABILITY_STATUSES);
const VALID_CONVERSION_STATUSES = new Set<string>(CONVERSION_STATUSES);
const VALID_PLACEMENT_TYPES = new Set<string>(PLACEMENT_TYPES);
const VALID_APPROVERS = new Set<string>(APPROVER_NAMES);
const VALID_APPROVAL_DECISIONS = new Set<string>(APPROVAL_DECISIONS);
const DEFAULT_GITHUB_WORKFLOW_REPO = "STM-wine/WineBook";
const DEFAULT_GITHUB_WORKFLOW_REF = "main";
const DEFAULT_VINOSMITH_INGEST_WORKFLOW_ID = "daily-vinosmith-ingest.yml";
const REPORT_TIMEZONE = "America/Denver";

function normalizeSupplier(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function draftOrderPathFromNotes(notes: string | null | undefined) {
  return /order path:\s*(direct import|di)/i.test(notes || "") ? "di" : "stateside";
}

function draftGroupKey(supplier: string, path: "stateside" | "di") {
  return `${normalizeSupplier(supplier)}::${path}`;
}

function orderPathLabel(path: "stateside" | "di") {
  return path === "di" ? "Direct Import" : "Stateside";
}

function reportDateForTimezone(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  return `${partMap.get("year")}-${partMap.get("month")}-${partMap.get("day")}`;
}

async function requireWriteAccess() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Sign in required.");
  }

  const { data: profile } = await supabase
    .from("app_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();

  if (!profile || !WRITE_ROLES.has(profile.role)) {
    throw new Error("Buyer or admin access required.");
  }

  return { supabase, user };
}

export async function refreshVinosmithReports() {
  const { user } = await requireWriteAccess();
  const token = process.env.GITHUB_WORKFLOW_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_WORKFLOW_REPO || DEFAULT_GITHUB_WORKFLOW_REPO;
  const ref = process.env.GITHUB_WORKFLOW_REF || DEFAULT_GITHUB_WORKFLOW_REF;
  const workflowId = process.env.VINOSMITH_INGEST_WORKFLOW_ID || DEFAULT_VINOSMITH_INGEST_WORKFLOW_ID;
  const reportDate = reportDateForTimezone();

  if (!token) {
    throw new Error("Missing GITHUB_WORKFLOW_DISPATCH_TOKEN in the web app environment.");
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({
      ref,
      inputs: {
        report_date: reportDate,
        force: "true"
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub workflow dispatch failed (${response.status}): ${body || response.statusText}`);
  }

  console.info(`Vinosmith refresh requested by ${user.email || user.id} for ${reportDate}.`);

  return {
    reportDate,
    workflowUrl: `https://github.com/${repo}/actions/workflows/${workflowId}`
  };
}

export async function updateRecommendationApproval(input: {
  id: string;
  recommendationStatus: string;
  approvedQty: number;
}) {
  const recommendationStatus = input.recommendationStatus;
  const approvedQty = Math.max(0, Math.round(Number(input.approvedQty) || 0));

  if (!input.id) {
    throw new Error("Missing recommendation id.");
  }
  if (!VALID_STATUSES.has(recommendationStatus)) {
    throw new Error("Unsupported recommendation status.");
  }

  const { supabase } = await requireWriteAccess();

  const { error } = await supabase
    .from("reorder_recommendations")
    .update({
      recommendation_status: recommendationStatus,
      approved_qty: approvedQty
    })
    .eq("id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  // Order Review keeps approval state optimistically in the client. Avoid a
  // full route revalidation here so rapid checkbox work does not freeze.
}

export async function updateRecommendationApprovals(input: {
  updates: Array<{
    id: string;
    recommendationStatus: string;
    approvedQty: number;
  }>;
}) {
  const updates = input.updates
    .filter((update) => update.id)
    .map((update) => ({
      id: update.id,
      recommendationStatus: update.recommendationStatus,
      approvedQty: Math.max(0, Math.round(Number(update.approvedQty) || 0))
    }));

  if (updates.length === 0) return;

  const invalid = updates.find((update) => !VALID_STATUSES.has(update.recommendationStatus));
  if (invalid) {
    throw new Error("Unsupported recommendation status.");
  }

  const { supabase } = await requireWriteAccess();
  const results = await Promise.all(
    updates.map((update) =>
      supabase
        .from("reorder_recommendations")
        .update({
          recommendation_status: update.recommendationStatus,
          approved_qty: update.approvedQty
        })
        .eq("id", update.id)
    )
  );
  const failed = results.find((result) => result.error);

  if (failed?.error) {
    throw new Error(failed.error.message);
  }
}

export async function updateRecommendationOrderPath(input: {
  id: string;
  orderPath: "stateside" | "di";
  approvedQty?: number;
  recommendationStatus?: string;
}) {
  if (!input.id) {
    throw new Error("Missing recommendation id.");
  }
  if (!VALID_ORDER_PATHS.has(input.orderPath)) {
    throw new Error("Unsupported order path.");
  }
  if (input.recommendationStatus && !VALID_STATUSES.has(input.recommendationStatus)) {
    throw new Error("Unsupported recommendation status.");
  }

  const { supabase } = await requireWriteAccess();
  const payload: {
    order_path: "stateside" | "di";
    approved_qty?: number;
    recommendation_status?: string;
  } = { order_path: input.orderPath };

  if (input.approvedQty !== undefined) {
    payload.approved_qty = Math.max(0, Math.round(Number(input.approvedQty) || 0));
  }
  if (input.recommendationStatus) {
    payload.recommendation_status = input.recommendationStatus;
  }

  const { error } = await supabase
    .from("reorder_recommendations")
    .update(payload)
    .eq("id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

export async function createPurchaseOrderDrafts(reportRunId: string) {
  if (!reportRunId) {
    throw new Error("Missing report run id.");
  }

  const { supabase, user } = await requireWriteAccess();

  const { data: activeDrafts, error: activeDraftsError } = await supabase
    .from("purchase_order_drafts")
    .select("supplier_name,notes")
    .eq("report_run_id", reportRunId)
    .in("status", ACTIVE_PO_STATUSES);

  if (activeDraftsError) {
    throw new Error(activeDraftsError.message);
  }

  const activeDraftsBySupplierPath = new Set(
    (activeDrafts || []).map((draft) =>
      draftGroupKey(draft.supplier_name?.trim() || "Unassigned", draftOrderPathFromNotes(draft.notes))
    )
  );

  const recommendations = await fetchAllRecommendationsForRun(supabase, reportRunId);

  const poRows = applyDiContainerRecommendations(recommendations).filter(
    (row) =>
      ["approved", "edited"].includes(row.recommendation_status || "") &&
      Math.round(asNumber(row.approved_qty)) > 0
  );
  const capacityViolations = diCapacityViolations(poRows);
  if (capacityViolations.length > 0) {
    throw new Error(
      capacityViolations
        .map(
          (violation) =>
            `Unable to submit ${violation.containerGroup} / ${violation.originPort}: ${formatInteger(violation.totalBottles)} bottles exceeds ${formatInteger(violation.capacityBottles)} bottle container capacity by ${formatInteger(violation.overByBottles)}.`
        )
        .join(" ")
    );
  }

  const grouped = new Map<string, { supplier: string; orderPath: "stateside" | "di"; rows: Recommendation[] }>();
  for (const row of poRows) {
    const supplier = row.supplier_name?.trim() || "Unassigned";
    const path = orderPath(row);
    const key = draftGroupKey(supplier, path);
    if (activeDraftsBySupplierPath.has(key)) continue;
    const group = grouped.get(key) || { supplier, orderPath: path, rows: [] };
    group.rows.push(row);
    grouped.set(key, group);
  }

  const created: string[] = [];
  const skipped = Array.from(activeDraftsBySupplierPath).map((key) => `${key}: active draft already exists`);
  const errors: string[] = [];

  for (const { supplier, orderPath: path, rows } of grouped.values()) {
    const { data: draft, error: draftError } = await supabase
      .from("purchase_order_drafts")
      .insert({
        supplier_name: supplier,
        report_run_id: reportRunId,
        status: "draft",
        notes: `Created from global PO Drafts action. Order path: ${orderPathLabel(path)}.`,
        created_by: user.id
      })
      .select("id")
      .single<{ id: string }>();

    if (draftError || !draft) {
      errors.push(`${supplier}: ${draftError?.message || "Could not create draft."}`);
      continue;
    }

    const linePayloads = rows.map((row) => {
      const approvedQty = Math.max(0, Math.round(asNumber(row.approved_qty)));
      const recommendedQty = Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)));
      const fob = asNumber(row.fob);
      const trucking = asNumber(row.trucking_cost_per_bottle);
      const wineCost = fob * approvedQty;
      const laidInCost = trucking * approvedQty;

      return {
        purchase_order_draft_id: draft.id,
        recommendation_id: row.id,
        product_name: row.product_name,
        product_code: row.product_code,
        planning_sku: row.planning_sku,
        recommended_qty: recommendedQty,
        approved_qty: approvedQty,
        fob,
        trucking_cost_per_bottle: trucking,
        wine_cost: wineCost,
        laid_in_cost: laidInCost,
        landed_cost: wineCost + laidInCost,
        line_cost: wineCost
      };
    });

    const { error: linesError } = await supabase.from("purchase_order_lines").insert(linePayloads);
    if (linesError) {
      errors.push(`${supplier}: ${linesError.message}`);
      continue;
    }

    created.push(`${supplier} (${orderPathLabel(path)})`);
  }

  revalidatePath("/");
  return { created, skipped, errors };
}

export async function updatePurchaseOrderDraftStatus(input: { id: string; status: string }) {
  if (!input.id) {
    throw new Error("Missing PO draft id.");
  }
  if (!VALID_PO_STATUSES.has(input.status)) {
    throw new Error("Unsupported PO draft status.");
  }

  const { supabase, user } = await requireWriteAccess();
  const { error } = await supabase
    .from("purchase_order_drafts")
    .update({
      status: input.status,
      reviewed_by: user.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

export async function deletePurchaseOrderLine(input: { id: string; draftId: string }) {
  if (!input.id) {
    throw new Error("Missing PO line id.");
  }
  if (!input.draftId) {
    throw new Error("Missing PO draft id.");
  }

  const { supabase, user } = await requireWriteAccess();
  const { error } = await supabase.from("purchase_order_lines").delete().eq("id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  await supabase
    .from("purchase_order_drafts")
    .update({
      reviewed_by: user.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.draftId);

  revalidatePath("/");
}

export async function saveSupplierLogistics(input: {
  id?: string;
  name: string;
  importerId?: string;
  etaDays?: number;
  pickUpLocation?: string;
  freightForwarder?: string;
  orderFrequency?: string;
  tdm?: string;
  truckingCostPerBottle?: number;
  notes?: string;
  active?: boolean;
}) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Supplier name is required.");
  }

  const { supabase } = await requireWriteAccess();
  const payload = {
    name,
    importer_id: input.importerId?.trim() || null,
    eta_days: Math.max(0, Math.round(Number(input.etaDays) || 0)),
    pick_up_location: input.pickUpLocation?.trim() || null,
    freight_forwarder: input.freightForwarder?.trim() || null,
    order_frequency: input.orderFrequency?.trim() || null,
    tdm: input.tdm?.trim() || null,
    trucking_cost_per_bottle: Math.max(0, Number(input.truckingCostPerBottle) || 0),
    notes: input.notes?.trim() || null,
    active: input.active ?? true,
    updated_at: new Date().toISOString()
  };

  const query = input.id
    ? supabase.from("suppliers").update(payload).eq("id", input.id)
    : supabase.from("suppliers").insert(payload);

  const { error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

export async function saveSupplierCatalogWine(input: {
  supplierId?: string | null;
  supplierName: string;
  producer: string;
  wineName: string;
  vintage?: string;
  packSize?: number;
  bottleSize?: string;
  fobBottle?: number | null;
  fobCase?: number | null;
  laidInPerBottle?: number | null;
  frontlineOverride?: number | null;
  bestPriceOverride?: number | null;
  availabilityStatus?: string;
  conversionStatus?: string;
  priceChangeReason?: string;
}) {
  if (!input.producer.trim()) {
    throw new Error("Producer is required.");
  }
  if (!input.wineName.trim()) {
    throw new Error("Wine / fantasy name is required.");
  }
  if (Number(input.packSize || 12) < 1) {
    throw new Error("Pack size must be at least 1.");
  }
  for (const [label, value] of [
    ["Bottle FOB", input.fobBottle],
    ["Case FOB", input.fobCase],
    ["Laid-in per bottle", input.laidInPerBottle],
    ["Frontline override", input.frontlineOverride],
    ["Best price override", input.bestPriceOverride]
  ] as const) {
    if (value !== null && value !== undefined && Number(value) < 0) {
      throw new Error(`${label} cannot be negative.`);
    }
  }

  const availabilityStatus = input.availabilityStatus || "available";
  const conversionStatus = input.conversionStatus || "net_new_product";
  if (!VALID_AVAILABILITY_STATUSES.has(availabilityStatus)) {
    throw new Error("Unsupported availability status.");
  }
  if (!VALID_CONVERSION_STATUSES.has(conversionStatus)) {
    throw new Error("Unsupported conversion status.");
  }

  const { supabase } = await requireWriteAccess();
  const payload = buildSupplierCatalogWine({
    supplierId: input.supplierId || null,
    supplierName: input.supplierName,
    producer: input.producer,
    wineName: input.wineName,
    vintage: input.vintage || "NV",
    packSize: input.packSize || 12,
    bottleSize: input.bottleSize || "750ml",
    fobBottle: input.fobBottle,
    fobCase: input.fobCase,
    laidInPerBottle: input.laidInPerBottle,
    frontlineOverride: input.frontlineOverride,
    bestPriceOverride: input.bestPriceOverride,
    availabilityStatus: availabilityStatus as AvailabilityStatus,
    conversionStatus: conversionStatus as ConversionStatus,
    priceChangeReason: input.priceChangeReason
  });

  const { data: existing, error: existingError } = await supabase
    .from("supplier_catalog_wines")
    .select("*")
    .eq("planning_sku", payload.planning_sku)
    .maybeSingle<SupplierCatalogWine>();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const now = new Date().toISOString();
  const writePayload = {
    ...payload,
    quickbooks_item_id: existing?.quickbooks_item_id || null,
    quickbooks_item_name: existing?.quickbooks_item_name || null,
    quickbooks_sync_status: existing?.quickbooks_sync_status === "linked" ? "linked" : payload.quickbooks_sync_status,
    product_lifecycle_status:
      existing?.product_lifecycle_status === "active_product" ? "active_product" : payload.product_lifecycle_status,
    updated_at: now
  };

  const savedQuery = existing
    ? supabase.from("supplier_catalog_wines").update(writePayload).eq("id", existing.id).select("*").single<SupplierCatalogWine>()
    : supabase.from("supplier_catalog_wines").insert(writePayload).select("*").single<SupplierCatalogWine>();
  const { data: saved, error: saveError } = await savedQuery;

  if (saveError || !saved) {
    throw new Error(saveError?.message || "Could not save supplier wine.");
  }

  const event = detectPriceChange(existing || null, saved, input.priceChangeReason || "Manual catalog update");
  if (event) {
    const { error: eventError } = await supabase.from("price_change_events").insert(event);
    if (eventError) {
      throw new Error(eventError.message);
    }
  }

  revalidatePath("/");
  return {
    mode: existing ? "updated" : "created",
    displayName: saved.display_name,
    planningSku: saved.planning_sku,
    priceChangeCreated: Boolean(event)
  };
}

export async function createSupplierWineRequest(input: {
  sourceType: "net_new_wine" | "supplier_available_wine";
  supplierCatalogWineId?: string | null;
  supplierName: string;
  wineDisplayName: string;
  accountCustomer: string;
  requestedQuantity: number;
  neededByDate?: string | null;
  placementType: string;
  requesterName: string;
  notes?: string;
}) {
  if (!input.accountCustomer.trim()) {
    throw new Error("Account/customer is required.");
  }
  if (!input.wineDisplayName.trim()) {
    throw new Error("Wine is required.");
  }
  if (!VALID_PLACEMENT_TYPES.has(input.placementType)) {
    throw new Error("Select a valid placement type.");
  }
  if (input.placementType === "Other" && !input.notes?.trim()) {
    throw new Error("Notes are required when placement is Other.");
  }
  const requestedQuantity = Math.max(0, Math.round(Number(input.requestedQuantity) || 0));
  if (requestedQuantity <= 0) {
    throw new Error("Requested quantity must be greater than zero.");
  }

  const { supabase } = await requireWriteAccess();
  const requestId = `REQ-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const { error } = await supabase.from("wine_requests").insert({
    request_id: requestId,
    account_customer: input.accountCustomer.trim(),
    requested_quantity: requestedQuantity,
    needed_by_date: input.neededByDate || null,
    placement_type: input.placementType,
    source_type: input.sourceType,
    supplier_catalog_wine_id: input.sourceType === "supplier_available_wine" ? input.supplierCatalogWineId || null : null,
    wine_display_name: input.wineDisplayName.trim(),
    supplier_name: input.supplierName.trim(),
    requester_name: input.requesterName.trim(),
    notes: input.notes?.trim() || null,
    request_status: "pending_review",
    fulfillment_status: "waiting_for_next_order",
    ordering_workflow_payload: {}
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
  return { requestId };
}

export async function updateSupplierWineRequestApproval(input: {
  id: string;
  approverName: string;
  approvalDecision: string;
}) {
  if (!input.id) {
    throw new Error("Missing request id.");
  }
  if (!VALID_APPROVERS.has(input.approverName)) {
    throw new Error("Only Mark, Ryan, or John can approve Supplier Hub requests in the MVP.");
  }
  if (!VALID_APPROVAL_DECISIONS.has(input.approvalDecision)) {
    throw new Error("Unsupported approval decision.");
  }

  const { supabase } = await requireWriteAccess();
  const { data: request, error: requestError } = await supabase
    .from("wine_requests")
    .select("*")
    .eq("id", input.id)
    .single<WineRequest>();

  if (requestError || !request) {
    throw new Error(requestError?.message || "Request not found.");
  }

  const requestStatus = decisionToRequestStatus(input.approvalDecision as ApprovalDecision);
  const fulfillmentStatus = requestStatus === "approved" ? "waiting_for_next_order" : request.fulfillment_status;
  const orderingPayload =
    requestStatus === "approved"
      ? buildOrderingWorkflowPayload({ ...request, fulfillment_status: fulfillmentStatus })
      : request.ordering_workflow_payload || {};

  const { error } = await supabase
    .from("wine_requests")
    .update({
      request_status: requestStatus,
      fulfillment_status: fulfillmentStatus,
      approval_decision: input.approvalDecision,
      approver_name: input.approverName,
      ordering_workflow_payload: orderingPayload,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}
