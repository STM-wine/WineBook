import { describe, expect, it } from "vitest";
import { restoreOptimisticallyRemovedDrafts } from "./po-draft-optimistic";
import type { PurchaseOrderDraftWithLines } from "./types";

function draft(id: string, supplier: string): PurchaseOrderDraftWithLines {
  return {
    id,
    report_run_id: "run-1",
    supplier_name: supplier,
    order_path: "stateside",
    status: "draft",
    po_number: null,
    notes: null,
    revision_no: 1,
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:00Z",
    lines: []
  };
}

describe("optimistic PO draft cancellation", () => {
  it("restores a rejected cancellation in its original position", () => {
    const first = draft("draft-1", "First");
    const second = draft("draft-2", "Second");
    const third = draft("draft-3", "Third");

    expect(restoreOptimisticallyRemovedDrafts(
      [first, third],
      [second],
      new Map([[first.id, 0], [second.id, 1], [third.id, 2]])
    ).map((row) => row.id)).toEqual([first.id, second.id, third.id]);
  });

  it("does not duplicate a draft already restored by fresh server data", () => {
    const current = draft("draft-1", "Current");
    const stale = draft("draft-1", "Stale");

    const restored = restoreOptimisticallyRemovedDrafts(
      [current],
      [stale],
      new Map([[current.id, 0]])
    );

    expect(restored).toHaveLength(1);
    expect(restored[0].supplier_name).toBe("Current");
  });
});
