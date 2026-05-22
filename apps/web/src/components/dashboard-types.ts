export type ActiveView = "order-review" | "supplier-hub" | "supplier-board" | "freight" | "po-drafts";

export const VIEW_LABELS: Array<{ id: ActiveView; label: string; hidden?: boolean }> = [
  { id: "order-review", label: "Order Review" },
  { id: "supplier-hub", label: "Supplier Hub" },
  { id: "supplier-board", label: "Supplier Board", hidden: true },
  { id: "freight", label: "Freight" },
  { id: "po-drafts", label: "PO Drafts" }
];

export const NAV_VIEW_LABELS = VIEW_LABELS.filter((view) => !view.hidden);

const VIEW_IDS = new Set(NAV_VIEW_LABELS.map((view) => view.id));

export function isActiveView(value: string | null): value is ActiveView {
  return Boolean(value && VIEW_IDS.has(value as ActiveView));
}
