export type ActiveView =
  | "company-dashboard"
  | "product-workspace"
  | "order-review"
  | "database-order-preview"
  | "supplier-hub"
  | "vinosmith-rescue"
  | "supplier-board"
  | "freight"
  | "po-drafts";

export const DEFAULT_VIEW: ActiveView = "company-dashboard";
export const PRODUCTS_DEFAULT_VIEW: ActiveView = "order-review";

export const VIEW_LABELS: Array<{ id: ActiveView; label: string; hidden?: boolean }> = [
  { id: "company-dashboard", label: "Home" },
  { id: "order-review", label: "Order Summary" },
  { id: "product-workspace", label: "Items" },
  { id: "database-order-preview", label: "DB Order Preview" },
  { id: "supplier-hub", label: "Supplier Hub" },
  { id: "vinosmith-rescue", label: "Vinosmith Plumbing", hidden: true },
  { id: "supplier-board", label: "Supplier Board", hidden: true },
  { id: "freight", label: "Freight" },
  { id: "po-drafts", label: "PO Drafts" }
];

const VIEW_IDS = new Set(VIEW_LABELS.map((view) => view.id));

export function isActiveView(value: string | null): value is ActiveView {
  return Boolean(value && VIEW_IDS.has(value as ActiveView));
}
