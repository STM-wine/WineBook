"use server";

import { revalidatePath } from "next/cache";
import { asNumber } from "@/lib/order-data";
import { isValidPoStatus } from "@/lib/po-status";
import {
  APPROVAL_DECISIONS,
  APPROVER_NAMES,
  AVAILABILITY_STATUSES,
  CONVERSION_STATUSES,
  PLACEMENT_TYPES,
  SYSTEM_TAGS,
  buildOrderingWorkflowPayload,
  buildSupplierCatalogWine,
  decisionToRequestStatus,
  detectPriceChange,
  type ApprovalDecision,
  type AvailabilityStatus,
  type ConversionStatus
} from "@/lib/supplier-catalog";
import { createClient } from "@/lib/supabase/server";
import type { SupplierCatalogWine, WineRequest } from "@/lib/types";

const WRITE_ROLES = new Set(["buyer", "admin"]);
const VALID_STATUSES = new Set(["rejected", "approved", "edited", "deferred"]);
const VALID_ORDER_PATHS = new Set(["stateside", "di"]);
const VALID_AVAILABILITY_STATUSES = new Set<string>(AVAILABILITY_STATUSES);
const VALID_CONVERSION_STATUSES = new Set<string>(CONVERSION_STATUSES);
const VALID_SYSTEM_TAGS = new Set<string>(SYSTEM_TAGS);
const VALID_PLACEMENT_TYPES = new Set<string>(PLACEMENT_TYPES);
const VALID_APPROVERS = new Set<string>(APPROVER_NAMES);
const VALID_APPROVAL_DECISIONS = new Set<string>(APPROVAL_DECISIONS);
const DEFAULT_GITHUB_WORKFLOW_REPO = "STM-wine/WineBook";
const DEFAULT_GITHUB_WORKFLOW_REF = "main";
const DEFAULT_VINOSMITH_INGEST_WORKFLOW_ID = "daily-vinosmith-ingest.yml";
const REPORT_TIMEZONE = "America/Denver";

type RefreshVinosmithReportsResult =
  | {
      ok: true;
      reportDate: string;
      workflowUrl: string;
    }
  | {
      ok: false;
      error: string;
    };

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

export async function refreshVinosmithReports(): Promise<RefreshVinosmithReportsResult> {
  try {
    const { user } = await requireWriteAccess();
    const token = process.env.GITHUB_WORKFLOW_DISPATCH_TOKEN;
    const repo = process.env.GITHUB_WORKFLOW_REPO || DEFAULT_GITHUB_WORKFLOW_REPO;
    const ref = process.env.GITHUB_WORKFLOW_REF || DEFAULT_GITHUB_WORKFLOW_REF;
    const workflowId = process.env.VINOSMITH_INGEST_WORKFLOW_ID || DEFAULT_VINOSMITH_INGEST_WORKFLOW_ID;
    const reportDate = reportDateForTimezone();

    if (!token) {
      return {
        ok: false,
        error: "Report refresh is not configured yet. Add GITHUB_WORKFLOW_DISPATCH_TOKEN in Render, then redeploy."
      };
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
      console.error("GitHub workflow dispatch failed.", {
        status: response.status,
        statusText: response.statusText,
        body
      });
      return {
        ok: false,
        error:
          response.status === 401 || response.status === 403
            ? "GitHub rejected the refresh request. Check that GITHUB_WORKFLOW_DISPATCH_TOKEN has Actions write access."
            : `GitHub could not queue the refresh request (${response.status}). Check the workflow configuration.`
      };
    }

    console.info(`Vinosmith refresh requested by ${user.email || user.id} for ${reportDate}.`);

    return {
      ok: true,
      reportDate,
      workflowUrl: `https://github.com/${repo}/actions/workflows/${workflowId}`
    };
  } catch (error) {
    console.error("Vinosmith refresh request failed.", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not queue Vinosmith report refresh."
    };
  }
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

export async function updatePurchaseOrderDraftStatus(input: { id: string; status: string }) {
  if (!input.id) {
    throw new Error("Missing PO draft id.");
  }
  if (!isValidPoStatus(input.status)) {
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
  systemTags?: string[];
  copiedFromSupplierCatalogWineId?: string | null;
  quickbooksItemNumber?: string | null;
  sourceSystem?: string | null;
  sourceId?: string | null;
  priceLevels?: Array<{
    id?: string;
    name: string;
    bottlePrice?: number | null;
    depletionAllowance?: number | null;
    targetGpMargin?: number | null;
    calculatedGpMargin?: number | null;
    isFrontline?: boolean;
    isBest?: boolean;
    displayOrder?: number;
    active?: boolean;
    sourceSystem?: string | null;
    sourceId?: string | null;
  }>;
  freeGoods?: Array<{
    id?: string;
    buyQuantity?: number | null;
    freeQuantity?: number | null;
    unit?: "bottle" | "case";
    programName?: string | null;
    startsOn?: string | null;
    endsOn?: string | null;
    notes?: string | null;
    active?: boolean;
  }>;
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
  const invalidTag = (input.systemTags || []).find((tag) => !VALID_SYSTEM_TAGS.has(tag));
  if (invalidTag) {
    throw new Error(`Unsupported system tag: ${invalidTag}.`);
  }
  const invalidPriceLevel = (input.priceLevels || []).find(
    (level) => Number(level.bottlePrice || 0) < 0 || Number(level.depletionAllowance || 0) < 0
  );
  if (invalidPriceLevel) {
    throw new Error("Price levels cannot have negative prices or depletion allowances.");
  }
  const invalidFreeGood = (input.freeGoods || []).find(
    (freeGood) => Number(freeGood.buyQuantity || 0) < 0 || Number(freeGood.freeQuantity || 0) < 0
  );
  if (invalidFreeGood) {
    throw new Error("Free goods quantities cannot be negative.");
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
    systemTags: input.systemTags || [],
    copiedFromSupplierCatalogWineId: input.copiedFromSupplierCatalogWineId || null,
    quickbooksItemNumber: input.quickbooksItemNumber || null,
    sourceSystem: input.sourceSystem || null,
    sourceId: input.sourceId || null,
    priceLevels: input.priceLevels,
    freeGoods: input.freeGoods,
    availabilityStatus: availabilityStatus as AvailabilityStatus,
    conversionStatus: conversionStatus as ConversionStatus,
    priceChangeReason: input.priceChangeReason
  });

  const { data: latestRun, error: latestRunError } = await supabase
    .from("report_runs")
    .select("id")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (latestRunError) {
    throw new Error(latestRunError.message);
  }

  const { price_levels: payloadPriceLevels, free_goods: payloadFreeGoods, ...rpcPayload } = payload;
  const priceLevels = (payloadPriceLevels || []).map((level) => ({
    name: level.name,
    bottle_price: level.bottle_price,
    depletion_allowance: level.depletion_allowance,
    target_gp_margin: level.target_gp_margin,
    calculated_gp_margin: level.calculated_gp_margin,
    is_frontline: level.is_frontline,
    is_best: level.is_best,
    display_order: level.display_order,
    active: level.active,
    source_system: level.source_system,
    source_id: level.source_id
  }));
  const freeGoods = (payloadFreeGoods || []).map((freeGood) => ({
    buy_quantity: freeGood.buy_quantity,
    free_quantity: freeGood.free_quantity,
    unit: freeGood.unit,
    program_name: freeGood.program_name,
    starts_on: freeGood.starts_on,
    ends_on: freeGood.ends_on,
    notes: freeGood.notes,
    active: freeGood.active
  }));

  const { data: saveResult, error: saveError } = await supabase.rpc("save_supplier_catalog_sku", {
    p_catalog: rpcPayload,
    p_price_levels: priceLevels,
    p_free_goods: freeGoods,
    p_report_run_id: latestRun?.id || null
  });

  if (saveError || !saveResult) {
    throw new Error(saveError?.message || "Could not save supplier wine.");
  }

  const result = saveResult as {
    mode: "created" | "updated";
    saved: SupplierCatalogWine;
    previous: SupplierCatalogWine | null;
  };
  const saved = result.saved;
  const existing = result.previous;

  const event = detectPriceChange(existing || null, saved, input.priceChangeReason || "Manual catalog update");
  if (event) {
    const { error: eventError } = await supabase.from("price_change_events").insert(event);
    if (eventError) {
      throw new Error(eventError.message);
    }
  }

  revalidatePath("/");
  return {
    mode: result.mode,
    displayName: saved.display_name,
    planningSku: saved.planning_sku,
    priceChangeCreated: Boolean(event)
  };
}

export async function updateSupplierCatalogWorkbenchItems(input: {
  updates: Array<{
    id?: string | null;
    reportRunId: string;
    supplierCatalogWineId: string;
    recommendationStatus?: string;
    approvedQty?: number;
    recommendedQty?: number;
    orderPath?: "stateside" | "di";
  }>;
}) {
  const updates = input.updates.filter((update) => update.supplierCatalogWineId && update.reportRunId);
  if (updates.length === 0) return;

  for (const update of updates) {
    if (update.recommendationStatus && !VALID_STATUSES.has(update.recommendationStatus)) {
      throw new Error("Unsupported recommendation status.");
    }
    if (update.orderPath && !VALID_ORDER_PATHS.has(update.orderPath)) {
      throw new Error("Unsupported order path.");
    }
  }

  const { supabase, user } = await requireWriteAccess();
  const results = await Promise.all(
    updates.map((update) => {
      const payload = {
        report_run_id: update.reportRunId,
        supplier_catalog_wine_id: update.supplierCatalogWineId,
        ...(update.recommendationStatus ? { recommendation_status: update.recommendationStatus } : {}),
        ...(update.approvedQty !== undefined ? { approved_qty: Math.max(0, Math.round(Number(update.approvedQty) || 0)) } : {}),
        ...(update.recommendedQty !== undefined ? { recommended_qty: Math.max(0, Math.round(Number(update.recommendedQty) || 0)) } : {}),
        ...(update.orderPath ? { order_path: update.orderPath } : {}),
        active: true,
        created_by: user.id,
        updated_at: new Date().toISOString()
      };

      return supabase
        .from("supplier_catalog_workbench_items")
        .upsert(payload, { onConflict: "report_run_id,supplier_catalog_wine_id" });
    })
  );
  const failed = results.find((result) => result.error);

  if (failed?.error) {
    throw new Error(failed.error.message);
  }

  revalidatePath("/");
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
