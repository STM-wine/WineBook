import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asNumber } from "@/lib/order-data";
import { normalizeOrderingLogicSettings, type OrderingLogicSettings } from "@/lib/ordering-logic";
import type { Recommendation, ReportRun } from "@/lib/types";

type BridgeClient = SupabaseClient<any, "public", any>;

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
  last_seen_at: string | null;
};

type VinosmithWineRow = {
  wine_id: string;
  code: string | null;
  name: string | null;
  vintage: string | null;
  importer_name: string | null;
  producer_name: string | null;
  unit_set: number | string | null;
  active: boolean | null;
  orderable: boolean | null;
  core: boolean | null;
  inventory_item: boolean | null;
  last_seen_at: string | null;
};

type VinosmithInventorySnapshotRow = {
  id: string;
  wine_id: string;
  snapshot_at: string | null;
  available: number | string | null;
  on_hand: number | string | null;
  on_hold: number | string | null;
  on_order: number | string | null;
  on_future: number | string | null;
  on_pending_sync: number | string | null;
  raw_data: Record<string, unknown> | null;
};

type SupplierRow = {
  id: string;
  name: string;
  active: boolean | null;
  eta_days: number | string | null;
  pick_up_location: string | null;
  freight_forwarder: string | null;
  order_frequency: string | null;
  tdm: string | null;
  trucking_cost_per_bottle: number | string | null;
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

type SalesWindowTotals = {
  last30: number;
  last60: number;
  last90: number;
  prior30: number;
  next30Ly: number;
  next60Ly: number;
  next90Ly: number;
};

export type OrderingLogicBridgeInputRow = {
  itemCode: string;
  productName: string;
  supplierName: string;
  qbActive: boolean | null;
  vsStatus: "active" | "inactive" | "unknown" | "missing";
  qbOnHand: number | null;
  qbOnOrder: number | null;
  qbFob: number | null;
  vsAvailable: number | null;
  vsOnHold: number | null;
  vsOnFuture: number | null;
  vsPendingSync: number | null;
  vsUnconfirmedLineItemQty: number | null;
  sales: SalesWindowTotals;
  weeklyVelocity: number;
  packSize: number;
  isBtg: boolean;
  isCore: boolean;
  truckingCostPerBottle: number | null;
  etaDays: number | null;
  tdm: string | null;
  recommendedQtyRounded: number | null;
  blockers: string[];
};

export type OrderingLogicBridgeSupplierRow = {
  supplier: string;
  currentRows: number;
  proposedRows: number;
  matchedCodes: number;
  missingCurrentCodes: number;
  missingProposedCodes: number;
  salesDeltaAbs: number;
  onHandDeltaAbs: number;
  onOrderDeltaAbs: number;
  fobDeltaAbs: number;
  recommendedQtyDelta: number;
  blockingRows: number;
};

export type OrderingLogicBridgeDeltaRow = {
  itemCode: string;
  productName: string;
  supplierName: string;
  currentSales30: number;
  proposedSales30: number;
  currentOnHand: number;
  proposedOnHand: number | null;
  currentOnOrder: number;
  proposedOnOrder: number | null;
  currentFob: number;
  proposedFob: number | null;
  currentRecommendedQty: number;
  proposedRecommendedQty: number | null;
  largestDeltaLabel: string;
};

export type OrderingLogicBridgeBlockerRow = {
  itemCode: string;
  productName: string;
  supplierName: string;
  blockers: string[];
};

export type OrderingLogicBridgeSummary = {
  currentReportRows: number;
  proposedDatabaseRows: number;
  matchedItemCodes: number;
  missingCurrentRows: number;
  missingProposedRows: number;
  currentRowsWithoutUsableCode: number;
  proposedRowsWithBlockingInputs: number;
  suppliersWithBlockers: number;
  salesDeltaRows: number;
  onHandDeltaRows: number;
  onOrderDeltaRows: number;
  fobDeltaRows: number;
  recommendedQtyDeltaRows: number;
  currentRecommendedBottles: number;
  proposedRecommendedBottles: number;
  recommendedBottleDelta: number;
  currentEstimatedFob: number;
  proposedEstimatedFob: number;
  estimatedFobDelta: number;
};

export type OrderingLogicBridgeData = {
  generatedAt: string;
  diagnosticOnly: true;
  reportRun: ReportRun | null;
  referenceDate: string;
  salesHistoryFrom: string;
  warnings: string[];
  summary: OrderingLogicBridgeSummary;
  supplierRows: OrderingLogicBridgeSupplierRow[];
  deltaRows: OrderingLogicBridgeDeltaRow[];
  blockerRows: OrderingLogicBridgeBlockerRow[];
};

const PAGE_SIZE = 1000;
const TXN_CHUNK_SIZE = 400;
const SALES_HISTORY_FROM = "2025-01-01";

export async function fetchOrderingLogicBridgeData(supabase: BridgeClient): Promise<OrderingLogicBridgeData> {
  const { reportRun, recommendations } = await fetchLatestReportOutput(supabase);
  const referenceDate = reportRun?.report_date || reportRun?.completed_at?.slice(0, 10) || todayKey();
  const settings = normalizeOrderingLogicSettings(reportRun?.configuration_snapshot as Partial<OrderingLogicSettings> | null | undefined);

  const [
    quickBooksItems,
    vinosmithWines,
    suppliers
  ] = await Promise.all([
    fetchAll<QuickBooksItemRow>(supabase, "quickbooks_items", "list_id,name,full_name,is_active,item_type,quantity_on_hand,quantity_on_order,purchase_cost,average_cost,custom_fields,last_seen_at", "list_id"),
    fetchAll<VinosmithWineRow>(supabase, "vinosmith_wines", "wine_id,code,name,vintage,importer_name,producer_name,unit_set,active,orderable,core,inventory_item,last_seen_at", "wine_id"),
    fetchAll<SupplierRow>(supabase, "suppliers", "id,name,active,eta_days,pick_up_location,freight_forwarder,order_frequency,tdm,trucking_cost_per_bottle", "name")
  ]);

  const qbItemsWithCodes = quickBooksItems
    .map((item) => ({ item, itemCode: normalizeCode(itemCodeFromQuickBooks(item)) }))
    .filter(({ item, itemCode }) => item.is_active !== false && isLikelyProductItemCode(itemCode));
  const qbItemCodeByListId = new Map(qbItemsWithCodes.map(({ item, itemCode }) => [item.list_id, itemCode]));
  const [salesByCode, inventorySnapshots] = await Promise.all([
    fetchQuickBooksSalesByCode(supabase, qbItemCodeByListId, referenceDate),
    fetchLatestVinosmithInventorySnapshots(supabase)
  ]);
  const winesByCode = firstByCode(vinosmithWines);
  const inventoryByWineId = aggregateLatestInventoryByWine(inventorySnapshots);
  const suppliersByName = new Map(suppliers.map((supplier) => [normalizeKey(supplier.name), supplier]));

  const proposedRows = qbItemsWithCodes.map(({ item, itemCode }) => {
    const wine = winesByCode.get(itemCode) || null;
    const inventory = wine ? inventoryByWineId.get(wine.wine_id) || null : null;
    const supplier = wine?.importer_name ? suppliersByName.get(normalizeKey(wine.importer_name)) || null : null;
    return buildProposedRow({
      item,
      itemCode,
      wine,
      inventory,
      supplier,
      sales: salesByCode.get(itemCode) || emptySales(),
      settings,
      referenceDate
    });
  });

  return buildBridgeData({
    reportRun,
    recommendations,
    proposedRows,
    referenceDate
  });
}

async function fetchLatestReportOutput(supabase: BridgeClient) {
  const { data: reportRun, error: reportError } = await supabase
    .from("report_runs")
    .select("id,report_date,completed_at,diagnostics,configuration_version_id,configuration_snapshot")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle<ReportRun>();

  if (reportError) throw new Error(reportError.message);
  if (!reportRun) return { reportRun: null, recommendations: [] as Recommendation[] };

  const rows = await fetchAll<Recommendation>(
    supabase,
    "reorder_recommendations",
    `
      id,
      report_run_id,
      planning_sku,
      product_name,
      product_code,
      supplier_name,
      brand_manager,
      is_btg,
      is_core,
      last_30_day_sales,
      last_60_day_sales,
      last_90_day_sales,
      prior_30_day_sales,
      next_30_day_forecast,
      next_60_day_forecast,
      next_90_day_forecast,
      weekly_velocity,
      velocity_trend_pct,
      velocity_trend_label,
      weeks_on_hand,
      weeks_on_hand_with_on_order,
      true_available,
      on_order,
      recommended_qty_rounded,
      approved_qty,
      recommendation_status,
      reorder_status,
      risk_level,
      pickup_location,
      order_cost,
      fob,
      pack_size,
      trucking_cost_per_bottle,
      landed_cost
    `,
    "planning_sku",
    (query) => query.eq("report_run_id", reportRun.id)
  );

  return { reportRun, recommendations: rows };
}

async function fetchQuickBooksSalesByCode(
  supabase: BridgeClient,
  qbItemCodeByListId: Map<string, string>,
  referenceDate: string
) {
  const salesByCode = new Map<string, SalesWindowTotals>();
  const ranges = salesComparisonRanges(referenceDate);
  const [invoices, creditMemos] = await Promise.all([
    fetchTransactionsForRanges(supabase, "quickbooks_invoices", "txn_id,txn_date,is_void,is_pending", ranges),
    fetchTransactionsForRanges(supabase, "quickbooks_credit_memos", "txn_id,txn_date", ranges)
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

  applySalesLines(salesByCode, invoiceLines, invoiceDateById, qbItemCodeByListId, referenceDate, 1);
  applySalesLines(salesByCode, creditMemoLines, creditMemoDateById, qbItemCodeByListId, referenceDate, -1);
  return salesByCode;
}

async function fetchTransactionsForRanges(
  supabase: BridgeClient,
  table: string,
  columns: string,
  ranges: Array<{ from: string; to: string }>
) {
  const byId = new Map<string, QuickBooksTransactionRow>();
  for (const range of ranges) {
    const rows = await fetchAll<QuickBooksTransactionRow>(
      supabase,
      table,
      columns,
      "txn_id",
      (query) => query.gte("txn_date", range.from).lte("txn_date", range.to)
    );
    rows.forEach((row) => byId.set(row.txn_id, row));
  }
  return Array.from(byId.values());
}

async function fetchLatestVinosmithInventorySnapshots(supabase: BridgeClient) {
  const { data, error } = await supabase
    .from("vinosmith_inventory_snapshots")
    .select("snapshot_at")
    .not("snapshot_at", "is", null)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ snapshot_at: string | null }>();

  if (error) throw new Error(error.message);
  if (!data?.snapshot_at) return [];

  return fetchAll<VinosmithInventorySnapshotRow>(
    supabase,
    "vinosmith_inventory_snapshots",
    "id,wine_id,snapshot_at,available,on_hand,on_hold,on_order,on_future,on_pending_sync,raw_data",
    "wine_id",
    (query) => query.eq("snapshot_at", data.snapshot_at)
  );
}

async function fetchLinesForTransactions(supabase: BridgeClient, table: string, txnIds: string[]) {
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

function applySalesLines(
  salesByCode: Map<string, SalesWindowTotals>,
  lines: QuickBooksLineRow[],
  txnDateById: Map<string, string>,
  qbItemCodeByListId: Map<string, string>,
  referenceDate: string,
  sign: 1 | -1
) {
  for (const line of lines) {
    const txnDate = txnDateById.get(line.txn_id);
    if (!txnDate) continue;
    const code = codeForSalesLine(line, qbItemCodeByListId);
    if (!code) continue;
    const quantity = asNumber(line.quantity) * sign;
    if (quantity === 0) continue;
    const totals = salesByCode.get(code) || emptySales();
    if (withinTrailingWindow(txnDate, referenceDate, 30)) totals.last30 += quantity;
    if (withinTrailingWindow(txnDate, referenceDate, 60)) totals.last60 += quantity;
    if (withinTrailingWindow(txnDate, referenceDate, 90)) totals.last90 += quantity;
    if (withinPriorWindow(txnDate, referenceDate, 60, 30)) totals.prior30 += quantity;
    if (withinSameFutureWindowLastYear(txnDate, referenceDate, 30)) totals.next30Ly += quantity;
    if (withinSameFutureWindowLastYear(txnDate, referenceDate, 60)) totals.next60Ly += quantity;
    if (withinSameFutureWindowLastYear(txnDate, referenceDate, 90)) totals.next90Ly += quantity;
    salesByCode.set(code, totals);
  }
}

function buildProposedRow({
  item,
  itemCode,
  wine,
  inventory,
  supplier,
  sales,
  settings,
  referenceDate
}: {
  item: QuickBooksItemRow;
  itemCode: string;
  wine: VinosmithWineRow | null;
  inventory: AggregatedInventory | null;
  supplier: SupplierRow | null;
  sales: SalesWindowTotals;
  settings: OrderingLogicSettings;
  referenceDate: string;
}): OrderingLogicBridgeInputRow {
  const qbOnHand = numberOrNull(item.quantity_on_hand);
  const qbOnOrder = numberOrNull(item.quantity_on_order);
  const purchaseCost = numberOrNull(item.purchase_cost);
  const qbFob = purchaseCost ?? numberOrNull(item.average_cost);
  const truckingCostPerBottle = supplier ? numberOrNull(supplier.trucking_cost_per_bottle) : null;
  const etaDays = supplier ? numberOrNull(supplier.eta_days) : null;
  const isCore = Boolean(wine?.core) || boolFromCustomFields(item.custom_fields, ["is_core", "Is Core", "core"]);
  const isBtg = boolFromCustomFields(item.custom_fields, ["is_btg", "Is BTG", "btg"]);
  const packSize = Math.max(1, Math.round(numberOrNull(wine?.unit_set) || numberFromCustomFields(item.custom_fields, ["pack_size", "Pack Size"]) || settings.default_pack_size));
  const weeklyVelocity = sales.last30 / 4.345;
  const targetDays = isBtg ? settings.btg_target_days : isCore ? settings.core_target_days : settings.standard_target_days;
  const month = Number(referenceDate.slice(5, 7));
  const monthlyMultiplier = settings.monthly_mode_enabled ? settings.monthly_multipliers[String(month)]?.multiplier || 1 : 1;
  const recommendedQtyRounded = qbOnHand === null || qbOnOrder === null
    ? null
    : recommendedQuantity({
        weeklyVelocity,
        targetDays,
        qbOnHand,
        qbOnOrder,
        monthlyMultiplier,
        packSize,
        isBtg,
        isCore,
        settings
      });
  const blockers = blockersForProposedRow({ wine, inventory, supplier, qbOnHand, qbOnOrder, qbFob, truckingCostPerBottle, etaDays });

  return {
    itemCode,
    productName: wine?.name || item.full_name || item.name || itemCode,
    supplierName: wine?.importer_name || "Unknown Supplier",
    qbActive: item.is_active,
    vsStatus: vinosmithStatus(wine),
    qbOnHand,
    qbOnOrder,
    qbFob,
    vsAvailable: inventory?.available ?? null,
    vsOnHold: inventory?.onHold ?? null,
    vsOnFuture: inventory?.onFuture ?? null,
    vsPendingSync: inventory?.onPendingSync ?? null,
    vsUnconfirmedLineItemQty: inventory?.unconfirmedLineItemQty ?? null,
    sales,
    weeklyVelocity,
    packSize,
    isBtg,
    isCore,
    truckingCostPerBottle,
    etaDays,
    tdm: supplier?.tdm || null,
    recommendedQtyRounded,
    blockers
  };
}

function buildBridgeData({
  reportRun,
  recommendations,
  proposedRows,
  referenceDate
}: {
  reportRun: ReportRun | null;
  recommendations: Recommendation[];
  proposedRows: OrderingLogicBridgeInputRow[];
  referenceDate: string;
}): OrderingLogicBridgeData {
  const currentByCode = new Map<string, Recommendation>();
  let currentRowsWithoutUsableCode = 0;
  for (const row of recommendations) {
    const code = normalizeCode(row.product_code);
    if (!isLikelyProductItemCode(code)) {
      currentRowsWithoutUsableCode += 1;
      continue;
    }
    if (!currentByCode.has(code)) currentByCode.set(code, row);
  }
  const proposedByCode = new Map(proposedRows.map((row) => [row.itemCode, row]));
  const currentCodes = new Set(currentByCode.keys());
  const proposedCodes = new Set(proposedByCode.keys());
  const matchedCodes = Array.from(currentCodes).filter((code) => proposedCodes.has(code));
  const missingCurrentCodes = Array.from(proposedCodes).filter((code) => !currentCodes.has(code));
  const missingProposedCodes = Array.from(currentCodes).filter((code) => !proposedCodes.has(code));
  const deltaRows = matchedCodes
    .map((code) => deltaRowFor(code, currentByCode.get(code)!, proposedByCode.get(code)!))
    .sort((a, b) => deltaMagnitude(b) - deltaMagnitude(a))
    .slice(0, 12);
  const blockerRows = proposedRows
    .filter((row) => row.blockers.length > 0)
    .sort((a, b) => b.blockers.length - a.blockers.length || a.supplierName.localeCompare(b.supplierName) || a.itemCode.localeCompare(b.itemCode))
    .slice(0, 12)
    .map((row) => ({
      itemCode: row.itemCode,
      productName: row.productName,
      supplierName: row.supplierName,
      blockers: row.blockers
    }));
  const supplierRows = buildSupplierRows({ matchedCodes, missingCurrentCodes, missingProposedCodes, currentByCode, proposedByCode, proposedRows });
  const proposedRowsWithBlockingInputs = proposedRows.filter((row) => row.blockers.length > 0).length;
  const currentRecommendedBottles = sum(recommendations, (row) => asNumber(row.recommended_qty_rounded));
  const proposedRecommendedBottles = sum(proposedRows, (row) => row.recommendedQtyRounded || 0);
  const currentEstimatedFob = sum(recommendations, (row) => asNumber(row.recommended_qty_rounded) * asNumber(row.fob));
  const proposedEstimatedFob = sum(proposedRows, (row) => (row.recommendedQtyRounded || 0) * (row.qbFob || 0));
  const warnings = [
    "Diagnostic only: Order Review still uses the current report output.",
    "Database rows are matched by exact item code. Report rows without product_code are counted as blockers, not fuzzy-matched.",
    "Recommended quantity deltas are shadow calculations until supplier-by-supplier parity is reviewed."
  ];

  return {
    generatedAt: new Date().toISOString(),
    diagnosticOnly: true,
    reportRun,
    referenceDate,
    salesHistoryFrom: SALES_HISTORY_FROM,
    warnings,
    summary: {
      currentReportRows: recommendations.length,
      proposedDatabaseRows: proposedRows.length,
      matchedItemCodes: matchedCodes.length,
      missingCurrentRows: missingCurrentCodes.length,
      missingProposedRows: missingProposedCodes.length,
      currentRowsWithoutUsableCode,
      proposedRowsWithBlockingInputs,
      suppliersWithBlockers: new Set(proposedRows.filter((row) => row.blockers.length > 0).map((row) => row.supplierName)).size,
      salesDeltaRows: matchedCodes.filter((code) => Math.abs(asNumber(currentByCode.get(code)?.last_30_day_sales) - (proposedByCode.get(code)?.sales.last30 || 0)) >= 1).length,
      onHandDeltaRows: matchedCodes.filter((code) => Math.abs(asNumber(currentByCode.get(code)?.true_available) - (proposedByCode.get(code)?.qbOnHand || 0)) >= 1).length,
      onOrderDeltaRows: matchedCodes.filter((code) => Math.abs(asNumber(currentByCode.get(code)?.on_order) - (proposedByCode.get(code)?.qbOnOrder || 0)) >= 1).length,
      fobDeltaRows: matchedCodes.filter((code) => Math.abs(asNumber(currentByCode.get(code)?.fob) - (proposedByCode.get(code)?.qbFob || 0)) >= 0.01).length,
      recommendedQtyDeltaRows: matchedCodes.filter((code) => Math.abs(asNumber(currentByCode.get(code)?.recommended_qty_rounded) - (proposedByCode.get(code)?.recommendedQtyRounded || 0)) >= 1).length,
      currentRecommendedBottles,
      proposedRecommendedBottles,
      recommendedBottleDelta: proposedRecommendedBottles - currentRecommendedBottles,
      currentEstimatedFob,
      proposedEstimatedFob,
      estimatedFobDelta: proposedEstimatedFob - currentEstimatedFob
    },
    supplierRows,
    deltaRows,
    blockerRows
  };
}

function buildSupplierRows({
  matchedCodes,
  missingCurrentCodes,
  missingProposedCodes,
  currentByCode,
  proposedByCode,
  proposedRows
}: {
  matchedCodes: string[];
  missingCurrentCodes: string[];
  missingProposedCodes: string[];
  currentByCode: Map<string, Recommendation>;
  proposedByCode: Map<string, OrderingLogicBridgeInputRow>;
  proposedRows: OrderingLogicBridgeInputRow[];
}) {
  const rows = new Map<string, OrderingLogicBridgeSupplierRow>();
  const ensure = (supplier: string) => {
    const key = supplier || "Unknown Supplier";
    const existing = rows.get(key);
    if (existing) return existing;
    const next = {
      supplier: key,
      currentRows: 0,
      proposedRows: 0,
      matchedCodes: 0,
      missingCurrentCodes: 0,
      missingProposedCodes: 0,
      salesDeltaAbs: 0,
      onHandDeltaAbs: 0,
      onOrderDeltaAbs: 0,
      fobDeltaAbs: 0,
      recommendedQtyDelta: 0,
      blockingRows: 0
    };
    rows.set(key, next);
    return next;
  };

  for (const row of currentByCode.values()) ensure(row.supplier_name || "Unknown Supplier").currentRows += 1;
  for (const row of proposedRows) {
    const supplierRow = ensure(row.supplierName);
    supplierRow.proposedRows += 1;
    if (row.blockers.length > 0) supplierRow.blockingRows += 1;
  }
  for (const code of matchedCodes) {
    const current = currentByCode.get(code)!;
    const proposed = proposedByCode.get(code)!;
    const supplierRow = ensure(proposed.supplierName || current.supplier_name || "Unknown Supplier");
    supplierRow.matchedCodes += 1;
    supplierRow.salesDeltaAbs += Math.abs(asNumber(current.last_30_day_sales) - proposed.sales.last30);
    supplierRow.onHandDeltaAbs += Math.abs(asNumber(current.true_available) - (proposed.qbOnHand || 0));
    supplierRow.onOrderDeltaAbs += Math.abs(asNumber(current.on_order) - (proposed.qbOnOrder || 0));
    supplierRow.fobDeltaAbs += Math.abs(asNumber(current.fob) - (proposed.qbFob || 0));
    supplierRow.recommendedQtyDelta += (proposed.recommendedQtyRounded || 0) - asNumber(current.recommended_qty_rounded);
  }
  for (const code of missingCurrentCodes) ensure(proposedByCode.get(code)?.supplierName || "Unknown Supplier").missingCurrentCodes += 1;
  for (const code of missingProposedCodes) ensure(currentByCode.get(code)?.supplier_name || "Unknown Supplier").missingProposedCodes += 1;

  return Array.from(rows.values())
    .filter((row) => row.currentRows > 0 || row.proposedRows > 0 || row.blockingRows > 0)
    .sort((a, b) => b.blockingRows - a.blockingRows || b.missingCurrentCodes + b.missingProposedCodes - (a.missingCurrentCodes + a.missingProposedCodes) || a.supplier.localeCompare(b.supplier))
    .slice(0, 12);
}

function deltaRowFor(itemCode: string, current: Recommendation, proposed: OrderingLogicBridgeInputRow): OrderingLogicBridgeDeltaRow {
  const deltas = [
    { label: "Sales", value: Math.abs(asNumber(current.last_30_day_sales) - proposed.sales.last30) },
    { label: "On hand", value: Math.abs(asNumber(current.true_available) - (proposed.qbOnHand || 0)) },
    { label: "On order", value: Math.abs(asNumber(current.on_order) - (proposed.qbOnOrder || 0)) },
    { label: "FOB", value: Math.abs(asNumber(current.fob) - (proposed.qbFob || 0)) },
    { label: "Recommended qty", value: Math.abs(asNumber(current.recommended_qty_rounded) - (proposed.recommendedQtyRounded || 0)) }
  ].sort((a, b) => b.value - a.value);

  return {
    itemCode,
    productName: proposed.productName || current.product_name || itemCode,
    supplierName: proposed.supplierName || current.supplier_name || "Unknown Supplier",
    currentSales30: asNumber(current.last_30_day_sales),
    proposedSales30: proposed.sales.last30,
    currentOnHand: asNumber(current.true_available),
    proposedOnHand: proposed.qbOnHand,
    currentOnOrder: asNumber(current.on_order),
    proposedOnOrder: proposed.qbOnOrder,
    currentFob: asNumber(current.fob),
    proposedFob: proposed.qbFob,
    currentRecommendedQty: asNumber(current.recommended_qty_rounded),
    proposedRecommendedQty: proposed.recommendedQtyRounded,
    largestDeltaLabel: deltas[0]?.value ? deltas[0].label : "Matched"
  };
}

async function fetchAll<Row>(
  supabase: BridgeClient,
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

type AggregatedInventory = {
  snapshotAt: string | null;
  available: number;
  onHold: number;
  onFuture: number;
  onPendingSync: number;
  unconfirmedLineItemQty: number | null;
};

function aggregateLatestInventoryByWine(rows: VinosmithInventorySnapshotRow[]) {
  const byWine = new Map<string, VinosmithInventorySnapshotRow[]>();
  for (const row of rows) {
    const existing = byWine.get(row.wine_id) || [];
    existing.push(row);
    byWine.set(row.wine_id, existing);
  }

  const aggregated = new Map<string, AggregatedInventory>();
  for (const [wineId, wineRows] of byWine.entries()) {
    const latest = wineRows
      .map((row) => row.snapshot_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;
    const latestRows = latest ? wineRows.filter((row) => row.snapshot_at === latest) : wineRows;
    const unconfirmedValues = latestRows
      .map((row) => unconfirmedLineItemQtyFromRaw(row.raw_data))
      .filter((value): value is number => value !== null);
    aggregated.set(wineId, {
      snapshotAt: latest,
      available: sum(latestRows, (row) => asNumber(row.available)),
      onHold: sum(latestRows, (row) => asNumber(row.on_hold)),
      onFuture: sum(latestRows, (row) => asNumber(row.on_future)),
      onPendingSync: sum(latestRows, (row) => asNumber(row.on_pending_sync)),
      unconfirmedLineItemQty: unconfirmedValues.length ? sum(unconfirmedValues, (value) => value) : null
    });
  }
  return aggregated;
}

function blockersForProposedRow({
  wine,
  inventory,
  supplier,
  qbOnHand,
  qbOnOrder,
  qbFob,
  truckingCostPerBottle,
  etaDays
}: {
  wine: VinosmithWineRow | null;
  inventory: AggregatedInventory | null;
  supplier: SupplierRow | null;
  qbOnHand: number | null;
  qbOnOrder: number | null;
  qbFob: number | null;
  truckingCostPerBottle: number | null;
  etaDays: number | null;
}) {
  const blockers: string[] = [];
  if (!wine) blockers.push("No exact Vinosmith code match");
  if (wine && vinosmithStatus(wine) === "unknown") blockers.push("Vinosmith active/orderable status unknown");
  if (wine && vinosmithStatus(wine) === "inactive") blockers.push("Vinosmith not active/orderable");
  if (!inventory) blockers.push("No latest Vinosmith inventory snapshot");
  if (qbOnHand === null) blockers.push("Missing QB on hand");
  if (qbOnOrder === null) blockers.push("Missing QB on order");
  if (qbFob === null) blockers.push("Missing QB FOB/cost");
  if (!supplier) blockers.push("No exact Supplier Logistics match");
  if (supplier && truckingCostPerBottle === null) blockers.push("Missing laid-in/trucking cost");
  if (supplier && etaDays === null) blockers.push("Missing supplier ETA");
  return blockers;
}

function recommendedQuantity({
  weeklyVelocity,
  targetDays,
  qbOnHand,
  qbOnOrder,
  monthlyMultiplier,
  packSize,
  isBtg,
  isCore,
  settings
}: {
  weeklyVelocity: number;
  targetDays: number;
  qbOnHand: number;
  qbOnOrder: number;
  monthlyMultiplier: number;
  packSize: number;
  isBtg: boolean;
  isCore: boolean;
  settings: OrderingLogicSettings;
}) {
  const targetQty = weeklyVelocity * (targetDays / 7);
  const raw = Math.max(0, targetQty - (qbOnHand + qbOnOrder)) * monthlyMultiplier;
  if (raw <= 0) return 0;
  const preserveSubPack =
    (isBtg && settings.btg_round_sub_case_to_one_pack) ||
    (isCore && settings.core_round_sub_case_to_one_pack);
  const minimumQty = preserveSubPack ? 0 : settings.standard_minimum_packs * packSize;
  if (raw < minimumQty) return 0;
  return Math.ceil(raw / packSize) * packSize;
}

function codeForSalesLine(line: QuickBooksLineRow, qbItemCodeByListId: Map<string, string>) {
  const byItemId = line.item_list_id ? qbItemCodeByListId.get(line.item_list_id) : null;
  if (byItemId) return byItemId;
  const fromFullName = normalizeCode(line.item_full_name);
  return isLikelyProductItemCode(fromFullName) ? fromFullName : "";
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

function textFromCustomFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const fields = value as Record<string, unknown>;

  for (const key of keys) {
    const direct = fields[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (typeof direct === "number" && Number.isFinite(direct)) return String(direct);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      const nested = direct as Record<string, unknown>;
      const text = nested.value ?? nested.Value ?? nested.text ?? nested.Text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }

  return "";
}

function numberFromCustomFields(value: unknown, keys: string[]) {
  const text = textFromCustomFields(value, keys);
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolFromCustomFields(value: unknown, keys: string[]) {
  const text = textFromCustomFields(value, keys).toLowerCase();
  return text === "true" || text === "yes" || text === "1";
}

function unconfirmedLineItemQtyFromRaw(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const fields = value as Record<string, unknown>;
  const direct = numberFromKeys(fields, [
    "unconfirmed_line_item_qty",
    "unconfirmedLineItemQty",
    "unconfirmed_line_items",
    "unconfirmed"
  ]);
  if (direct !== null) return direct;
  const inventory = fields.inventory;
  return inventory && typeof inventory === "object" ? numberFromKeys(inventory as Record<string, unknown>, [
    "unconfirmed_line_item_qty",
    "unconfirmedLineItemQty",
    "unconfirmed_line_items",
    "unconfirmed"
  ]) : null;
}

function numberFromKeys(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const parsed = numberOrNull(fields[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function vinosmithStatus(wine: VinosmithWineRow | null): OrderingLogicBridgeInputRow["vsStatus"] {
  if (!wine) return "missing";
  if (wine.active === true || wine.orderable === true) return "active";
  if (wine.active === false || wine.orderable === false) return "inactive";
  return "unknown";
}

function emptySales(): SalesWindowTotals {
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

function withinTrailingWindow(txnDate: string, referenceDate: string, days: number) {
  return txnDate >= addDays(referenceDate, -days) && txnDate <= referenceDate;
}

function withinPriorWindow(txnDate: string, referenceDate: string, startDaysAgo: number, endDaysAgo: number) {
  return txnDate >= addDays(referenceDate, -startDaysAgo) && txnDate < addDays(referenceDate, -endDaysAgo);
}

function withinSameFutureWindowLastYear(txnDate: string, referenceDate: string, days: number) {
  return txnDate >= addDays(referenceDate, -365) && txnDate <= addDays(referenceDate, days - 365);
}

function salesComparisonRanges(referenceDate: string) {
  const trailingStart = addDays(referenceDate, -90);
  const lyStart = addDays(referenceDate, -365);
  const lyEnd = addDays(referenceDate, 90 - 365);
  return [
    { from: trailingStart, to: referenceDate },
    { from: lyStart, to: lyEnd }
  ];
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

function normalizeKey(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isLikelyProductItemCode(value: string) {
  return /^[A-Z]{2,}\d{5,6}$/i.test(value.trim());
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sum<Row>(rows: Row[], valueForRow: (row: Row) => number) {
  return rows.reduce((total, row) => total + valueForRow(row), 0);
}

function deltaMagnitude(row: OrderingLogicBridgeDeltaRow) {
  return Math.abs(row.currentRecommendedQty - (row.proposedRecommendedQty || 0)) * 10 +
    Math.abs(row.currentSales30 - row.proposedSales30) +
    Math.abs(row.currentOnHand - (row.proposedOnHand || 0)) +
    Math.abs(row.currentOnOrder - (row.proposedOnOrder || 0)) +
    Math.abs(row.currentFob - (row.proposedFob || 0));
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
