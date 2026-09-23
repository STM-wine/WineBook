import type { ApprovalEvent, PurchaseOrderDraftWithLines, Recommendation } from "./types";

export type AuditActorNames = Record<string, string>;

export type AuditTrailItem = {
  key: string;
  label: string;
  actor: string;
  at: string;
};

export function formatAuditTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date)} MST`;
}

export function auditActorName(actorId: string | null | undefined, actorNames: AuditActorNames) {
  return actorId ? actorNames[actorId] || "Unknown user" : "Unknown user";
}

export function latestApprovalEvents(events: ApprovalEvent[]) {
  const bySource = new Map<string, ApprovalEvent>();
  for (const event of [...events].sort((a, b) =>
    b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
  )) {
    const key = `${event.source_type}:${event.source_id}`;
    if (!bySource.has(key)) bySource.set(key, event);
  }
  return bySource;
}

export function approvalEventForRow(row: Recommendation, events: Map<string, ApprovalEvent>) {
  const key = row.supplier_catalog_workbench_item_id
    ? `catalog_workbench:${row.supplier_catalog_workbench_item_id}`
    : `recommendation:${row.id}`;
  return events.get(key) || null;
}

export function approvalEventLabel(event: ApprovalEvent) {
  const label = event.recommendation_status === "approved"
    ? "Approved"
    : event.recommendation_status === "edited"
      ? "Edited"
      : event.recommendation_status === "deferred"
        ? "Deferred"
        : "Rejected";
  const quantity = Number(event.approved_qty);
  return Number.isFinite(quantity) && quantity !== 0 ? `${label} ${quantity.toLocaleString()}` : label;
}

export function poDraftAuditTrail(draft: PurchaseOrderDraftWithLines, actorNames: AuditActorNames): AuditTrailItem[] {
  const items: AuditTrailItem[] = [{
    key: "created",
    label: "Created",
    actor: auditActorName(draft.created_by, actorNames),
    at: draft.created_at
  }];
  const latestRevision = [...(draft.revisions || [])]
    .sort((a, b) => Number(b.revision_no) - Number(a.revision_no))[0];

  if (latestRevision && Number(latestRevision.revision_no) > 1) {
    items.push({
      key: "revised",
      label: `Revised (revision ${Number(latestRevision.revision_no).toLocaleString()})`,
      actor: auditActorName(latestRevision.created_by, actorNames),
      at: latestRevision.created_at
    });
  }
  if (draft.last_exported_at) {
    items.push({
      key: "exported",
      label: "Exported",
      actor: auditActorName(draft.last_exported_by, actorNames),
      at: draft.last_exported_at
    });
  }

  const statusLabel = draft.status === "ready_for_entry"
    ? "Marked ready"
    : draft.status === "entered_in_quickbooks"
      ? "Entered in QuickBooks"
      : draft.status === "cancelled"
        ? "Cancelled"
        : null;
  if (statusLabel) {
    items.push({
      key: "status",
      label: statusLabel,
      actor: auditActorName(draft.reviewed_by, actorNames),
      at: draft.updated_at
    });
  }
  return items;
}
