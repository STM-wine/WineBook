import { describe, expect, it } from "vitest";
import { approvalEventForRow, latestApprovalEvents, poDraftAuditTrail } from "./audit-trail";
import type { ApprovalEvent, PurchaseOrderDraftWithLines, Recommendation } from "./types";

describe("buyer activity audit trail", () => {
  it("selects the latest immutable approval event for a recommendation", () => {
    const events: ApprovalEvent[] = [
      { id: "a", report_run_id: "run", source_type: "recommendation", source_id: "rec", recommendation_status: "approved", approved_qty: 12, source_lock_version: 2, actor_id: "buyer-a", created_at: "2026-09-22T20:00:00Z" },
      { id: "b", report_run_id: "run", source_type: "recommendation", source_id: "rec", recommendation_status: "edited", approved_qty: 24, source_lock_version: 3, actor_id: "buyer-b", created_at: "2026-09-22T21:00:00Z" }
    ];
    const row = { id: "rec" } as Recommendation;

    expect(approvalEventForRow(row, latestApprovalEvents(events))?.id).toBe("b");
  });

  it("shows creation, latest revision, export, and status actor facts", () => {
    const draft = {
      id: "draft",
      report_run_id: "run",
      supplier_name: "Supplier",
      status: "entered_in_quickbooks",
      po_number: null,
      notes: null,
      created_by: "buyer-a",
      reviewed_by: "buyer-b",
      last_exported_by: "buyer-a",
      last_exported_at: "2026-09-22T21:30:00Z",
      created_at: "2026-09-22T20:00:00Z",
      updated_at: "2026-09-22T22:00:00Z",
      revisions: [
        { id: "r1", purchase_order_draft_id: "draft", revision_no: 1, created_by: "buyer-a", created_at: "2026-09-22T20:00:01Z" },
        { id: "r2", purchase_order_draft_id: "draft", revision_no: 2, created_by: "buyer-b", created_at: "2026-09-22T21:00:00Z" }
      ],
      lines: []
    } as PurchaseOrderDraftWithLines;

    expect(poDraftAuditTrail(draft, { "buyer-a": "Mark", "buyer-b": "Other Buyer" })).toEqual([
      { key: "created", label: "Created", actor: "Mark", at: "2026-09-22T20:00:00Z" },
      { key: "revised", label: "Revised (revision 2)", actor: "Other Buyer", at: "2026-09-22T21:00:00Z" },
      { key: "exported", label: "Exported", actor: "Mark", at: "2026-09-22T21:30:00Z" },
      { key: "status", label: "Entered in QuickBooks", actor: "Other Buyer", at: "2026-09-22T22:00:00Z" }
    ]);
  });
});
