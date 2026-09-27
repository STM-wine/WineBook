import "server-only";
import { buildOrderingSearchIndex } from "./ordering-summary-search";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrderingPageData, type OrderingPageData } from "./ordering-page-data";
import { applyApprovalCommitments, applySupplierTdmAssignments, enrichRecommendationsWithSupplierCatalogPrograms,
  mergeSupplierCatalogRows, applySupplierTargetWeeks, buildMetrics, buildSupplierGroups } from "./order-data";
import { applyDiContainerRecommendations } from "./di-planning";
import { buildFreightReadModel } from "./freight-read-model";
export function orderingReadKey(now = Date.now()) { return `active:${Math.floor(now / 300_000)}`; }
export const ORDERING_READ_FORMULA = "ordering-read-v3-upload-cutoff";
export async function buildOrderingSnapshot(db: SupabaseClient) {
  const data = await loadOrderingPageData("order-review", db);
  if (!data.latestRun) throw new Error("No completed ordering run is available.");
  if (!data.recommendations.length && data.orderingDataWarning) throw new Error(data.orderingDataWarning);
  const base = applyApprovalCommitments(applySupplierTdmAssignments(enrichRecommendationsWithSupplierCatalogPrograms(
    mergeSupplierCatalogRows(data.recommendations, data.supplierCatalogWines, data.latestRun.id), data.supplierCatalogWines
  ), data.suppliers), data.approvalCommitments);
  const display = applySupplierTargetWeeks(applyDiContainerRecommendations(base), {});
  const groups = buildSupplierGroups(display);
  const suppliers = groups.map((group) => {
    const recommendations = data.recommendations.filter((row) => (row.supplier_name?.trim() || "Unknown Supplier") === group.supplier);
    const catalog = data.supplierCatalogWines.filter((wine) => wine.supplier_name?.trim() === group.supplier);
    const ids = new Set([...recommendations.map((row) => row.id), ...recommendations.map((row) => row.supplier_catalog_workbench_item_id).filter(Boolean), ...catalog.flatMap((wine) => [wine.id, ...(wine.workbench_items || []).map((item) => item.id)])]);
    return { supplier: group.supplier, data: { ...data, reportRuns: [], recommendations,
      supplierCatalogWines: catalog, approvalEvents: data.approvalEvents.filter((event) => ids.has(event.source_id)),
      approvalCommitments: data.approvalCommitments.filter((event) => ids.has(event.source_id)) } satisfies OrderingPageData };
  });
  return {
    result: { searchIndex: buildOrderingSearchIndex(display), groups: groups.map(({ rows, ...summary }) => summary), metrics: buildMetrics(display),
      freight: buildFreightReadModel(display, data.suppliers), reportRun: data.latestRun,
      warning: data.orderingDataWarning, salesReferenceDate: data.salesReferenceDate,
      quickBooksLastSyncAt: data.quickBooksLastSyncAt, vinosmithLastSyncAt: data.vinosmithLastSyncAt,
      generatedAt: new Date().toISOString() },
    suppliers
  };
}
export type OrderingSnapshotSummary = Omit<Awaited<ReturnType<typeof buildOrderingSnapshot>>["result"], "searchIndex"> & { snapshotId: string; isStale?: boolean; filters?: import("./ordering-summary-search").OrderingSummaryFilters; filterOptions?: { suppliers: string[]; tdms: string[] } };
