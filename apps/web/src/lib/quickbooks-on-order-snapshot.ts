export type QuickBooksOnOrderSnapshotRow = {
  item_list_id: string;
  quantity_on_order: number | string | null;
};

type SnapshotItem = {
  list_id: string;
  is_active: boolean | null;
  item_type?: string | null;
  quantity_on_order: number | string | null;
};

export function applyCompletedQuickBooksOnOrderSnapshot<Item extends SnapshotItem>(
  items: Item[],
  snapshots: QuickBooksOnOrderSnapshotRow[]
) {
  const onOrderByItemId = new Map(snapshots.map((row) => [row.item_list_id, row.quantity_on_order]));
  const itemIds = new Set(items.map((item) => item.list_id));
  const missingSnapshotItems = snapshots.filter((snapshot) => !itemIds.has(snapshot.item_list_id));
  if (missingSnapshotItems.length > 0) {
    throw new Error(`Completed QuickBooks item snapshot references ${missingSnapshotItems.length} items missing from the item mirror.`);
  }
  return items
    .filter((item) => onOrderByItemId.has(item.list_id))
    .map((item) => ({ ...item, quantity_on_order: onOrderByItemId.get(item.list_id) ?? null }));
}

export function assertCompletedQuickBooksSnapshotCount(expected: number | null, received: number) {
  if (expected === null) return;
  if (expected !== received) {
    throw new Error(`Completed QuickBooks item snapshot is incomplete (expected ${expected} items, received ${received}).`);
  }
}
