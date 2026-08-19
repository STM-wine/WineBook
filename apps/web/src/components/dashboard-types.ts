export type ActiveView =
  | "company-dashboard"
  | "product-workspace"
  | "order-review"
  | "database-order-preview"
  | "supplier-hub"
  | "vinosmith-rescue"
  | "supplier-board"
  | "freight"
  | "po-drafts"
  | "quickbooks-items";

export const DEFAULT_VIEW: ActiveView = "company-dashboard";

export const VIEW_LABELS: Array<{ id: ActiveView; label: string; hidden?: boolean; requiresSettings?: boolean }> = [
  { id: "company-dashboard", label: "Home" },
  { id: "product-workspace", label: "Items" },
  { id: "order-review", label: "Order Review" },
  { id: "database-order-preview", label: "DB Order Preview" },
  { id: "supplier-hub", label: "Supplier Hub" },
  { id: "vinosmith-rescue", label: "Vinosmith Plumbing", hidden: true },
  { id: "supplier-board", label: "Supplier Board", hidden: true },
  { id: "freight", label: "Freight" },
  { id: "po-drafts", label: "PO Drafts" },
  { id: "quickbooks-items", label: "QB Diagnostics", requiresSettings: true }
];

export const NAV_VIEW_LABELS = VIEW_LABELS.filter((view) => !view.hidden);

const VIEW_IDS = new Set(VIEW_LABELS.map((view) => view.id));

export function isActiveView(value: string | null): value is ActiveView {
  return Boolean(value && VIEW_IDS.has(value as ActiveView));
}
