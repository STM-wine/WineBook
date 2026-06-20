export const ACTIVE_PO_STATUSES = ["draft", "ready_for_entry"] as const;
export const VALID_PO_STATUSES = ["draft", "ready_for_entry", "entered_in_quickbooks", "cancelled"] as const;

export type ActivePoStatus = (typeof ACTIVE_PO_STATUSES)[number];
export type PurchaseOrderDraftStatus = (typeof VALID_PO_STATUSES)[number];

export function isActivePoStatus(status: string | null | undefined): status is ActivePoStatus {
  return ACTIVE_PO_STATUSES.includes(status as ActivePoStatus);
}

export function isValidPoStatus(status: string | null | undefined): status is PurchaseOrderDraftStatus {
  return VALID_PO_STATUSES.includes(status as PurchaseOrderDraftStatus);
}
