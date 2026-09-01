import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asNumber } from "@/lib/order-data";
import { fetchQuickBooksItemSalesWindows } from "@/lib/supabase/quickbooks-item-sales-windows";
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
};

type VinosmithWineRow = {
  wine_id: string;
  code: string | null;
  name: string | null;
  importer_name: string | null;
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

type VinosmithInventoryProof = {
  snapshotAt: string | null;
  available: number;
  hold: number;
  future: number;
  pendingSync: number;
};

export type OrderingLineItemTestRow = {
  itemCode: string;
  productName: string;
  supplierName: string;
  status: "ready" | "needs_qb_item" | "needs_vinosmith_inventory";
  notes: string[];
  reportTrueAvailable: number;
  vinosmithAvailable: number | null;
  vinosmithHold: number | null;
  vinosmithFuture: number | null;
  vinosmithPendingSync: number | null;
  reportOnOrder: number;
  quickBooksOnOrder: number | null;
  quickBooksOnHand: number | null;
  reportFob: number;
  quickBooksFob: number | null;
  reportPackSize: number;
  quickBooksPackSize: number | null;
  quickBooksPackSizeSource: string | null;
  reportSales30: number;
  quickBooksSales30: number;
  reportRecommendedQty: number;
  reportIsBtg: boolean;
  reportIsCore: boolean;
};

export type OrderingLogicBridgeData = {
  generatedAt: string;
  diagnosticOnly: true;
  reportRun: ReportRun | null;
  referenceDate: string;
  salesHistoryFrom: string;
  summary: {
    reportRows: number;
    testedRows: number;
    readyRows: number;
    missingQuickBooksRows: number;
    missingVinosmithInventoryRows: number;
    availableDeltaRows: number;
    salesDeltaRows: number;
    packSizeDeltaRows: number;
    missingQuickBooksPackSizeRows: number;
    markerPlaceholderRows: number;
  };
  lineRows: OrderingLineItemTestRow[];
  warnings: string[];
};

const PAGE_SIZE = 1000;
const SALES_HISTORY_FROM = "2025-01-01";

export async function fetchOrderingLogicBridgeData(supabase: BridgeClient): Promise<OrderingLogicBridgeData> {
  const { reportRun, recommendations } = await fetchLatestReportOutput(supabase);
  const referenceDate = reportRun?.report_date || reportRun?.completed_at?.slice(0, 10) || todayKey();
  const reportRows = recommendations.filter((row) => isLikelyProductItemCode(normalizeCode(row.product_code)));

  const [quickBooksItems, vinosmithWines, inventorySnapshots] = await Promise.all([
    fetchAll<QuickBooksItemRow>(
      supabase,
      "quickbooks_items",
      "list_id,name,full_name,is_active,item_type,quantity_on_hand,quantity_on_order,purchase_cost,average_cost,custom_fields",
      "list_id"
    ),
    fetchAll<VinosmithWineRow>(
      supabase,
      "vinosmith_wines",
      "wine_id,code,name,importer_name",
      "wine_id"
    ),
    fetchLatestVinosmithInventorySnapshots(supabase)
  ]);

  const quickBooksItemsByCode = new Map<string, QuickBooksItemRow>();
  const quickBooksCodeByListId = new Map<string, string>();
  for (const item of quickBooksItems) {
    const itemCode = normalizeCode(itemCodeFromQuickBooks(item));
    if (!isLikelyProductItemCode(itemCode) || item.is_active === false) continue;
    if (!quickBooksItemsByCode.has(itemCode)) quickBooksItemsByCode.set(itemCode, item);
    quickBooksCodeByListId.set(item.list_id, itemCode);
  }

  const winesByCode = firstByCode(vinosmithWines);
  const inventoryByWineId = aggregateLatestInventoryByWine(inventorySnapshots);
  const salesByCode = await fetchQuickBooksSalesByCode(supabase, quickBooksCodeByListId, referenceDate);

  const allLineRows = reportRows.map((reportRow) => {
    const itemCode = normalizeCode(reportRow.product_code);
    const wine = winesByCode.get(itemCode) || null;
    return buildLineItemTestRow({
      reportRow,
      quickBooksItem: quickBooksItemsByCode.get(itemCode) || null,
      wine,
      inventory: wine ? inventoryByWineId.get(wine.wine_id) || null : null,
      quickBooksSales30: salesByCode.get(itemCode) || 0
    });
  });

  const lineRows = allLineRows
    .sort((a, b) => statusSort(a.status) - statusSort(b.status) || Math.abs((b.vinosmithAvailable ?? 0) - b.reportTrueAvailable) - Math.abs((a.vinosmithAvailable ?? 0) - a.reportTrueAvailable))
    .slice(0, 80);

  return {
    generatedAt: new Date().toISOString(),
    diagnosticOnly: true,
    reportRun,
    referenceDate,
    salesHistoryFrom: SALES_HISTORY_FROM,
    summary: {
      reportRows: recommendations.length,
      testedRows: reportRows.length,
      readyRows: allLineRows.filter((row) => row.status === "ready").length,
      missingQuickBooksRows: allLineRows.filter((row) => row.status === "needs_qb_item").length,
      missingVinosmithInventoryRows: allLineRows.filter((row) => row.status === "needs_vinosmith_inventory").length,
      availableDeltaRows: allLineRows.filter((row) => row.vinosmithAvailable !== null && Math.abs(row.reportTrueAvailable - row.vinosmithAvailable) >= 1).length,
      salesDeltaRows: allLineRows.filter((row) => Math.abs(row.reportSales30 - row.quickBooksSales30) >= 1).length,
      packSizeDeltaRows: allLineRows.filter((row) => row.quickBooksPackSize !== null && row.reportPackSize !== row.quickBooksPackSize).length,
      missingQuickBooksPackSizeRows: allLineRows.filter((row) => row.status === "ready" && row.quickBooksPackSize === null).length,
      markerPlaceholderRows: reportRows.length
    },
    lineRows,
    warnings: [
      "Line-item test only: Order Review still uses the current report output.",
      "Vinosmith is only tested for live inventory overview fields. Available is the required API number for now.",
      "Pack size now comes from QuickBooks custom field PACK SIZE when present. Item-name parsing should only be a fallback.",
      "Core and BTG are shown from the current report as a temporary placeholder. The real next source of truth should be an app-owned marker table, seeded once and maintained in Stem.",
      "QuickBooks sales use invoice lines minus credit memo lines. Sales differences do not mean Vinosmith cleanup is needed."
    ]
  };
}

function buildLineItemTestRow({
  reportRow,
  quickBooksItem,
  wine,
  inventory,
  quickBooksSales30
}: {
  reportRow: Recommendation;
  quickBooksItem: QuickBooksItemRow | null;
  wine: VinosmithWineRow | null;
  inventory: VinosmithInventoryProof | null;
  quickBooksSales30: number;
}): OrderingLineItemTestRow {
  const notes: string[] = [];
  const packSizeProof = quickBooksItem ? packSizeFromQuickBooks(quickBooksItem) : null;
  if (!quickBooksItem) notes.push("No active QuickBooks item by exact item code");
  if (!wine) notes.push("No Vinosmith wine by exact item code");
  if (wine && !inventory) notes.push("No latest Vinosmith inventory snapshot");
  if (quickBooksItem && !packSizeProof) notes.push("No QuickBooks PACK SIZE custom field");
  notes.push("DB Order Summary Preview uses app-owned Core/BTG markers; this legacy line-item bridge keeps report context for comparison.");

  return {
    itemCode: normalizeCode(reportRow.product_code),
    productName: reportRow.product_name || wine?.name || normalizeCode(reportRow.product_code),
    supplierName: reportRow.supplier_name || wine?.importer_name || "Unknown Supplier",
    status: !quickBooksItem ? "needs_qb_item" : !inventory ? "needs_vinosmith_inventory" : "ready",
    notes,
    reportTrueAvailable: asNumber(reportRow.true_available),
    vinosmithAvailable: inventory?.available ?? null,
    vinosmithHold: inventory?.hold ?? null,
    vinosmithFuture: inventory?.future ?? null,
    vinosmithPendingSync: inventory?.pendingSync ?? null,
    reportOnOrder: asNumber(reportRow.on_order),
    quickBooksOnOrder: quickBooksItem ? numberOrNull(quickBooksItem.quantity_on_order) : null,
    quickBooksOnHand: quickBooksItem ? numberOrNull(quickBooksItem.quantity_on_hand) : null,
    reportFob: asNumber(reportRow.fob),
    quickBooksFob: quickBooksItem ? numberOrNull(quickBooksItem.purchase_cost) ?? numberOrNull(quickBooksItem.average_cost) : null,
    reportPackSize: Math.max(1, Math.round(asNumber(reportRow.pack_size) || 12)),
    quickBooksPackSize: packSizeProof?.packSize ?? null,
    quickBooksPackSizeSource: packSizeProof?.source ?? null,
    reportSales30: asNumber(reportRow.last_30_day_sales),
    quickBooksSales30,
    reportRecommendedQty: asNumber(reportRow.recommended_qty_rounded),
    reportIsBtg: reportRow.is_btg === true,
    reportIsCore: reportRow.is_core === true
  };
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
      is_btg,
      is_core,
      last_30_day_sales,
      true_available,
      on_order,
      recommended_qty_rounded,
      fob,
      pack_size
    `,
    "planning_sku",
    (query) => query.eq("report_run_id", reportRun.id)
  );

  return { reportRun, recommendations: rows };
}

async function fetchQuickBooksSalesByCode(
  supabase: BridgeClient,
  quickBooksCodeByListId: Map<string, string>,
  referenceDate: string
) {
  const salesByCode = new Map<string, number>();
  const rows = await fetchQuickBooksItemSalesWindows(supabase, referenceDate);
  for (const row of rows) {
    const code = normalizeCode(quickBooksCodeByListId.get(row.item_list_id || "") || row.item_full_name || "");
    if (!code) continue;
    salesByCode.set(code, (salesByCode.get(code) || 0) + asNumber(row.last_30_quantity));
  }
  return salesByCode;
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
    "id,wine_id,snapshot_at,available,on_hold,on_future,on_pending_sync",
    "wine_id",
    (query) => query.eq("snapshot_at", data.snapshot_at)
  );
}


function aggregateLatestInventoryByWine(rows: VinosmithInventorySnapshotRow[]) {
  const byWine = new Map<string, VinosmithInventorySnapshotRow[]>();
  for (const row of rows) {
    const existing = byWine.get(row.wine_id) || [];
    existing.push(row);
    byWine.set(row.wine_id, existing);
  }

  const aggregated = new Map<string, VinosmithInventoryProof>();
  for (const [wineId, wineRows] of byWine.entries()) {
    const latest = wineRows
      .map((row) => row.snapshot_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;
    const latestRows = latest ? wineRows.filter((row) => row.snapshot_at === latest) : wineRows;
    aggregated.set(wineId, {
      snapshotAt: latest,
      available: sum(latestRows, (row) => asNumber(row.available)),
      hold: sum(latestRows, (row) => asNumber(row.on_hold)),
      future: sum(latestRows, (row) => asNumber(row.on_future)),
      pendingSync: sum(latestRows, (row) => asNumber(row.on_pending_sync))
    });
  }
  return aggregated;
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

function packSizeFromQuickBooks(item: QuickBooksItemRow) {
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
    return { packSize: fromCustomField, source: "QB custom field PACK SIZE" };
  }

  const fromName = integerFromPackSizeText(item.name || item.full_name || "");
  if (fromName !== null) return { packSize: fromName, source: "QB item name fallback" };
  return null;
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

function normalizeCustomFieldKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function statusSort(status: OrderingLineItemTestRow["status"]) {
  if (status === "needs_qb_item") return 0;
  if (status === "needs_vinosmith_inventory") return 1;
  return 2;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
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
