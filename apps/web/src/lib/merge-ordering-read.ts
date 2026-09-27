import type { Recommendation } from "./types";
import { approvalProcessingPatch } from "./order-data";
export function approvalEditorKey(row: Recommendation) {
  return row.supplier_catalog_wine_id ? `catalog:${row.supplier_catalog_wine_id}` : `recommendation:${row.id}`;
}
export function mergeOrderingRead(current: Recommendation[], incoming: Recommendation[], dirtyKeys: ReadonlySet<string>): Recommendation[] {
  const byKey = new Map(current.map((row) => [approvalEditorKey(row), row]));
  const result = incoming.map((row) => {
    const key = approvalEditorKey(row);
    const local = byKey.get(key);
    if (!local || !dirtyKeys.has(key)) return row;
    const preserved = { ...row, recommendation_status: local.recommendation_status, approved_qty: local.approved_qty, order_path: local.order_path };
    return { ...preserved, ...approvalProcessingPatch(preserved, preserved.recommendation_status, preserved.approved_qty) };
  });
  // A disappearing source row must not erase an unsaved decision. Its next save
  // still passes through the database's not-found/version conflict checks.
  const incomingKeys = new Set(incoming.map(approvalEditorKey));
  return [...result, ...current.filter((row) => dirtyKeys.has(approvalEditorKey(row)) && !incomingKeys.has(approvalEditorKey(row)))];
}
