import { asNumber } from "./order-data";
import type { Recommendation, SupplierLogistics } from "./types";

export type OrderingSourceKind = "report" | "database";

export function buildOrderingLineSourceSnapshot(input: {
  row: Recommendation; reportRunId: string; approvedQty: number; recommendedQty: number; trucking: number;
  orderingSource: OrderingSourceKind; vinosmithAvailableAsOf: string; runDiagnostics: Record<string, unknown> | null;
}) {
  const { row, reportRunId, approvedQty, recommendedQty, trucking, orderingSource, vinosmithAvailableAsOf, runDiagnostics } = input;
  return {
    ordering_source: orderingSource,
    source_systems: orderingSource === "database" ? ["quickbooks", "vinosmith_available", "stem"] : ["legacy_report", "quickbooks", "vinosmith_available"],
    report_run_id: reportRunId, recommendation_id: row.supplier_catalog_wine_id ? null : row.id,
    supplier_catalog_wine_id: row.supplier_catalog_wine_id || null, recommendation_status: row.recommendation_status || null,
    approved_qty: approvedQty, recommended_qty: recommendedQty, product_code: row.product_code, planning_sku: row.planning_sku,
    true_available: asNumber(row.true_available), on_order: asNumber(row.on_order), last_30_day_sales: asNumber(row.last_30_day_sales),
    last_60_day_sales: asNumber(row.last_60_day_sales), last_90_day_sales: asNumber(row.last_90_day_sales),
    next_30_day_forecast: asNumber(row.next_30_day_forecast), next_60_day_forecast: asNumber(row.next_60_day_forecast),
    next_90_day_forecast: asNumber(row.next_90_day_forecast), weekly_velocity: asNumber(row.weekly_velocity),
    weeks_on_hand: asNumber(row.weeks_on_hand), weeks_on_hand_with_on_order: asNumber(row.weeks_on_hand_with_on_order),
    fob: asNumber(row.fob), pack_size: asNumber(row.pack_size), trucking_cost_per_bottle: trucking,
    is_core: Boolean(row.is_core), is_btg: Boolean(row.is_btg), order_path: row.order_path || "stateside",
    quickbooks_as_of: row.diagnostics?.quickbooks_item_as_of || runDiagnostics?.quickbooks_as_of || null,
    vinosmith_available_as_of: vinosmithAvailableAsOf, source_row_diagnostics: row.diagnostics || null
  };
}

export function buildOrderingDraftSourceSnapshot(input: {
  supplier: string; reportRunId: string; path: "stateside" | "di"; metadata: SupplierLogistics | undefined;
  lines: Array<{ recommended_qty: number; approved_qty: number; wine_cost: number; laid_in_cost: number; landed_cost: number }>;
  orderingSource: OrderingSourceKind; vinosmithAvailableAsOf: string; runDiagnostics: Record<string, unknown> | null;
}) {
  const { supplier, reportRunId, path, metadata, lines, orderingSource, vinosmithAvailableAsOf, runDiagnostics } = input;
  return {
    ordering_source: orderingSource, quickbooks_as_of: runDiagnostics?.quickbooks_as_of || null,
    vinosmith_available_as_of: vinosmithAvailableAsOf, report_run_id: reportRunId, supplier_name: supplier, order_path: path,
    supplier_logistics: {
      trucking_cost_per_bottle: asNumber(metadata?.trucking_cost_per_bottle), pick_up_location: metadata?.pick_up_location || null,
      eta_days: metadata?.eta_days || null, freight_forwarder: metadata?.freight_forwarder || null, tdm: metadata?.tdm || null
    },
    totals: {
      lines: lines.length, recommended_qty: lines.reduce((sum, line) => sum + line.recommended_qty, 0),
      approved_qty: lines.reduce((sum, line) => sum + line.approved_qty, 0), wine_cost: lines.reduce((sum, line) => sum + line.wine_cost, 0),
      laid_in_cost: lines.reduce((sum, line) => sum + line.laid_in_cost, 0), landed_cost: lines.reduce((sum, line) => sum + line.landed_cost, 0)
    }
  };
}
