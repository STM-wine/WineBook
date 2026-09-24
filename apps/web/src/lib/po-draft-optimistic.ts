import type { PurchaseOrderDraftWithLines } from "./types";

export function restoreOptimisticallyRemovedDrafts(
  current: PurchaseOrderDraftWithLines[],
  removed: PurchaseOrderDraftWithLines[],
  originalOrder: Map<string, number>
) {
  const presentIds = new Set(current.map((draft) => draft.id));
  return [
    ...current,
    ...removed.filter((draft) => !presentIds.has(draft.id))
  ].sort((left, right) =>
    (originalOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (originalOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
}
