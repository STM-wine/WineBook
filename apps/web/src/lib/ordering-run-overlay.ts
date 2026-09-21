import type { Recommendation } from "./types";
import { normalizeOrderingItemCode, ORDERING_BUILDER_VERSION, ORDERING_SOURCE } from "./source-backed-ordering";

type OrderingRunLike = {
  run_type?: string | null;
  diagnostics?: Record<string, any> | null;
};

export function isSourceBackedRun(run: OrderingRunLike | null | undefined) {
  return run?.run_type === "quickbooks_sync" && run.diagnostics?.ordering_source === ORDERING_SOURCE;
}

export function sourceRunNeedsCurrentOverlay(run: OrderingRunLike | null | undefined) {
  if (!isSourceBackedRun(run)) return false;
  const builderVersion = Number(run?.diagnostics?.builder_version);
  return !Number.isFinite(builderVersion) || builderVersion < ORDERING_BUILDER_VERSION;
}

export function overlayCurrentSourceRows(recommendations: Recommendation[], currentRows: Array<Record<string, any>>) {
  const currentByCode = new Map(currentRows.map((row) => [normalizeOrderingItemCode(row.product_code), row]));
  return recommendations.map((recommendation) => {
    const current = currentByCode.get(normalizeOrderingItemCode(recommendation.product_code));
    if (!current) return recommendation;
    return {
      ...recommendation,
      ...current,
      id: recommendation.id,
      report_run_id: recommendation.report_run_id,
      recommendation_status: recommendation.recommendation_status,
      approved_qty: recommendation.approved_qty,
      order_path: recommendation.order_path
    } as Recommendation;
  });
}
