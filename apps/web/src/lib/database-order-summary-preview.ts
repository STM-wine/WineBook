import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asNumber } from "@/lib/order-data";
import {
  DEFAULT_ORDERING_LOGIC_SETTINGS,
  normalizeOrderingLogicSettings,
  type OrderingLogicSettings
} from "@/lib/ordering-logic";

type PreviewClient = SupabaseClient<any, "public", any>;

type QuickBooksItemRow = {
  list_id: string;
  name: string | null;
  full_name: string | null;
  is_active: boolean | null;
  item_type: string | null;
  quantity_on_hand: number | string | null;
  quantity_on_order: number | string | null;
  purchase_cost: number | string | null;
  average_cost: number | string | null;
  custom_fields: Record<string, unknown> | null;
  raw_data: Record<string, unknown> | null;
};

type VinosmithWineRow = {
  wine_id: string;
  code: string | null;
  name: string | null;
  importer_name: string | null;
  active: boolean | null;
  orderable: boolean | null;
};

type VinosmithInventorySnapshotRow = {
  id: string;
  wine_id: string;
  snapshot_at: string | null;
  available: number | string | null;
  on_hold: number | string | null;
  on_future: number | string | null;
  on_pending_sync: number | string | null;
};

type SupplierRow = {
  id: string;
  name: string;
  eta_days: number | string | null;
  pick_up_location: string | null;
  freight_forwarder: string | null;
  order_frequency: string | null;
  tdm: string | null;
  trucking_cost_per_bottle: number | string | null;
  active: boolean | null;
};

type OrderingItemMarkerRow = {
  item_code: string;
  quickbooks_item_list_id: string | null;
  is_btg: boolean | null;
  is_core: boolean | null;
  marker_note: string | null;
  note_source: string | null;
};

type QuickBooksVendorMappingRow = {
  quickbooks_vendor_list_id: string;
  supplier_id: string | null;
  vendor_classification: string | null;
};

type ReportRunRow = {
  id: string;
  report_date: string | null;
  completed_at: string | null;
};

type ReportRecommendationRow = {
  product_code: string | null;
  recommended_qty_rounded: number | string | null;
};

type QuickBooksTransactionRow = {
  txn_id: string;
  txn_date: string | null;
  is_void?: boolean | null;
  is_pending?: boolean | null;
};

type QuickBooksLineRow = {
  txn_id: string;
  item_list_id: string | null;
  item_full_name: string | null;
  quantity: number | string | null;
};

type SalesWindows = {
  last30: number;
  last60: number;
  last90: number;
  prior30: number;
  next30Ly: number;
  next60Ly: number;
  next90Ly: number;
};

export type DatabaseOrderSummaryPreviewRow = {
  itemCode: string;
  productName: string;
  supplierName: string;
  supplierSource: string;
  sourceStatus: "ready" | "needs_review";
  blockers: string[];
  quickBooksOnHand: number;
  quickBooksOnOrder: number;
  vinosmithAvailable: number;
  vinosmithHold: number;
  vinosmithFuture: number;
  vinosmithPendingSync: number;
  fob: number;
  packSize: number;
  packSizeSource: string;
  truckingCostPerBottle: number;
  landedBottleCost: number;
  sales30: number;
  sales60: number;
  sales90: number;
  prior30Sales: number;
  next30DayForecast: number;
  next60DayForecast: number;
  next90DayForecast: number;
  weeklyVelocity: number;
  weeksOnHand: number | null;
  weeksOnHandWithOnOrder: number | null;
  isBtg: boolean;
  isCore: boolean;
  recommendedQty: number;
  currentReportRecommendedQty: number | null;
  recommendedQtyDelta: number | null;
  orderCost: number;
  landedCost: number;
  etaDays: number | null;
  tdm: string | null;
  pickupLocation: string | null;
};

export type DatabaseOrderSummaryPreviewSupplier = {
  supplierName: string;
  sourceStatus: "ready" | "needs_review";
  rowCount: number;
  readyRows: number;
  reviewRows: number;
  recommendedBottles: number;
  suggestedValue: number;
  currentReportRecommendedBottles: number;
  recommendedBottleDelta: number;
  rows: DatabaseOrderSummaryPreviewRow[];
};

export type DatabaseOrderSummaryPreviewData = {
  generatedAt: string;
  diagnosticOnly: true;
  referenceDate: string;
  latestInventorySnapshotAt: string | null;
  latestReportRun: ReportRunRow | null;
  summary: {
    activeQuickBooksProductRows: number;
    previewRows: number;
    readyRows: number;
    reviewRows: number;
    suppliers: number;
    recommendedBottles: number;
    suggestedValue: number;
    currentReportRecommendedBottles: number;
    recommendedBottleDelta: number;
    missingVinosmithAvailable: number;
    missingSupplierLogistics: number;
    missingAppMarkers: number;
    missingPackSize: number;
    missingFob: number;
  };
  suppliers: DatabaseOrderSummaryPreviewSupplier[];
  topChangedRows: DatabaseOrderSummaryPreviewRow[];
  warnings: string[];
};

const PAGE_SIZE = 1000;
const TXN_CHUNK_SIZE = 350;

export async function fetchDatabaseOrderSummaryPreview(
  supabase: PreviewClient
): Promise<DatabaseOrderSummaryPreviewData> {
  const [settings, latestReportRun] = await Promise.all([
    fetchPublishedOrderingSettings(supabase),
    fetchLatestReportRun(supabase)
  ]);
  const referenceDate = latestReportRun?.report_date || latestReportRun?.completed_at?.slice(0, 10) || todayKey();

  const [
    quickBooksItems,
    vinosmithWines,
    inventoryProof,
    suppliers,
    vendorMappings,
    markers,
    reportRecommendations
  ] = await Promise.all([
    fetchQuickBooksProductItems(supabase),
    fetchAll<VinosmithWineRow>(
      supabase,
      "vinosmith_wines",
      "wine_id,code,name,importer_name,active,orderable",
      "wine_id"
    ),
    fetchLatestVinosmithInventoryProof(supabase),
    fetchAll<SupplierRow>(
      supabase,
      "suppliers",
      "id,name,eta_days,pick_up_location,freight_forwarder,order_frequency,tdm,trucking_cost_per_bottle,active",
      "name"
    ),
    fetchAll<QuickBooksVendorMappingRow>(
      supabase,
      "quickbooks_vendor_mappings",
      "quickbooks_vendor_list_id,supplier_id,vendor_classification",
      "quickbooks_vendor_list_id"
    ),
    fetchOrderingItemMarkers(supabase),
    latestReportRun ? fetchReportRecommendations(supabase, latestReportRun.id) : Promise.resolve([])
  ]);

  const quickBooksCodeByListId = new Map<string, string>();
  const activeProductItems = quickBooksItems.filter((item) => {
    const code = normalizeCode(itemCodeFromQuickBooks(item));
    if (!isLikelyProductItemCode(code)) return false;
    if (item.is_active === false) return false;
    quickBooksCodeByListId.set(item.list_id, code);
    return true;
  });
  const winesByCode = firstByCode(vinosmithWines);
  const suppliersByName = new Map(suppliers.map((supplier) => [normalizeName(supplier.name), supplier]));
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const vendorMappingByVendorId = new Map(
    vendorMappings
      .filter((mapping) => mapping.vendor_classification === "inventory_wine" && mapping.supplier_id)
      .map((mapping) => [mapping.quickbooks_vendor_list_id, mapping])
  );
  const markersByCode = new Map(markers.map((marker) => [normalizeCode(marker.item_code), marker]));
  const reportQtyByCode = new Map(
    reportRecommendations
      .map((row) => [normalizeCode(row.product_code), Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)))] as const)
      .filter(([code]) => isLikelyProductItemCode(code))
  );
  const salesByCode = await fetchQuickBooksSalesWindowsByCode(supabase, quickBooksCodeByListId, referenceDate);

  const rows = activeProductItems.map((item) => {
    const itemCode = normalizeCode(itemCodeFromQuickBooks(item));
    const wine = winesByCode.get(itemCode) || null;
    const inventory = wine ? inventoryProof.byWineId.get(wine.wine_id) || null : null;
    const preferredVendorListId = preferredVendorListIdFromItem(item);
    const vendorMapping = preferredVendorListId ? vendorMappingByVendorId.get(preferredVendorListId) || null : null;
    const supplierFromQuickBooksVendor = vendorMapping?.supplier_id ? suppliersById.get(vendorMapping.supplier_id) || null : null;
    const supplierFromVinosmith = wine?.importer_name ? suppliersByName.get(normalizeName(wine.importer_name)) || null : null;
    const supplier = supplierFromQuickBooksVendor || supplierFromVinosmith;
    const supplierSource = supplierFromQuickBooksVendor
      ? "QuickBooks preferred vendor matched to Supplier Logistics"
      : supplierFromVinosmith
        ? "Vinosmith importer matched to Supplier Logistics"
        : wine?.importer_name
          ? "Vinosmith importer only"
          : preferredVendorListId
            ? "QuickBooks preferred vendor has no Supplier Logistics match"
            : "Missing";
    const marker = markersByCode.get(itemCode) || null;
    const sales = salesByCode.get(itemCode) || emptySalesWindows();
    return buildPreviewRow({
      item,
      itemCode,
      wine,
      inventory,
      supplier,
      preferredVendorListId,
      supplierSource,
      marker,
      sales,
      settings,
      currentReportRecommendedQty: reportQtyByCode.get(itemCode) ?? null,
      referenceDate
    });
  });

  const suppliersPreview = buildSupplierPreview(rows);
  const readyRows = rows.filter((row) => row.sourceStatus === "ready").length;
  const recommendedBottles = sum(rows, (row) => row.recommendedQty);
  const suggestedValue = sum(rows, (row) => row.landedCost);
  const currentReportRecommendedBottles = sum(rows, (row) => row.currentReportRecommendedQty ?? 0);

  return {
    generatedAt: new Date().toISOString(),
    diagnosticOnly: true,
    referenceDate,
    latestInventorySnapshotAt: inventoryProof.snapshotAt,
    latestReportRun,
    summary: {
      activeQuickBooksProductRows: activeProductItems.length,
      previewRows: rows.length,
      readyRows,
      reviewRows: rows.length - readyRows,
      suppliers: suppliersPreview.length,
      recommendedBottles,
      suggestedValue,
      currentReportRecommendedBottles,
      recommendedBottleDelta: recommendedBottles - currentReportRecommendedBottles,
      missingVinosmithAvailable: rows.filter((row) => row.blockers.includes("Missing Vinosmith Available")).length,
      missingSupplierLogistics: rows.filter((row) => row.blockers.includes("Missing Supplier Logistics")).length,
      missingAppMarkers: rows.filter((row) => row.blockers.includes("Missing app Core/BTG marker")).length,
      missingPackSize: rows.filter((row) => row.blockers.includes("Missing QuickBooks PACK SIZE")).length,
      missingFob: rows.filter((row) => row.blockers.includes("Missing QuickBooks FOB/cost")).length
    },
    suppliers: suppliersPreview,
    topChangedRows: rows
      .filter((row) => row.recommendedQtyDelta !== null && row.recommendedQtyDelta !== 0)
      .sort((a, b) => Math.abs(b.recommendedQtyDelta || 0) - Math.abs(a.recommendedQtyDelta || 0))
      .slice(0, 12),
    warnings: [
      "Diagnostic only: live Order Review still uses the current report-created recommendations.",
      "Preview inventory uses Vinosmith Available only. Hold, Future, and Pending Sync are shown as context but are not subtracted.",
      "Supplier grouping uses QuickBooks item preferred vendor when the latest item pull includes PrefVendorRef; otherwise it falls back to Vinosmith importer for testing.",
      "Old report anomalies should be ignored here unless the same item fails with current QB/Vinosmith/app-owned source fields."
    ]
  };
}

function buildPreviewRow({
  item,
  itemCode,
  wine,
  inventory,
  supplier,
  preferredVendorListId,
  supplierSource,
  marker,
  sales,
  settings,
  currentReportRecommendedQty,
  referenceDate
}: {
  item: QuickBooksItemRow;
  itemCode: string;
  wine: VinosmithWineRow | null;
  inventory: VinosmithInventoryProof | null;
  supplier: SupplierRow | null;
  preferredVendorListId: string | null;
  supplierSource: string;
  marker: OrderingItemMarkerRow | null;
  sales: SalesWindows;
  settings: OrderingLogicSettings;
  currentReportRecommendedQty: number | null;
  referenceDate: string;
}): DatabaseOrderSummaryPreviewRow {
  const blockers: string[] = [];
  if (!wine) blockers.push("Missing exact Vinosmith code");
  if (!inventory) blockers.push("Missing Vinosmith Available");
  if (!supplier) blockers.push("Missing Supplier Logistics");
  if (preferredVendorListId && !supplierSource.startsWith("QuickBooks preferred vendor")) {
    blockers.push("Preferred QB vendor is not mapped to Supplier Logistics");
  }
  if (!marker) blockers.push("Missing app Core/BTG marker");

  const packSizeProof = packSizeFromQuickBooks(item, settings);
  if (!packSizeProof.fromCustomField) blockers.push("Missing QuickBooks PACK SIZE");
  const fob = numberOrNull(item.purchase_cost) ?? numberOrNull(item.average_cost) ?? 0;
  if (fob <= 0) blockers.push("Missing QuickBooks FOB/cost");

  const quickBooksOnOrder = Math.max(0, asNumber(item.quantity_on_order));
  const vinosmithAvailable = Math.max(0, inventory?.available ?? 0);
  const weeklyVelocity = sales.last30 / 4.345;
  const weeksOnHand = weeklyVelocity > 0 ? roundNumber(vinosmithAvailable / weeklyVelocity, 2) : null;
  const weeksOnHandWithOnOrder =
    weeklyVelocity > 0 ? roundNumber((vinosmithAvailable + quickBooksOnOrder) / weeklyVelocity, 2) : null;
  const recommendedQty = recommendedQtyForRow({
    weeklyVelocity,
    trueAvailable: vinosmithAvailable,
    onOrder: quickBooksOnOrder,
    isBtg: marker?.is_btg === true,
    isCore: marker?.is_core === true,
    packSize: packSizeProof.packSize,
    settings,
    referenceDate
  });
  const truckingCost = Math.max(0, asNumber(supplier?.trucking_cost_per_bottle));
  const orderCost = recommendedQty * fob;
  const landedCost = recommendedQty * (fob + truckingCost);

  return {
    itemCode,
    productName: wine?.name || item.full_name || item.name || itemCode,
    supplierName: supplier?.name || wine?.importer_name || "Unknown Supplier",
    supplierSource,
    sourceStatus: blockers.length === 0 ? "ready" : "needs_review",
    blockers,
    quickBooksOnHand: asNumber(item.quantity_on_hand),
    quickBooksOnOrder,
    vinosmithAvailable,
    vinosmithHold: inventory?.hold ?? 0,
    vinosmithFuture: inventory?.future ?? 0,
    vinosmithPendingSync: inventory?.pendingSync ?? 0,
    fob,
    packSize: packSizeProof.packSize,
    packSizeSource: packSizeProof.source,
    truckingCostPerBottle: truckingCost,
    landedBottleCost: fob + truckingCost,
    sales30: sales.last30,
    sales60: sales.last60,
    sales90: sales.last90,
    prior30Sales: sales.prior30,
    next30DayForecast: sales.next30Ly,
    next60DayForecast: sales.next60Ly,
    next90DayForecast: sales.next90Ly,
    weeklyVelocity,
    weeksOnHand,
    weeksOnHandWithOnOrder,
    isBtg: marker?.is_btg === true,
    isCore: marker?.is_core === true,
    recommendedQty,
    currentReportRecommendedQty,
    recommendedQtyDelta: currentReportRecommendedQty === null ? null : recommendedQty - currentReportRecommendedQty,
    orderCost,
    landedCost,
    etaDays: supplier ? numberOrNull(supplier.eta_days) : null,
    tdm: supplier?.tdm || null,
    pickupLocation: supplier?.pick_up_location || null
  };
}

function buildSupplierPreview(rows: DatabaseOrderSummaryPreviewRow[]): DatabaseOrderSummaryPreviewSupplier[] {
  const grouped = new Map<string, DatabaseOrderSummaryPreviewRow[]>();
  rows.forEach((row) => {
    const group = grouped.get(row.supplierName) || [];
    group.push(row);
    grouped.set(row.supplierName, group);
  });

  return Array.from(grouped.entries())
    .map(([supplierName, supplierRows]) => {
      const recommendedBottles = sum(supplierRows, (row) => row.recommendedQty);
      const currentReportRecommendedBottles = sum(supplierRows, (row) => row.currentReportRecommendedQty ?? 0);
      const readyRows = supplierRows.filter((row) => row.sourceStatus === "ready").length;
      const sourceStatus: DatabaseOrderSummaryPreviewSupplier["sourceStatus"] =
        readyRows === supplierRows.length ? "ready" : "needs_review";
      return {
        supplierName,
        sourceStatus,
        rowCount: supplierRows.length,
        readyRows,
        reviewRows: supplierRows.length - readyRows,
        recommendedBottles,
        suggestedValue: sum(supplierRows, (row) => row.landedCost),
        currentReportRecommendedBottles,
        recommendedBottleDelta: recommendedBottles - currentReportRecommendedBottles,
        rows: supplierRows
          .sort((a, b) => b.recommendedQty - a.recommendedQty || b.sales30 - a.sales30 || a.productName.localeCompare(b.productName))
          .slice(0, 40)
      };
    })
    .sort((a, b) => b.suggestedValue - a.suggestedValue || a.supplierName.localeCompare(b.supplierName));
}

async function fetchPublishedOrderingSettings(supabase: PreviewClient) {
  const { data, error } = await supabase
    .from("configuration_versions")
    .select("values")
    .eq("domain", "ordering_logic")
    .eq("status", "published")
    .maybeSingle<{ values: Partial<OrderingLogicSettings> | null }>();

  if (error) throw new Error(error.message);
  return normalizeOrderingLogicSettings(data?.values || DEFAULT_ORDERING_LOGIC_SETTINGS);
}

async function fetchLatestReportRun(supabase: PreviewClient) {
  const { data, error } = await supabase
    .from("report_runs")
    .select("id,report_date,completed_at")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle<ReportRunRow>();

  if (error) throw new Error(error.message);
  return data || null;
}

async function fetchReportRecommendations(supabase: PreviewClient, reportRunId: string) {
  return fetchAll<ReportRecommendationRow>(
    supabase,
    "reorder_recommendations",
    "product_code,recommended_qty_rounded",
    "product_code",
    (query) => query.eq("report_run_id", reportRunId)
  );
}

async function fetchQuickBooksProductItems(supabase: PreviewClient) {
  return fetchAll<QuickBooksItemRow>(
    supabase,
    "quickbooks_items",
    "list_id,name,full_name,is_active,item_type,quantity_on_hand,quantity_on_order,purchase_cost,average_cost,custom_fields,raw_data",
    "full_name"
  );
}

async function fetchOrderingItemMarkers(supabase: PreviewClient) {
  try {
    return await fetchAll<OrderingItemMarkerRow>(
      supabase,
      "ordering_item_markers",
      "item_code,quickbooks_item_list_id,is_btg,is_core,marker_note,note_source",
      "item_code"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("ordering_item_markers")) return [];
    throw error;
  }
}

type VinosmithInventoryProof = {
  snapshotAt: string | null;
  available: number;
  hold: number;
  future: number;
  pendingSync: number;
};

async function fetchLatestVinosmithInventoryProof(supabase: PreviewClient) {
  const { data, error } = await supabase
    .from("vinosmith_inventory_snapshots")
    .select("snapshot_at")
    .not("snapshot_at", "is", null)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ snapshot_at: string | null }>();

  if (error) throw new Error(error.message);
  if (!data?.snapshot_at) return { snapshotAt: null, byWineId: new Map<string, VinosmithInventoryProof>() };

  const rows = await fetchAll<VinosmithInventorySnapshotRow>(
    supabase,
    "vinosmith_inventory_snapshots",
    "id,wine_id,snapshot_at,available,on_hold,on_future,on_pending_sync",
    "wine_id",
    (query) => query.eq("snapshot_at", data.snapshot_at)
  );

  return {
    snapshotAt: data.snapshot_at,
    byWineId: aggregateInventoryByWine(rows)
  };
}

async function fetchQuickBooksSalesWindowsByCode(
  supabase: PreviewClient,
  quickBooksCodeByListId: Map<string, string>,
  referenceDate: string
) {
  const minDate = minDateKey(addDays(referenceDate, -90), addDays(referenceDate, -365));
  const maxDate = referenceDate;
  const [invoices, creditMemos] = await Promise.all([
    fetchTransactionsForRange(supabase, "quickbooks_invoices", "txn_id,txn_date,is_void,is_pending", minDate, maxDate),
    fetchTransactionsForRange(supabase, "quickbooks_credit_memos", "txn_id,txn_date", minDate, maxDate)
  ]);
  const invoiceDateById = new Map(
    invoices
      .filter((row) => row.txn_date && row.is_void !== true && row.is_pending !== true)
      .map((row) => [row.txn_id, row.txn_date as string])
  );
  const creditMemoDateById = new Map(
    creditMemos
      .filter((row) => row.txn_date)
      .map((row) => [row.txn_id, row.txn_date as string])
  );

  const [invoiceLines, creditMemoLines] = await Promise.all([
    fetchLinesForTransactions(supabase, "quickbooks_invoice_lines", Array.from(invoiceDateById.keys())),
    fetchLinesForTransactions(supabase, "quickbooks_credit_memo_lines", Array.from(creditMemoDateById.keys()))
  ]);

  const salesByCode = new Map<string, SalesWindows>();
  applySalesLines(salesByCode, invoiceLines, invoiceDateById, quickBooksCodeByListId, referenceDate, 1);
  applySalesLines(salesByCode, creditMemoLines, creditMemoDateById, quickBooksCodeByListId, referenceDate, -1);
  return salesByCode;
}

function applySalesLines(
  salesByCode: Map<string, SalesWindows>,
  lines: QuickBooksLineRow[],
  dateByTxnId: Map<string, string>,
  quickBooksCodeByListId: Map<string, string>,
  referenceDate: string,
  sign: 1 | -1
) {
  for (const line of lines) {
    const txnDate = dateByTxnId.get(line.txn_id);
    if (!txnDate) continue;
    const code = codeForSalesLine(line, quickBooksCodeByListId);
    if (!code) continue;
    const qty = asNumber(line.quantity) * sign;
    const current = salesByCode.get(code) || emptySalesWindows();

    if (isInRange(txnDate, addDays(referenceDate, -30), referenceDate, true)) current.last30 += qty;
    if (isInRange(txnDate, addDays(referenceDate, -60), referenceDate, true)) current.last60 += qty;
    if (isInRange(txnDate, addDays(referenceDate, -90), referenceDate, true)) current.last90 += qty;
    if (isInRange(txnDate, addDays(referenceDate, -60), addDays(referenceDate, -30), false)) current.prior30 += qty;
    if (isInRange(txnDate, addDays(referenceDate, -365), addDays(referenceDate, -335), true)) current.next30Ly += qty;
    if (isInRange(txnDate, addDays(referenceDate, -365), addDays(referenceDate, -305), true)) current.next60Ly += qty;
    if (isInRange(txnDate, addDays(referenceDate, -365), addDays(referenceDate, -275), true)) current.next90Ly += qty;

    salesByCode.set(code, current);
  }
}

async function fetchTransactionsForRange(
  supabase: PreviewClient,
  table: string,
  columns: string,
  from: string,
  to: string
) {
  return fetchAll<QuickBooksTransactionRow>(
    supabase,
    table,
    columns,
    "txn_id",
    (query) => query.gte("txn_date", from).lte("txn_date", to)
  );
}

async function fetchLinesForTransactions(supabase: PreviewClient, table: string, txnIds: string[]) {
  const rows: QuickBooksLineRow[] = [];
  for (const chunk of chunks(unique(txnIds), TXN_CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<QuickBooksLineRow>(
        supabase,
        table,
        "txn_id,item_list_id,item_full_name,quantity",
        "txn_id",
        (query) => query.in("txn_id", chunk)
      ))
    );
  }
  return rows;
}

async function fetchAll<Row>(
  supabase: PreviewClient,
  table: string,
  columns: string,
  orderBy: string,
  refine?: (query: any) => any
) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (refine) query = refine(query);
    const { data, error } = await query.returns<Row[]>();
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function recommendedQtyForRow(input: {
  weeklyVelocity: number;
  trueAvailable: number;
  onOrder: number;
  isBtg: boolean;
  isCore: boolean;
  packSize: number;
  settings: OrderingLogicSettings;
  referenceDate: string;
}) {
  if (input.weeklyVelocity <= 0) return 0;
  const targetDays = input.isBtg
    ? input.settings.btg_target_days
    : input.isCore
      ? input.settings.core_target_days
      : input.settings.standard_target_days;
  const month = Number(input.referenceDate.slice(5, 7)) || new Date().getMonth() + 1;
  const multiplier = input.settings.monthly_mode_enabled
    ? input.settings.monthly_multipliers[String(month)]?.multiplier || 1
    : 1;
  const targetQty = input.weeklyVelocity * (targetDays / 7);
  const raw = Math.max(0, targetQty - (input.trueAvailable + input.onOrder)) * multiplier;
  if (raw <= 0) return 0;
  const preserveOnePack =
    (input.isBtg && input.settings.btg_round_sub_case_to_one_pack) ||
    (input.isCore && input.settings.core_round_sub_case_to_one_pack);
  const minimumStandardQty = input.settings.standard_minimum_packs * input.packSize;
  if (!preserveOnePack && raw < minimumStandardQty) return 0;
  return Math.ceil(raw / input.packSize) * input.packSize;
}

function aggregateInventoryByWine(rows: VinosmithInventorySnapshotRow[]) {
  const byWine = new Map<string, VinosmithInventoryProof>();
  for (const row of rows) {
    const current = byWine.get(row.wine_id) || {
      snapshotAt: row.snapshot_at,
      available: 0,
      hold: 0,
      future: 0,
      pendingSync: 0
    };
    current.available += asNumber(row.available);
    current.hold += asNumber(row.on_hold);
    current.future += asNumber(row.on_future);
    current.pendingSync += asNumber(row.on_pending_sync);
    byWine.set(row.wine_id, current);
  }
  return byWine;
}

function firstByCode(rows: VinosmithWineRow[]) {
  const byCode = new Map<string, VinosmithWineRow>();
  for (const row of rows) {
    const code = normalizeCode(row.code);
    if (!code || byCode.has(code)) continue;
    byCode.set(code, row);
  }
  return byCode;
}

function itemCodeFromQuickBooks(item: QuickBooksItemRow) {
  return textFromCustomFields(item.custom_fields, [
    "item_number",
    "itemNumber",
    "ItemNumber",
    "sku",
    "SKU",
    "product_code",
    "productCode",
    "ProductCode"
  ]) || item.name || item.full_name || item.list_id;
}

function preferredVendorListIdFromItem(item: QuickBooksItemRow) {
  const rawData = item.raw_data;
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const refValue = rawData.preferred_vendor_ref ?? rawData.pref_vendor_ref ?? rawData.PrefVendorRef;
  if (!refValue || typeof refValue !== "object" || Array.isArray(refValue)) return null;
  const refRecord = refValue as Record<string, unknown>;
  const listId = refRecord.ListID ?? refRecord.list_id ?? refRecord.value;
  return typeof listId === "string" && listId.trim() ? listId.trim() : null;
}

function textFromCustomFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const fields = value as Record<string, unknown>;
  const normalized = new Map<string, unknown>();
  for (const [key, fieldValue] of Object.entries(fields)) {
    normalized.set(normalizeCustomFieldKey(key), fieldValue);
  }

  for (const key of keys) {
    const direct = fields[key] ?? normalized.get(normalizeCustomFieldKey(key));
    const text = textFromCustomFieldValue(direct);
    if (text) return text;
  }

  return "";
}

function packSizeFromQuickBooks(item: QuickBooksItemRow, settings: OrderingLogicSettings) {
  const customFieldText = textFromCustomFields(item.custom_fields, [
    "PACK SIZE",
    "Pack Size",
    "pack_size",
    "packSize",
    "PackSize",
    "pack"
  ]);
  const fromCustomField = integerFromPackSizeText(customFieldText);
  if (fromCustomField !== null) {
    return { packSize: fromCustomField, source: "QB PACK SIZE", fromCustomField: true };
  }

  const fromName = integerFromPackSizeText(item.name || item.full_name || "");
  if (fromName !== null) return { packSize: fromName, source: "QB item name fallback", fromCustomField: false };
  return { packSize: settings.default_pack_size, source: "Logic default", fromCustomField: false };
}

function textFromCustomFieldValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value as Record<string, unknown>;
    const text = nested.value ?? nested.Value ?? nested.text ?? nested.Text ?? nested.DataExtValue;
    if (typeof text === "string" && text.trim()) return text.trim();
    if (typeof text === "number" && Number.isFinite(text)) return String(text);
  }
  return "";
}

function integerFromPackSizeText(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/(?:^|[^0-9])(\d{1,3})(?=\s*(?:\/|x|pk|pack|case|cs|btl|bottle|$))/i) || text.match(/^(\d{1,3})$/);
  const parsed = match ? Number(match[1]) : Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function codeForSalesLine(line: QuickBooksLineRow, quickBooksCodeByListId: Map<string, string>) {
  const byItemId = line.item_list_id ? quickBooksCodeByListId.get(line.item_list_id) : null;
  if (byItemId) return byItemId;
  const fromFullName = normalizeCode(line.item_full_name);
  return isLikelyProductItemCode(fromFullName) ? fromFullName : "";
}

function emptySalesWindows(): SalesWindows {
  return {
    last30: 0,
    last60: 0,
    last90: 0,
    prior30: 0,
    next30Ly: 0,
    next60Ly: 0,
    next90Ly: 0
  };
}

function isInRange(value: string, from: string, to: string, inclusiveEnd: boolean) {
  return value >= from && (inclusiveEnd ? value <= to : value < to);
}

function minDateKey(...values: string[]) {
  return values.sort()[0] || todayKey();
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCustomFieldKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isLikelyProductItemCode(value: string) {
  return /^[A-Z]{2,}\d{5,6}$/i.test(value.trim());
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNumber(value: number, digits: number) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function sum<Row>(rows: Row[], valueForRow: (row: Row) => number) {
  return rows.reduce((total, row) => total + valueForRow(row), 0);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
