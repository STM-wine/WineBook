import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSourceBackedOrderingData } from "./source-backed-ordering-server";
import type { SourceBackedRecommendationRow } from "./source-backed-ordering";

type PreviewClient = SupabaseClient<any, "public", any>;
type ReportRunRow = { id: string; report_date: string | null; completed_at: string | null };

export type DatabaseOrderSummaryPreviewRow = {
  itemCode: string; productName: string; supplierName: string; supplierSource: string;
  quickBooksPreferredVendorName: string | null; quickBooksPreferredVendorMapped: boolean;
  sourceStatus: "ready" | "needs_review"; blockers: string[]; quickBooksOnHand: number;
  quickBooksOnOrder: number; vinosmithAvailable: number; vinosmithHold: number; vinosmithFuture: number;
  vinosmithPendingSync: number; fob: number; packSize: number; packSizeSource: string;
  truckingCostPerBottle: number; landedBottleCost: number; sales30: number; sales60: number;
  sales90: number; prior30Sales: number; next30DayForecast: number; next60DayForecast: number;
  next90DayForecast: number; weeklyVelocity: number; weeksOnHand: number | null;
  weeksOnHandWithOnOrder: number | null; isBtg: boolean; isCore: boolean; recommendedQty: number;
  currentReportRecommendedQty: number | null; recommendedQtyDelta: number | null; orderCost: number;
  landedCost: number; etaDays: number | null; tdm: string | null; pickupLocation: string | null;
};

export type DatabaseOrderSummaryPreviewSupplier = {
  supplierName: string; sourceStatus: "ready" | "needs_review"; rowCount: number; readyRows: number;
  reviewRows: number; draftRowCount: number; databaseDraftLines: number; reportDraftLines: number;
  recommendedBottles: number; suggestedValue: number; currentReportRecommendedBottles: number;
  recommendedBottleDelta: number; suggestedValueDelta: number; rows: DatabaseOrderSummaryPreviewRow[];
  draftRows: DatabaseOrderSummaryPreviewRow[];
};

export type DatabaseOrderSummaryPreviewData = {
  generatedAt: string; diagnosticOnly: true; referenceDate: string; latestInventorySnapshotAt: string | null;
  latestReportRun: ReportRunRow | null;
  summary: {
    activeQuickBooksProductRows: number; previewRows: number; readyRows: number; reviewRows: number;
    suppliers: number; recommendedBottles: number; suggestedValue: number; currentReportRecommendedBottles: number;
    recommendedBottleDelta: number; missingVinosmithAvailable: number; missingSupplierLogistics: number;
    appCoreBtgTaggedRows: number; missingPackSize: number; missingFob: number; quickBooksPreferredVendorRows: number;
    quickBooksPreferredVendorMappedRows: number; unmappedQuickBooksPreferredVendorRows: number;
    vinosmithSupplierFallbackRows: number;
  };
  suppliers: DatabaseOrderSummaryPreviewSupplier[]; topChangedRows: DatabaseOrderSummaryPreviewRow[];
  topUnmappedPreferredVendorRows: DatabaseOrderSummaryPreviewRow[]; warnings: string[];
};

export async function fetchDatabaseOrderSummaryPreview(supabase: PreviewClient): Promise<DatabaseOrderSummaryPreviewData> {
  const [{ data: latestReportRun, error: runError }, built] = await Promise.all([
    supabase.from("report_runs").select("id,report_date,completed_at").eq("status", "completed")
      .neq("run_type", "quickbooks_sync").order("completed_at", { ascending: false }).limit(1).maybeSingle<ReportRunRow>(),
    fetchSourceBackedOrderingData(supabase)
  ]);
  if (runError) throw new Error(runError.message);

  const reportQtyByCode = new Map<string, number>();
  if (latestReportRun) {
    const { data, error } = await supabase.from("reorder_recommendations")
      .select("product_code,recommended_qty_rounded").eq("report_run_id", latestReportRun.id).range(0, 4999)
      .returns<Array<{ product_code: string | null; recommended_qty_rounded: number | string | null }>>();
    if (error) throw new Error(error.message);
    for (const row of data || []) reportQtyByCode.set(normalizeCode(row.product_code), Math.max(0, Math.round(number(row.recommended_qty_rounded))));
  }

  const rows = built.rows.map((row) => previewRow(row, reportQtyByCode.get(normalizeCode(row.product_code)) ?? null));
  const suppliers = supplierPreview(rows);
  const currentReportRecommendedBottles = sum(rows, (row) => row.currentReportRecommendedQty ?? 0);
  const recommendedBottles = sum(rows, (row) => row.recommendedQty);
  const preferredVendorRows = rows.filter((row) => row.quickBooksPreferredVendorName).length;
  const mappedVendorRows = rows.filter((row) => row.quickBooksPreferredVendorMapped).length;

  return {
    generatedAt: new Date().toISOString(), diagnosticOnly: true, referenceDate: built.diagnostics.reference_date,
    latestInventorySnapshotAt: built.diagnostics.vinosmith_available_as_of, latestReportRun: latestReportRun || null,
    summary: {
      activeQuickBooksProductRows: built.diagnostics.active_quickbooks_product_rows, previewRows: rows.length,
      readyRows: built.diagnostics.ready_rows, reviewRows: built.diagnostics.review_rows, suppliers: suppliers.length,
      recommendedBottles, suggestedValue: sum(rows, (row) => row.landedCost), currentReportRecommendedBottles,
      recommendedBottleDelta: recommendedBottles - currentReportRecommendedBottles,
      missingVinosmithAvailable: built.diagnostics.missing_vinosmith_available,
      missingSupplierLogistics: built.diagnostics.missing_supplier_mapping,
      appCoreBtgTaggedRows: built.diagnostics.core_btg_rows, missingPackSize: built.diagnostics.missing_pack_size,
      missingFob: built.diagnostics.missing_fob, quickBooksPreferredVendorRows: preferredVendorRows,
      quickBooksPreferredVendorMappedRows: mappedVendorRows,
      unmappedQuickBooksPreferredVendorRows: built.diagnostics.unmapped_preferred_vendor,
      vinosmithSupplierFallbackRows: rows.filter((row) => row.supplierSource === "vinosmith_importer_fallback").length
    },
    suppliers,
    topChangedRows: rows.filter((row) => row.recommendedQtyDelta).sort((a, b) => Math.abs(b.recommendedQtyDelta || 0) - Math.abs(a.recommendedQtyDelta || 0)).slice(0, 12),
    topUnmappedPreferredVendorRows: rows.filter((row) => row.quickBooksPreferredVendorName && !row.quickBooksPreferredVendorMapped).sort((a, b) => b.sales30 - a.sales30).slice(0, 30),
    warnings: [
      "Preview and source-backed runs use the same calculation engine.",
      "Vinosmith Get Available is the only ordering availability input; other inventory buckets are not substituted.",
      "QuickBooks preferred vendor is authoritative when present; an unmapped vendor remains visible for review.",
      "Core and BTG come from Stem ordering markers, and missing markers default to false."
    ]
  };
}

function previewRow(row: SourceBackedRecommendationRow, currentReportRecommendedQty: number | null): DatabaseOrderSummaryPreviewRow {
  const diagnostics = row.diagnostics;
  const blockers = (diagnostics.blockers as string[] | undefined) || [];
  const preferredVendorName = stringOrNull(diagnostics.quickbooks_preferred_vendor_name);
  return {
    itemCode: row.product_code, productName: row.product_name, supplierName: row.supplier_name,
    supplierSource: String(diagnostics.supplier_source || "missing"), quickBooksPreferredVendorName: preferredVendorName,
    quickBooksPreferredVendorMapped: diagnostics.supplier_source === "quickbooks_preferred_vendor",
    sourceStatus: blockers.length ? "needs_review" : "ready", blockers: blockers.map((blocker) => `Review: ${blocker.replaceAll("_", " ")}`),
    quickBooksOnHand: number(diagnostics.quickbooks_on_hand), quickBooksOnOrder: row.on_order,
    vinosmithAvailable: row.true_available, vinosmithHold: 0, vinosmithFuture: 0, vinosmithPendingSync: 0,
    fob: row.fob, packSize: row.pack_size, packSizeSource: String(diagnostics.pack_size_source || "missing"),
    truckingCostPerBottle: row.trucking_cost_per_bottle, landedBottleCost: row.fob + row.trucking_cost_per_bottle,
    sales30: row.last_30_day_sales, sales60: row.last_60_day_sales, sales90: row.last_90_day_sales,
    prior30Sales: row.prior_30_day_sales, next30DayForecast: row.next_30_day_forecast,
    next60DayForecast: row.next_60_day_forecast, next90DayForecast: row.next_90_day_forecast,
    weeklyVelocity: row.weekly_velocity, weeksOnHand: row.weeks_on_hand,
    weeksOnHandWithOnOrder: row.weeks_on_hand_with_on_order, isBtg: row.is_btg, isCore: row.is_core,
    recommendedQty: row.recommended_qty_rounded, currentReportRecommendedQty,
    recommendedQtyDelta: currentReportRecommendedQty === null ? null : row.recommended_qty_rounded - currentReportRecommendedQty,
    orderCost: row.order_cost, landedCost: row.landed_cost, etaDays: nullableNumber(diagnostics.supplier_eta_days),
    tdm: row.brand_manager, pickupLocation: row.pickup_location
  };
}

function supplierPreview(rows: DatabaseOrderSummaryPreviewRow[]): DatabaseOrderSummaryPreviewSupplier[] {
  const grouped = new Map<string, DatabaseOrderSummaryPreviewRow[]>();
  for (const row of rows) grouped.set(row.supplierName, [...(grouped.get(row.supplierName) || []), row]);
  return Array.from(grouped.entries()).map(([supplierName, supplierRows]) => {
    const recommended = sum(supplierRows, (row) => row.recommendedQty);
    const report = sum(supplierRows, (row) => row.currentReportRecommendedQty ?? 0);
    const ready = supplierRows.filter((row) => row.sourceStatus === "ready").length;
    const suggestedValue = sum(supplierRows, (row) => row.landedCost);
    const reportValue = sum(supplierRows, (row) => (row.currentReportRecommendedQty ?? 0) * row.landedBottleCost);
    const draftRows = supplierRows.filter((row) => row.recommendedQty > 0 || (row.currentReportRecommendedQty ?? 0) > 0);
    return {
      supplierName, sourceStatus: (ready === supplierRows.length ? "ready" : "needs_review") as "ready" | "needs_review", rowCount: supplierRows.length,
      readyRows: ready, reviewRows: supplierRows.length - ready, draftRowCount: draftRows.length,
      databaseDraftLines: supplierRows.filter((row) => row.recommendedQty > 0).length,
      reportDraftLines: supplierRows.filter((row) => (row.currentReportRecommendedQty ?? 0) > 0).length,
      recommendedBottles: recommended, suggestedValue, currentReportRecommendedBottles: report,
      recommendedBottleDelta: recommended - report, suggestedValueDelta: suggestedValue - reportValue,
      rows: [...supplierRows].sort((a, b) => b.recommendedQty - a.recommendedQty || b.sales30 - a.sales30).slice(0, 40), draftRows
    };
  }).sort((a, b) => b.suggestedValue - a.suggestedValue || a.supplierName.localeCompare(b.supplierName));
}

function normalizeCode(value: unknown) { return String(value || "").trim().toUpperCase(); }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function nullableNumber(value: unknown) { const parsed = Number(value); return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed; }
function stringOrNull(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function sum<Row>(rows: Row[], get: (row: Row) => number) { return rows.reduce((total, row) => total + get(row), 0); }
