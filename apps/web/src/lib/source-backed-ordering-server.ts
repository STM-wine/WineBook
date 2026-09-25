import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ORDERING_LOGIC_SETTINGS, normalizeOrderingLogicSettings, type OrderingLogicSettings } from "./ordering-logic";
import {
  buildSourceBackedOrderingRows,
  emptySalesWindows,
  normalizeOrderingItemCode,
  recommendationAllowsSourceAssignmentRefresh,
  refreshSourceBackedRecommendation,
  type SourceBackedOrderingData,
  type SourceOrderingMarker,
  type SourceQuickBooksItem,
  type SourceQuickBooksVendor,
  type SourceSalesWindows,
  type SourceSupplier,
  type SourceVendorMapping,
  type SourceVinosmithWine
} from "./source-backed-ordering";
import type { Recommendation } from "./types";
import { fetchQuickBooksItemSalesWindows } from "./supabase/quickbooks-item-sales-windows";
import { fetchLiveVinosmithAvailability, type LatestVinosmithAvailability } from "./supabase/vinosmith-availability";
import { fetchAllExact } from "./supabase/fetch-all-exact";
import {
  fetchLatestCompletedQuickBooksOnOrderSnapshot
} from "./supabase/recommendations";
import { applyCompletedQuickBooksOnOrderSnapshot } from "./quickbooks-on-order-snapshot";
import {
  assertCurrentOrderingDiagnostics,
  orderingBusinessDate
} from "./ordering-freshness";

export { ORDERING_TIMEZONE, orderingBusinessDate } from "./ordering-freshness";

type SourceClient = SupabaseClient<any, "public", any>;

export type PublishedOrderingConfiguration = {
  id: string | null;
  values: OrderingLogicSettings;
};

const PAGE_SIZE = 1000;

export async function fetchSourceBackedOrderingData(
  supabase: SourceClient,
  options: {
    referenceDate?: string;
    liveAvailability?: LatestVinosmithAvailability;
  } = {}
): Promise<SourceBackedOrderingData & { configuration: PublishedOrderingConfiguration }> {
  const referenceDate = options.referenceDate || orderingBusinessDate();
  await assertLatestQuickBooksSyncComplete(supabase);
  const [configuration, liveQuickBooksItems, completedItemSnapshot, vinosmithWines, suppliers, quickBooksVendors, vendorMappings, markers, availability] = await Promise.all([
    fetchPublishedOrderingConfiguration(supabase),
    fetchAll<SourceQuickBooksItem>(supabase, "quickbooks_items", "list_id,name,full_name,sales_desc,purchase_desc,is_active,item_type,quantity_on_hand,quantity_on_order,purchase_cost,average_cost,custom_fields,raw_data,last_seen_at", "list_id"),
    fetchLatestCompletedQuickBooksOnOrderSnapshot(supabase),
    fetchAll<SourceVinosmithWine>(supabase, "vinosmith_wines", "wine_id,code,name,vintage,importer_name", "wine_id"),
    fetchAll<SourceSupplier>(supabase, "suppliers", "id,name,eta_days,pick_up_location,freight_forwarder,order_frequency,tdm,trucking_cost_per_bottle,active", "name"),
    fetchAll<SourceQuickBooksVendor>(supabase, "quickbooks_vendors", "list_id,name,full_name", "list_id"),
    fetchAll<SourceVendorMapping>(supabase, "quickbooks_vendor_mappings", "quickbooks_vendor_list_id,supplier_id,vendor_classification", "quickbooks_vendor_list_id"),
    fetchOrderingMarkers(supabase),
    options.liveAvailability ? Promise.resolve(options.liveAvailability) : fetchLiveVinosmithAvailability()
  ]);
  const quickBooksItems = completedItemSnapshot === null
    ? liveQuickBooksItems
    : applyCompletedQuickBooksOnOrderSnapshot(liveQuickBooksItems, completedItemSnapshot);

  const itemCodeByListId = new Map(quickBooksItems.map((item) => [item.list_id, normalizeOrderingItemCode(itemCode(item))]));
  const salesRows = await fetchQuickBooksItemSalesWindows(supabase, referenceDate);
  const salesByCode = new Map<string, SourceSalesWindows>();
  for (const row of salesRows) {
    const code = normalizeOrderingItemCode(itemCodeByListId.get(row.item_list_id || "") || row.item_full_name || "");
    if (!code) continue;
    const current = salesByCode.get(code) || emptySales();
    current.last30 += numeric(row.last_30_quantity);
    current.last60 += numeric(row.last_60_quantity);
    current.last90 += numeric(row.last_90_quantity);
    current.prior30 += numeric(row.prior_30_quantity);
    current.next30Ly += numeric(row.last_year_next_30_quantity);
    current.next60Ly += numeric(row.last_year_next_60_quantity);
    current.next90Ly += numeric(row.last_year_next_90_quantity);
    salesByCode.set(code, current);
  }

  const quickBooksAsOf = quickBooksItems
    .map((item) => item.last_seen_at || null)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null;
  const built = buildSourceBackedOrderingRows({
    quickBooksItems,
    vinosmithWines,
    vinosmithAvailableByCode: availability.byProductCode,
    vinosmithAvailableAsOf: availability.snapshotAt,
    quickBooksAsOf,
    suppliers,
    quickBooksVendors,
    vendorMappings,
    markers,
    salesByCode,
    settings: configuration.values,
    referenceDate
  });

  return { ...built, configuration };
}

export async function fetchCurrentSourceBackedOrderingData(
  supabase: SourceClient,
  options: {
    liveAvailability?: LatestVinosmithAvailability;
    now?: Date;
  } = {}
): Promise<SourceBackedOrderingData & { configuration: PublishedOrderingConfiguration }> {
  const referenceDate = orderingBusinessDate(options.now);
  const data = await fetchSourceBackedOrderingData(supabase, {
    referenceDate,
    liveAvailability: options.liveAvailability
  });
  assertCurrentOrderingDiagnostics(data.diagnostics, referenceDate);
  return data;
}

export async function fetchCurrentOrderingOverlay(
  supabase: SourceClient,
  recommendations: Recommendation[],
  options: {
    liveAvailability?: LatestVinosmithAvailability;
    now?: Date;
  } = {}
) {
  const referenceDate = orderingBusinessDate(options.now);
  const availability = options.liveAvailability || await fetchLiveVinosmithAvailability();
  const reportRunIds = Array.from(new Set(recommendations.map((row) => row.report_run_id).filter(Boolean)));
  const [quickBooksAsOf, configuration, onOrderSnapshot, activeItems, vendorMappings, suppliers, commitments, salesRows] = await Promise.all([
    assertLatestQuickBooksSyncComplete(supabase),
    fetchPublishedOrderingConfiguration(supabase),
    fetchLatestCompletedQuickBooksOnOrderSnapshot(supabase),
    fetchAllExact<{ list_id: string; raw_data: Record<string, unknown> | null }>("active QuickBooks inventory identities", (from, to) => supabase
      .from("quickbooks_items")
      .select("list_id,raw_data", { count: "exact" })
      .eq("is_active", true)
      .eq("item_type", "Inventory")
      .order("list_id", { ascending: true })
      .range(from, to)
      .returns<Array<{ list_id: string; raw_data: Record<string, unknown> | null }>>() as never),
    fetchAll<SourceVendorMapping>(supabase, "quickbooks_vendor_mappings", "quickbooks_vendor_list_id,supplier_id,vendor_classification", "quickbooks_vendor_list_id"),
    fetchAll<SourceSupplier>(supabase, "suppliers", "id,name,eta_days,pick_up_location,freight_forwarder,order_frequency,tdm,trucking_cost_per_bottle,active", "name"),
    reportRunIds.length > 0
      ? fetchAllExact<{ source_id: string }>("ordering approval commitments", (from, to) => supabase
          .from("approval_commitments")
          .select("source_id", { count: "exact" })
          .in("report_run_id", reportRunIds)
          .eq("source_type", "recommendation")
          .order("source_id", { ascending: true })
          .range(from, to)
          .returns<Array<{ source_id: string }>>() as never)
      : Promise.resolve([]),
    fetchQuickBooksItemSalesWindows(supabase, referenceDate)
  ]);
  if (onOrderSnapshot === null) {
    throw new Error("The latest completed QuickBooks refresh has no inventory snapshot.");
  }
  const itemCodeByListId = new Map<string, string>();
  for (const row of recommendations) {
    const listId = String(row.diagnostics?.quickbooks_item_list_id || "").trim();
    const code = normalizeOrderingItemCode(row.product_code);
    if (listId && code) itemCodeByListId.set(listId, code);
  }
  const onOrderByListId = new Map(onOrderSnapshot.map((row) => [row.item_list_id, numeric(row.quantity_on_order)]));
  const activeItemListIds = new Set(activeItems.map((item) => item.list_id));
  const preferredVendorByItemListId = new Map(activeItems.flatMap((item) => {
    const reference = preferredVendorReference(item.raw_data);
    return reference ? [[item.list_id, reference] as const] : [];
  }));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const supplierByVendorId = new Map(vendorMappings.flatMap((mapping) => {
    const supplier = mapping.vendor_classification === "inventory_wine" && mapping.supplier_id
      ? supplierById.get(mapping.supplier_id) || null
      : null;
    return supplier ? [[mapping.quickbooks_vendor_list_id, supplier] as const] : [];
  }));
  const committedRecommendationIds = new Set(commitments.map((commitment) => commitment.source_id));
  const salesByCode = new Map<string, SourceSalesWindows>();
  for (const row of salesRows) {
    const code = normalizeOrderingItemCode(itemCodeByListId.get(row.item_list_id || "") || row.item_full_name || "");
    if (!code) continue;
    const current = salesByCode.get(code) || emptySalesWindows();
    current.last30 += numeric(row.last_30_quantity);
    current.last60 += numeric(row.last_60_quantity);
    current.last90 += numeric(row.last_90_quantity);
    current.prior30 += numeric(row.prior_30_quantity);
    current.next30Ly += numeric(row.last_year_next_30_quantity);
    current.next60Ly += numeric(row.last_year_next_60_quantity);
    current.next90Ly += numeric(row.last_year_next_90_quantity);
    salesByCode.set(code, current);
  }

  const rows = recommendations.flatMap((row) => {
    const code = normalizeOrderingItemCode(row.product_code);
    const listId = String(row.diagnostics?.quickbooks_item_list_id || "").trim();
    if (!code || !listId || !activeItemListIds.has(listId)) return [];
    const preferredVendor = preferredVendorByItemListId.get(listId) || null;
    const currentSupplier = preferredVendor ? supplierByVendorId.get(preferredVendor.id) || null : null;
    const refreshSupplier = currentSupplier && preferredVendor && recommendationAllowsSourceAssignmentRefresh(
      row,
      committedRecommendationIds.has(row.id)
    )
      ? {
          id: currentSupplier.id,
          name: currentSupplier.name,
          tdm: currentSupplier.tdm,
          truckingCostPerBottle: numeric(currentSupplier.trucking_cost_per_bottle),
          pickupLocation: currentSupplier.pick_up_location,
          etaDays: nullableNumeric(currentSupplier.eta_days),
          freightForwarder: currentSupplier.freight_forwarder,
          orderFrequency: currentSupplier.order_frequency,
          preferredVendorId: preferredVendor.id,
          preferredVendorName: preferredVendor.name
        }
      : undefined;
    return [refreshSourceBackedRecommendation(row, {
      sales: salesByCode.get(code) || emptySalesWindows(),
      trueAvailable: numeric(availability.byProductCode.get(code)),
      onOrder: Math.max(0, onOrderByListId.get(listId) || 0),
      quickBooksItemAsOf: quickBooksAsOf,
      vinosmithAvailableAsOf: availability.snapshotAt,
      supplier: refreshSupplier
    }, configuration.values, referenceDate)];
  });
  const quickBooksFreshnessHours = ageHours(quickBooksAsOf);
  const diagnostics = {
    reference_date: referenceDate,
    quickbooks_as_of: quickBooksAsOf,
    quickbooks_freshness_hours: quickBooksFreshnessHours,
    quickbooks_fresh: quickBooksFreshnessHours !== null && quickBooksFreshnessHours <= 72
  };
  assertCurrentOrderingDiagnostics(diagnostics, referenceDate);
  return { rows, diagnostics };
}

async function assertLatestQuickBooksSyncComplete(supabase: SourceClient) {
  const { data, error } = await supabase
    .from("source_sync_runs")
    .select("status,started_at,completed_at,error_message")
    .eq("source_system", "quickbooks_desktop")
    .eq("worker_name", "quickbooks_web_connector")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ status: string; started_at: string; completed_at: string | null; error_message: string | null }>();
  if (error) throw new Error(error.message);
  if (data && data.status !== "completed") {
    throw new Error(
      `The latest QuickBooks Web Connector refresh is ${data.status}, not complete. ${data.error_message || "Finish a successful Web Connector pull before refreshing ordering data."}`
    );
  }
  if (!data?.completed_at) {
    throw new Error("The latest QuickBooks Web Connector refresh has no completed timestamp.");
  }
  return data.completed_at;
}

export async function fetchPublishedOrderingConfiguration(supabase: SourceClient): Promise<PublishedOrderingConfiguration> {
  const { data, error } = await supabase
    .from("configuration_versions")
    .select("id,values")
    .eq("domain", "ordering_logic")
    .eq("status", "published")
    .maybeSingle<{ id: string; values: Partial<OrderingLogicSettings> | null }>();
  if (error) throw new Error(error.message);
  return {
    id: data?.id || null,
    values: normalizeOrderingLogicSettings(data?.values || DEFAULT_ORDERING_LOGIC_SETTINGS)
  };
}

async function fetchOrderingMarkers(supabase: SourceClient) {
  try {
    return await fetchAll<SourceOrderingMarker>(
      supabase,
      "ordering_item_markers",
      "item_code,quickbooks_item_list_id,is_btg,is_core,replenishment_policy,policy_family_key,policy_family_name,family_default_policy,recommendations_suppressed,suppression_reason,suppressed_until,suppression_changed_at,suppression_changed_by,note_source",
      "item_code"
    );
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("ordering_item_markers")) return [];
    throw error;
  }
}

async function fetchAll<Row>(supabase: SourceClient, table: string, columns: string, orderBy: string) {
  return fetchAllExact<Row>(table, (from, to) => supabase
      .from(table)
      .select(columns, { count: "exact" })
      .order(orderBy, { ascending: true })
      .range(from, to)
      .returns<Row[]>() as never,
    PAGE_SIZE
  );
}

function itemCode(item: Pick<SourceQuickBooksItem, "custom_fields" | "name" | "full_name" | "list_id">) {
  const fields = item.custom_fields || {};
  const normalized = new Map(Object.entries(fields).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]+/g, "_"), value]));
  for (const key of ["item_number", "sku", "product_code"]) {
    const value = fields[key] ?? normalized.get(key);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const nested = record.value ?? record.Value ?? record.DataExtValue;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }
  return item.name || item.full_name || item.list_id;
}

function emptySales(): SourceSalesWindows {
  return { last30: 0, last60: 0, last90: 0, prior30: 0, next30Ly: 0, next60Ly: 0, next90Ly: 0 };
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function preferredVendorReference(rawData: Record<string, unknown> | null) {
  if (!rawData || Array.isArray(rawData)) return null;
  const value = rawData.preferred_vendor_ref ?? rawData.pref_vendor_ref ?? rawData.PrefVendorRef;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = String(record.ListID ?? record.list_id ?? record.value ?? "").trim();
  if (!id) return null;
  const name = String(record.FullName ?? record.full_name ?? record.name ?? "").trim() || null;
  return { id, name };
}

function ageHours(value: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 3_600_000) : null;
}
