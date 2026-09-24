"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { asNumber } from "@/lib/order-data";
import { isValidPoStatus } from "@/lib/po-status";
import {
  APPROVAL_DECISIONS,
  APPROVER_NAMES,
  AVAILABILITY_STATUSES,
  CONVERSION_STATUSES,
  PLACEMENT_TYPES,
  SYSTEM_TAGS,
  buildPlanningSku,
  buildOrderingWorkflowPayload,
  buildSupplierCatalogWine,
  decisionToRequestStatus,
  hasOfficialQuickBooksProduct,
  MINIMUM_GP_MARGIN,
  type ApprovalDecision,
  type AvailabilityStatus,
  type ConversionStatus
} from "@/lib/supplier-catalog";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  quickBooksItemCode,
  quickBooksItemDisplayName,
  quickBooksPackFormat,
  quickBooksPreferredVendorListId,
  quickBooksProducer,
  quickBooksVintage,
  type QuickBooksItemIdentityRow
} from "@/lib/quickbooks-item-fields";
import type {
  ApprovalSaveResult,
  PurchaseOrderLineNote,
  QuickBooksVendorClassification,
  SupplierCatalogWine,
  WineRequest
} from "@/lib/types";
import { createSourceBackedOrderingRun } from "@/lib/source-backed-ordering-runs";

const WRITE_ROLES = new Set(["buyer", "admin"]);
const VALID_STATUSES = new Set(["rejected", "approved", "edited", "deferred"]);
const VALID_ORDER_PATHS = new Set(["stateside", "di"]);
const VALID_AVAILABILITY_STATUSES = new Set<string>(AVAILABILITY_STATUSES);
const VALID_CONVERSION_STATUSES = new Set<string>(CONVERSION_STATUSES);
const VALID_SYSTEM_TAGS = new Set<string>([...SYSTEM_TAGS, "Select"]);
const VALID_PLACEMENT_TYPES = new Set<string>(PLACEMENT_TYPES);
const VALID_APPROVERS = new Set<string>(APPROVER_NAMES);
const VALID_APPROVAL_DECISIONS = new Set<string>(APPROVAL_DECISIONS);
const VALID_VENDOR_CLASSIFICATIONS = new Set<QuickBooksVendorClassification>([
  "unclassified",
  "inventory_wine",
  "freight_logistics",
  "service_expense",
  "other"
]);
const DEFAULT_GITHUB_WORKFLOW_REPO = "STM-wine/WineBook";
const DEFAULT_GITHUB_WORKFLOW_REF = "main";
const DEFAULT_VINOSMITH_INGEST_WORKFLOW_ID = "daily-vinosmith-ingest.yml";
const REPORT_TIMEZONE = "America/Denver";

function revalidateDashboardData() {
  revalidateTag(CACHE_TAGS.dashboard);
}

function revalidateSupplierData() {
  revalidateTag(CACHE_TAGS.suppliers);
  revalidateTag(CACHE_TAGS.dashboard);
}

function revalidateSupplierCatalogData() {
  revalidateTag(CACHE_TAGS.supplierCatalog);
  revalidateTag(CACHE_TAGS.dashboard);
}

function revalidateQuickBooksVendorData() {
  revalidateTag(CACHE_TAGS.quickBooksVendors);
  revalidateTag(CACHE_TAGS.quickBooksVendorMappings);
  revalidateTag(CACHE_TAGS.dashboard);
}

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

type RefreshOrderingDataResult =
  | { ok: true; reportDate: string; rowCount: number; reused: boolean; diagnostics: Record<string, unknown> }
  | { ok: false; error: string };

function reportDateForTimezone(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
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

export async function refreshOrderingData(): Promise<RefreshOrderingDataResult> {
  try {
    const { user } = await requireWriteAccess();
    const result = await createSourceBackedOrderingRun(createServiceRoleClient(), user.id);
    revalidateDashboardData();

    return {
      ok: true,
      reportDate: result.run.report_date || "current",
      rowCount: result.rowCount,
      reused: result.reused,
      diagnostics: result.diagnostics
    };
  } catch (error) {
    console.error("Source-backed ordering refresh failed.", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not generate ordering data."
    };
  }
}

export async function refreshOrderingDataFromForm() {
  const result = await refreshOrderingData();
  if (!result.ok) throw new Error(result.error);
}

export async function refreshVinosmithReports(): Promise<RefreshVinosmithReportsResult> {
  try {
    await requireWriteAccess();
    const token = process.env.GITHUB_WORKFLOW_DISPATCH_TOKEN;
    const repo = process.env.GITHUB_WORKFLOW_REPO || DEFAULT_GITHUB_WORKFLOW_REPO;
    const ref = process.env.GITHUB_WORKFLOW_REF || DEFAULT_GITHUB_WORKFLOW_REF;
    const workflowId = process.env.VINOSMITH_INGEST_WORKFLOW_ID || DEFAULT_VINOSMITH_INGEST_WORKFLOW_ID;
    const reportDate = reportDateForTimezone();
    if (!token) return { ok: false, error: "Legacy report refresh is not configured." };
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref, inputs: { report_date: reportDate, force: "true" } })
    });
    if (!response.ok) return { ok: false, error: `GitHub could not queue the legacy report refresh (${response.status}).` };
    return { ok: true, reportDate, workflowUrl: `https://github.com/${repo}/actions/workflows/${workflowId}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not queue legacy report refresh." };
  }
}

export async function updateRecommendationApproval(input: {
  id: string;
  recommendationStatus: string;
  approvedQty: number;
  expectedLockVersion: number;
}): Promise<ApprovalSaveResult> {
  return updateRecommendationApprovals({
    updates: [{ ...input, sourceType: "recommendation" }]
  });
}

export async function updateRecommendationApprovals(input: {
  updates: Array<{
    sourceType?: "recommendation" | "catalog_workbench";
    id?: string | null;
    reportRunId?: string;
    supplierCatalogWineId?: string;
    recommendationStatus: string;
    approvedQty: number;
    expectedLockVersion: number;
    recommendedQty?: number;
    orderPath?: "stateside" | "di";
  }>;
}): Promise<ApprovalSaveResult> {
  const updates = input.updates
    .filter((update) => update.id || update.supplierCatalogWineId)
    .map((update) => ({
      sourceType: update.sourceType || "recommendation",
      id: update.id || null,
      reportRunId: update.reportRunId,
      supplierCatalogWineId: update.supplierCatalogWineId,
      recommendationStatus: update.recommendationStatus,
      approvedQty: Math.max(0, Math.round(Number(update.approvedQty) || 0)),
      expectedLockVersion: Math.max(0, Math.round(Number(update.expectedLockVersion) || 0)),
      recommendedQty: update.recommendedQty === undefined
        ? undefined
        : Math.max(0, Math.round(Number(update.recommendedQty) || 0)),
      orderPath: update.orderPath
    }));

  if (updates.length === 0) return { ok: true, saved: [], conflicts: [] };

  const invalid = updates.find((update) => !VALID_STATUSES.has(update.recommendationStatus));
  if (invalid) {
    throw new Error("Unsupported recommendation status.");
  }
  const invalidSource = updates.find((update) =>
    update.sourceType === "catalog_workbench" && (!update.reportRunId || !update.supplierCatalogWineId)
  );
  if (invalidSource) throw new Error("Catalog workbench approval is missing its report run or wine id.");

  const { supabase } = await requireWriteAccess();
  const { data, error } = await supabase.rpc("save_order_approvals", { p_updates: updates });
  if (error) throw new Error(error.message);

  revalidateDashboardData();
  return (data || { ok: true, saved: [], conflicts: [] }) as ApprovalSaveResult;
}

export async function updateRecommendationOrderPath(input: {
  id: string;
  orderPath: "stateside" | "di";
  approvedQty: number;
  recommendationStatus: string;
  expectedLockVersion: number;
}) {
  if (!input.id) {
    throw new Error("Missing recommendation id.");
  }
  if (!VALID_ORDER_PATHS.has(input.orderPath)) {
    throw new Error("Unsupported order path.");
  }
  if (!VALID_STATUSES.has(input.recommendationStatus)) {
    throw new Error("Unsupported recommendation status.");
  }

  const result = await updateRecommendationApprovals({
    updates: [{
      sourceType: "recommendation",
      id: input.id,
      recommendationStatus: input.recommendationStatus,
      approvedQty: input.approvedQty,
      expectedLockVersion: input.expectedLockVersion,
      orderPath: input.orderPath
    }]
  });
  return result;
}

export async function updatePurchaseOrderDraftStatus(input: { id: string; status: string }) {
  if (!input.id) {
    throw new Error("Missing PO draft id.");
  }
  if (!isValidPoStatus(input.status)) {
    throw new Error("Unsupported PO draft status.");
  }

  const { supabase } = await requireWriteAccess();
  const { error } = await supabase.rpc("set_purchase_order_draft_status", {
    p_draft_id: input.id,
    p_status: input.status
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidateDashboardData();
  revalidatePath("/");
}

export async function cancelPurchaseOrderDrafts(input: { ids: string[] }) {
  const ids = Array.from(new Set(input.ids.filter(Boolean)));
  if (ids.length === 0) return { cancelled: 0 };
  if (ids.length > 500) throw new Error("Too many PO drafts selected.");

  const { supabase } = await requireWriteAccess();
  const results = await Promise.all(ids.map((id) => supabase.rpc("set_purchase_order_draft_status", {
    p_draft_id: id,
    p_status: "cancelled"
  })));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  revalidateDashboardData();
  revalidatePath("/");
  return { cancelled: results.length };
}

export async function addPurchaseOrderLineNote(input: { lineId: string; body: string }): Promise<PurchaseOrderLineNote> {
  const lineId = input.lineId?.trim();
  const body = input.body?.trim();
  if (!lineId) throw new Error("Missing PO line id.");
  if (!body) throw new Error("Write a note before saving.");
  if (body.length > 2000) throw new Error("PO line notes are limited to 2,000 characters.");

  const { supabase } = await requireWriteAccess();
  const { data, error } = await supabase.rpc("add_purchase_order_line_note", {
    p_line_id: lineId,
    p_body: body
  });
  if (error) throw new Error(error.message);

  const note = (Array.isArray(data) ? data[0] : data) as PurchaseOrderLineNote | null;
  if (!note?.id) throw new Error("The note was not saved.");
  revalidateDashboardData();
  return note;
}

export async function deletePurchaseOrderLine(input: { id: string; draftId: string }) {
  if (!input.id) {
    throw new Error("Missing PO line id.");
  }
  if (!input.draftId) {
    throw new Error("Missing PO draft id.");
  }

  const { supabase } = await requireWriteAccess();
  const { error } = await supabase.rpc("delete_purchase_order_line_revisioned", { p_line_id: input.id });

  if (error) {
    throw new Error(error.message);
  }

  revalidateDashboardData();
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
  const payload = supplierLogisticsPayload(input);

  const query = input.id
    ? supabase.from("suppliers").update(payload).eq("id", input.id)
    : supabase.from("suppliers").insert(payload);

  const { error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  if (input.id) {
    const { error: catalogError } = await supabase
      .from("supplier_catalog_wines")
      .update({ supplier_name: name, updated_at: new Date().toISOString() })
      .eq("supplier_id", input.id)
      .neq("supplier_name", name);
    if (catalogError) throw new Error(catalogError.message);
  }

  revalidateSupplierData();
  revalidatePath("/");
}

function supplierLogisticsPayload(input: {
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

  return {
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
}

export async function saveSupplierLogisticsBatch(input: {
  suppliers: Array<{
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
  }>;
}) {
  const suppliers = input.suppliers
    .map((supplier) => ({
      ...supplier,
      id: supplier.id?.startsWith("new-") ? undefined : supplier.id,
      name: supplier.name.trim()
    }))
    .filter((supplier) => supplier.name);

  if (suppliers.length === 0) {
    throw new Error("No supplier logistics changes are ready to save.");
  }

  const { supabase } = await requireWriteAccess();
  const results = await Promise.all(
    suppliers.map((supplier) => {
      const payload = supplierLogisticsPayload(supplier);
      return supplier.id
        ? supabase.from("suppliers").update(payload).eq("id", supplier.id)
        : supabase.from("suppliers").insert(payload);
    })
  );
  const failed = results.find((result) => result.error);

  if (failed?.error) {
    throw new Error(failed.error.message);
  }

  const catalogNameUpdates = await Promise.all(
    suppliers
      .filter((supplier): supplier is typeof supplier & { id: string } => Boolean(supplier.id))
      .map((supplier) => supabase
        .from("supplier_catalog_wines")
        .update({ supplier_name: supplier.name, updated_at: new Date().toISOString() })
        .eq("supplier_id", supplier.id)
        .neq("supplier_name", supplier.name))
  );
  const failedCatalogUpdate = catalogNameUpdates.find((result) => result.error);
  if (failedCatalogUpdate?.error) throw new Error(failedCatalogUpdate.error.message);

  revalidateSupplierData();
  revalidatePath("/");
  return { saved: suppliers.length };
}

export async function saveQuickBooksVendorMappings(input: {
  mappings: Array<{
    quickBooksVendorListId: string;
    supplierId?: string | null;
    vendorClassification: QuickBooksVendorClassification;
    notes?: string | null;
  }>;
}) {
  const mappings = input.mappings
    .map((mapping) => ({
      quickbooks_vendor_list_id: mapping.quickBooksVendorListId.trim(),
      supplier_id: mapping.supplierId?.trim() || null,
      vendor_classification: mapping.vendorClassification,
      notes: mapping.notes?.trim() || null
    }))
    .filter((mapping) => mapping.quickbooks_vendor_list_id);

  if (mappings.length === 0) {
    throw new Error("No vendor classification changes are ready to save.");
  }

  const invalid = mappings.find((mapping) => !VALID_VENDOR_CLASSIFICATIONS.has(mapping.vendor_classification));
  if (invalid) {
    throw new Error("Unsupported vendor classification.");
  }

  const { supabase, user } = await requireWriteAccess();
  const now = new Date().toISOString();
  const { error } = await supabase.from("quickbooks_vendor_mappings").upsert(
    mappings.map((mapping) => ({
      ...mapping,
      updated_by: user.id,
      updated_at: now
    })),
    { onConflict: "quickbooks_vendor_list_id" }
  );

  if (error) {
    throw new Error(error.message);
  }

  revalidateQuickBooksVendorData();
  revalidateTag(CACHE_TAGS.suppliers);
  revalidatePath("/");
  revalidatePath("/settings/qb-vendors");
  return { saved: mappings.length };
}

export async function saveSupplierCatalogWine(input: {
  existingCatalogWineId?: string | null;
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
  quickbooksItemId?: string | null;
  quickbooksItemName?: string | null;
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
    solveFor?: "price" | "da" | "gp";
    approvalDecision?: "approve_price" | "pursue_da" | "revise" | "hold" | "no_change" | null;
    overrideReason?: string | null;
    approvalOwner?: string | null;
    decisionTimestamp?: string | null;
    suggestedPrice?: number | null;
    suggestedGpMargin?: number | null;
    daAlternative?: number | null;
    finalApprovedPrice?: number | null;
    finalApprovedDa?: number | null;
    finalGpMargin?: number | null;
    isManualOverride?: boolean;
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
    extensionMetadata?: Record<string, unknown> | null;
  }>;
  availabilityStatus?: string;
  conversionStatus?: string;
  priceChangeReason?: string;
  pricingBasis?: "bottle" | "case";
  pricingModel?: "standard" | "grw_broker";
  priorPricingCostFingerprint?: string | null;
  pricingCalculatedAt?: string | null;
  frontlineOnly?: boolean;
  expectedLockVersion?: number | null;
  idempotencyKey?: string | null;
}) {
  if (!input.producer.trim()) {
    throw new Error("Producer is required.");
  }
  if (!input.wineName.trim()) {
    throw new Error("Item Name is required.");
  }
  if (input.laidInPerBottle === null || input.laidInPerBottle === undefined) {
    throw new Error("Laid-in per bottle is required before calculating pricing.");
  }
  const parsedPackSize = Number(input.packSize);
  if (!Number.isFinite(parsedPackSize) || parsedPackSize <= 0 || !Number.isInteger(parsedPackSize)) {
    throw new Error("Pack size is required and must be a positive whole number.");
  }
  const pricingBasis = input.pricingBasis || (Number(input.fobBottle || 0) > 0 ? "bottle" : "case");
  const sourceFob = pricingBasis === "case" ? Number(input.fobCase || 0) : Number(input.fobBottle || 0);
  if (!Number.isFinite(sourceFob) || sourceFob <= 0) {
    throw new Error(`${pricingBasis === "case" ? "Case" : "Bottle"} FOB is required before calculating pricing.`);
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
  const invalidPriceLevel = (input.priceLevels || []).find((level) =>
    Number(level.bottlePrice || 0) < 0 || Number(level.depletionAllowance || 0) < 0 ||
    (level.targetGpMargin !== null && level.targetGpMargin !== undefined &&
      (!Number.isFinite(Number(level.targetGpMargin)) || Number(level.targetGpMargin) < 0 || Number(level.targetGpMargin) >= 1))
  );
  if (invalidPriceLevel) {
    throw new Error("Price levels require nonnegative prices/DA and target GP below 100%.");
  }
  const invalidFreeGood = (input.freeGoods || []).find(
    (freeGood) => Number(freeGood.buyQuantity || 0) < 0 || Number(freeGood.freeQuantity || 0) < 0
  );
  if (invalidFreeGood) {
    throw new Error("Free goods quantities cannot be negative.");
  }

  const { supabase } = await requireWriteAccess();
  let canonicalSupplierName = input.supplierName;
  if (input.supplierId) {
    const { data: supplier, error: supplierError } = await supabase
      .from("suppliers")
      .select("name")
      .eq("id", input.supplierId)
      .maybeSingle<{ name: string }>();
    if (supplierError) throw new Error(supplierError.message);
    if (supplier?.name) canonicalSupplierName = supplier.name;
  }
  const payload = buildSupplierCatalogWine({
    supplierId: input.supplierId || null,
    supplierName: canonicalSupplierName,
    producer: input.producer,
    wineName: input.wineName,
    vintage: input.vintage || "NV",
    packSize: input.packSize as number,
    bottleSize: input.bottleSize || "750ml",
    fobBottle: input.fobBottle,
    fobCase: input.fobCase,
    laidInPerBottle: input.laidInPerBottle,
    frontlineOverride: input.frontlineOverride,
    bestPriceOverride: input.bestPriceOverride,
    systemTags: input.systemTags || [],
    copiedFromSupplierCatalogWineId: input.copiedFromSupplierCatalogWineId || null,
    quickbooksItemId: input.quickbooksItemId || null,
    quickbooksItemName: input.quickbooksItemName || null,
    quickbooksItemNumber: input.quickbooksItemNumber || null,
    sourceSystem: input.sourceSystem || null,
    sourceId: input.sourceId || null,
    priceLevels: input.priceLevels,
    freeGoods: input.freeGoods,
    availabilityStatus: availabilityStatus as AvailabilityStatus,
    conversionStatus: conversionStatus as ConversionStatus,
    priceChangeReason: input.priceChangeReason,
    pricingBasis,
    pricingModel: input.pricingModel,
    priorPricingCostFingerprint: input.priorPricingCostFingerprint,
    pricingCalculatedAt: input.pricingCalculatedAt,
    frontlineOnly: Boolean(input.frontlineOnly),
    expectedLockVersion: input.expectedLockVersion
  });
  const lowGpLevels = (payload.price_levels || []).filter(
    (level) => level.active !== false && Number(level.bottle_price || 0) > 0 && Number(level.calculated_gp_margin || 0) < MINIMUM_GP_MARGIN
  );
  const frontlineLevel = (payload.price_levels || []).find((level) => level.is_frontline);
  const bestLevel = input.frontlineOnly
    ? null
    : (payload.price_levels || []).find((level) => level.active !== false && level.is_best && Number(level.bottle_price || 0) > 0);
  if (frontlineLevel && bestLevel && Number(frontlineLevel.bottle_price || 0) <= Number(bestLevel.bottle_price || 0)) {
    throw new Error("Frontline must be higher than Best. Reset either level to the suggestion or enter a valid manual ladder.");
  }
  const requiredOverrides = [
    ...lowGpLevels,
    ...(Number(payload.gross_profit_margin || 0) < MINIMUM_GP_MARGIN && frontlineLevel && !lowGpLevels.includes(frontlineLevel) ? [frontlineLevel] : [])
  ];
  if (input.pricingModel !== "grw_broker" && requiredOverrides.some((level) =>
    level.approval_decision !== "approve_price" || !level.override_reason || !level.approval_owner || !VALID_APPROVERS.has(level.approval_owner)
  )) {
      throw new Error("Any controllable price below 28% requires Approve price, an override reason, and an owner/approver.");
  }
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

  const { price_levels: payloadPriceLevels, free_goods: payloadFreeGoods, ...payloadCatalog } = payload;
  const rpcPayload = {
    ...payloadCatalog,
    price_change_reason: input.priceChangeReason || "Manual catalog update",
    ...(input.existingCatalogWineId ? { id: input.existingCatalogWineId } : {})
  };
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
    source_id: level.source_id,
    solve_for: level.solve_for || "gp",
    approval_decision: level.approval_decision,
    suggested_price: level.suggested_price,
    suggested_gp_margin: level.suggested_gp_margin,
    da_alternative: level.da_alternative,
    final_approved_price: level.final_approved_price,
    final_approved_da: level.final_approved_da,
    final_gp_margin: level.final_gp_margin,
    is_manual_override: Boolean(level.is_manual_override),
    override_reason: level.override_reason,
    approval_owner: level.approval_owner,
    decision_timestamp: level.approval_decision ? (level.decision_timestamp || new Date().toISOString()) : null
  }));
  const freeGoods = (payloadFreeGoods || []).map((freeGood) => ({
    buy_quantity: freeGood.buy_quantity,
    free_quantity: freeGood.free_quantity,
    unit: freeGood.unit,
    program_name: freeGood.program_name,
    starts_on: freeGood.starts_on,
    ends_on: freeGood.ends_on,
    notes: freeGood.notes,
    active: freeGood.active,
    extension_metadata: freeGood.extension_metadata || {}
  }));

  const requestHash = createHash("sha256")
    .update(JSON.stringify({ catalog: rpcPayload, priceLevels, freeGoods, reportRunId: latestRun?.id || null }))
    .digest("hex");
  const { data: saveResult, error: saveError } = await supabase.rpc("save_supplier_catalog_sku_atomic", {
    p_catalog: rpcPayload,
    p_price_levels: priceLevels,
    p_free_goods: freeGoods,
    p_report_run_id: latestRun?.id || null,
    p_expected_lock_version: Number(input.expectedLockVersion || 0),
    p_idempotency_key: input.idempotencyKey || randomUUID(),
    p_request_hash: requestHash
  });

  if (saveError || !saveResult) {
    throw new Error(saveError?.message || "Could not save supplier wine.");
  }

  const result = saveResult as {
    mode: "created" | "updated";
    saved: SupplierCatalogWine;
    previous: SupplierCatalogWine | null;
    price_change_created?: boolean;
  };
  const saved = result.saved;

  revalidateSupplierCatalogData();
  revalidatePath("/");
  return {
    mode: result.mode,
    saved,
    displayName: saved.display_name,
    planningSku: saved.planning_sku,
    priceChangeCreated: Boolean(result.price_change_created)
  };
}

export async function deletePendingSupplierCatalogWine(input: { id: string }) {
  if (!input.id) {
    throw new Error("Missing supplier wine id.");
  }

  await requireWriteAccess();
  const supabase = createServiceRoleClient();
  const { data: wine, error: wineError } = await supabase
    .from("supplier_catalog_wines")
    .select("*")
    .eq("id", input.id)
    .single<SupplierCatalogWine>();

  if (wineError || !wine) {
    throw new Error(wineError?.message || "Supplier wine not found.");
  }

  const hasOfficialProduct = hasOfficialQuickBooksProduct(wine);
  const isDraftOnlyProduct =
    !hasOfficialProduct &&
    (wine.product_lifecycle_status === "pending_product_creation" ||
      wine.quickbooks_sync_status === "not_created" ||
      ["new_vintage", "new_format", "possible_match_needs_review", "net_new_product"].includes(wine.conversion_status));

  if (!isDraftOnlyProduct) {
    throw new Error("Only draft-only pending product-creation records can be deleted here.");
  }
  if (hasOfficialProduct) {
    throw new Error("This record is linked to an official or QuickBooks item and cannot be deleted here.");
  }

  const { data: blockingPriceChanges, error: priceChangeReadError } = await supabase
    .from("price_change_events")
    .select("id,status")
    .eq("supplier_catalog_wine_id", input.id)
    .not("status", "in", "(draft,pending_review)");

  if (priceChangeReadError) {
    throw new Error(priceChangeReadError.message);
  }
  if ((blockingPriceChanges || []).length > 0) {
    throw new Error("This record has approved or communicated price changes and cannot be deleted here.");
  }

  const { error: copiedWineError } = await supabase
    .from("supplier_catalog_wines")
    .update({ copied_from_supplier_catalog_wine_id: null })
    .eq("copied_from_supplier_catalog_wine_id", input.id);
  if (copiedWineError) {
    throw new Error(copiedWineError.message);
  }

  const childDeletes = await Promise.all([
    supabase.from("price_change_events").delete().eq("supplier_catalog_wine_id", input.id).in("status", ["draft", "pending_review"]),
    supabase.from("supplier_catalog_price_levels").delete().eq("supplier_catalog_wine_id", input.id),
    supabase.from("supplier_catalog_free_goods").delete().eq("supplier_catalog_wine_id", input.id),
    supabase.from("supplier_catalog_workbench_items").delete().eq("supplier_catalog_wine_id", input.id)
  ]);
  const childDeleteError = childDeletes.find((result) => result.error)?.error;
  if (childDeleteError) {
    throw new Error(childDeleteError.message);
  }

  const { data: deletedWine, error: deleteError } = await supabase
    .from("supplier_catalog_wines")
    .delete()
    .eq("id", input.id)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (deleteError) {
    throw new Error(deleteError.message);
  }
  if (!deletedWine) {
    throw new Error("The pending product was not deleted. Please reload and try again.");
  }

  revalidateSupplierCatalogData();
  revalidatePath("/");
  return { displayName: wine.display_name };
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
    expectedLockVersion: number;
  }>;
}): Promise<ApprovalSaveResult> {
  const updates = input.updates.filter((update) => update.supplierCatalogWineId && update.reportRunId);
  if (updates.length === 0) return { ok: true, saved: [], conflicts: [] };

  for (const update of updates) {
    if (update.recommendationStatus && !VALID_STATUSES.has(update.recommendationStatus)) {
      throw new Error("Unsupported recommendation status.");
    }
    if (update.orderPath && !VALID_ORDER_PATHS.has(update.orderPath)) {
      throw new Error("Unsupported order path.");
    }
  }

  return updateRecommendationApprovals({
    updates: updates.map((update) => ({
      sourceType: "catalog_workbench" as const,
      id: update.id,
      reportRunId: update.reportRunId,
      supplierCatalogWineId: update.supplierCatalogWineId,
      recommendationStatus: update.recommendationStatus || "rejected",
      approvedQty: update.approvedQty || 0,
      expectedLockVersion: update.expectedLockVersion,
      recommendedQty: update.recommendedQty,
      orderPath: update.orderPath
    }))
  });
}

export async function restoreInactiveQuickBooksItemToWorkbench(input: {
  listId: string;
  reportRunId: string;
}) {
  if (!input.listId || !input.reportRunId) {
    throw new Error("Inactive QuickBooks item and report run are required.");
  }

  const { supabase, user } = await requireWriteAccess();
  type SourceItem = QuickBooksItemIdentityRow & {
    is_active: boolean | null;
    item_type: string | null;
    sales_price: number | string | null;
    purchase_cost: number | string | null;
    average_cost: number | string | null;
  };
  const { data: sourceItem, error: sourceError } = await supabase
    .from("quickbooks_items")
    .select("list_id,name,full_name,is_active,item_type,sales_desc,purchase_desc,sales_price,purchase_cost,average_cost,custom_fields,raw_data")
    .eq("list_id", input.listId)
    .maybeSingle<SourceItem>();

  if (sourceError || !sourceItem) throw new Error(sourceError?.message || "Inactive QuickBooks item was not found.");
  if (sourceItem.is_active !== false) throw new Error("This QuickBooks item is active again. Refresh Order Review to see it normally.");
  if (sourceItem.item_type !== "Inventory") throw new Error("Only inactive QuickBooks inventory items can be restored to the workbench.");

  const preferredVendorListId = quickBooksPreferredVendorListId(sourceItem);
  if (!preferredVendorListId) throw new Error("This QuickBooks item has no preferred vendor, so it cannot be assigned to a supplier workbench.");
  const { data: vendorMapping, error: mappingError } = await supabase
    .from("quickbooks_vendor_mappings")
    .select("supplier_id")
    .eq("quickbooks_vendor_list_id", preferredVendorListId)
    .maybeSingle<{ supplier_id: string | null }>();
  if (mappingError) throw new Error(mappingError.message);
  if (!vendorMapping?.supplier_id) throw new Error("Map this QuickBooks preferred vendor to Supplier Logistics before restoring the item.");

  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select("id,name,trucking_cost_per_bottle")
    .eq("id", vendorMapping.supplier_id)
    .single<{ id: string; name: string; trucking_cost_per_bottle: number | string | null }>();
  if (supplierError || !supplier) throw new Error(supplierError?.message || "Mapped supplier was not found.");

  const supplierName = supplier.name.trim();
  const displayName = quickBooksItemDisplayName(sourceItem);
  const itemNumber = quickBooksItemCode(sourceItem);
  const planningSku = buildPlanningSku(displayName);
  const format = quickBooksPackFormat(sourceItem);
  let existing: SupplierCatalogWine | null = null;

  const { data: sourceMatch, error: sourceMatchError } = await supabase
    .from("supplier_catalog_wines")
    .select("*")
    .eq("quickbooks_item_id", sourceItem.list_id)
    .limit(1)
    .maybeSingle<SupplierCatalogWine>();
  if (sourceMatchError) throw new Error(sourceMatchError.message);
  existing = sourceMatch || null;

  if (!existing) {
    const { data: itemMatch, error: itemMatchError } = await supabase
      .from("supplier_catalog_wines")
      .select("*")
      .ilike("quickbooks_item_number", itemNumber)
      .limit(1)
      .maybeSingle<SupplierCatalogWine>();
    if (itemMatchError) throw new Error(itemMatchError.message);
    existing = itemMatch || null;
  }

  if (!existing) {
    const { data: skuMatch, error: skuMatchError } = await supabase
      .from("supplier_catalog_wines")
      .select("*")
      .eq("supplier_id", supplier.id)
      .eq("planning_sku", planningSku)
      .limit(1)
      .maybeSingle<SupplierCatalogWine>();
    if (skuMatchError) throw new Error(skuMatchError.message);
    existing = skuMatch || null;
  }

  let catalogWineId = existing?.id || null;
  const now = new Date().toISOString();
  const packSize = format.packSize;
  const fobBottle = Math.max(0, asNumber(sourceItem.purchase_cost) || asNumber(sourceItem.average_cost));
  const trucking = Math.max(0, asNumber(supplier.trucking_cost_per_bottle));
  const landedCost = fobBottle + trucking;
  const frontlinePrice = Math.max(0, asNumber(sourceItem.sales_price));
  const grossProfitMargin = frontlinePrice > 0 ? (frontlinePrice - landedCost) / frontlinePrice : 0;
  const producer = quickBooksProducer(sourceItem) || "Unknown producer";
  const vintage = quickBooksVintage(sourceItem);
  if (existing) {
    const { error: updateError } = await supabase
      .from("supplier_catalog_wines")
      .update({
        availability_status: "sold_out",
        conversion_status: "exact_existing_product",
        product_lifecycle_status: "inactive",
        supplier_id: supplier.id,
        supplier_name: supplierName,
        producer,
        wine_name: displayName,
        vintage,
        pack_size: packSize,
        bottle_size: format.bottleSize,
        pricing_basis: "bottle",
        fob_bottle: fobBottle,
        fob_case: fobBottle * packSize,
        laid_in_per_bottle: trucking,
        landed_bottle_cost: landedCost,
        frontline_bottle_price: frontlinePrice,
        gross_profit_margin: grossProfitMargin,
        display_name: displayName,
        planning_sku: planningSku,
        planning_sku_without_vintage: buildPlanningSku(displayName, true),
        quickbooks_item_id: sourceItem.list_id,
        quickbooks_item_name: displayName,
        quickbooks_item_number: itemNumber,
        quickbooks_sync_status: "linked",
        source_system: "quickbooks_desktop",
        source_id: sourceItem.list_id,
        updated_at: now
      })
      .eq("id", existing.id);
    if (updateError) throw new Error(updateError.message);
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("supplier_catalog_wines")
      .insert({
        supplier_id: supplier.id,
        supplier_name: supplierName,
        producer,
        wine_name: displayName,
        vintage,
        pack_size: packSize,
        bottle_size: format.bottleSize,
        pricing_basis: "bottle",
        fob_bottle: fobBottle,
        fob_case: fobBottle * packSize,
        laid_in_per_bottle: trucking,
        landed_bottle_cost: landedCost,
        frontline_bottle_price: frontlinePrice,
        gross_profit_margin: grossProfitMargin,
        availability_status: "sold_out",
        conversion_status: "exact_existing_product",
        display_name: displayName,
        planning_sku: planningSku,
        planning_sku_without_vintage: buildPlanningSku(displayName, true),
        diagnostics: { restored_from_inactive_quickbooks_item: sourceItem.list_id },
        quickbooks_item_id: sourceItem.list_id,
        quickbooks_item_name: displayName,
        quickbooks_item_number: itemNumber,
        quickbooks_sync_status: "linked",
        product_lifecycle_status: "inactive",
        accounting_create_payload: {},
        system_tags: [],
        source_system: "quickbooks_desktop",
        source_id: sourceItem.list_id,
        updated_at: now
      })
      .select("id")
      .single<{ id: string }>();
    if (insertError || !inserted) throw new Error(insertError?.message || "Could not restore the inactive wine.");
    catalogWineId = inserted.id;
  }

  if (!catalogWineId) throw new Error("Could not identify the restored supplier wine.");

  const recommendedQty = Math.max(1, Math.round(format.packSize || asNumber(existing?.pack_size) || 1));
  const { data: existingWorkbench, error: existingWorkbenchError } = await supabase
    .from("supplier_catalog_workbench_items")
    .select("id")
    .eq("report_run_id", input.reportRunId)
    .eq("supplier_catalog_wine_id", catalogWineId)
    .maybeSingle<{ id: string }>();
  if (existingWorkbenchError) throw new Error(existingWorkbenchError.message);
  const workbenchPayload = {
      report_run_id: input.reportRunId,
      supplier_catalog_wine_id: catalogWineId,
      recommended_qty: recommendedQty,
      order_path: "stateside",
      active: true,
      notes: "Restored from inactive QuickBooks item search.",
      created_by: user.id,
      updated_at: now
  };
  const { error: workbenchError } = existingWorkbench
    ? await supabase.from("supplier_catalog_workbench_items").update(workbenchPayload).eq("id", existingWorkbench.id)
    : await supabase.from("supplier_catalog_workbench_items").insert({
        ...workbenchPayload,
        recommendation_status: "rejected",
        approved_qty: 0
      });
  if (workbenchError) throw new Error(workbenchError.message);

  revalidateSupplierCatalogData();
  revalidatePath("/");
  return { displayName, catalogWineId };
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

  revalidateSupplierCatalogData();
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

  revalidateSupplierCatalogData();
  revalidatePath("/");
}
