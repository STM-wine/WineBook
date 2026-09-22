import { describe, expect, it } from "vitest";
import {
  applyCompletedQuickBooksOnOrderSnapshot,
  assertCompletedQuickBooksSnapshotCount
} from "./quickbooks-on-order-snapshot";

describe("completed QuickBooks on-order snapshots", () => {
  it("keeps the last completed snapshot authoritative over a partially updated live item table", () => {
    const items = [{
      list_id: "violet-hill",
      is_active: true,
      item_type: "Inventory",
      quantity_on_order: 120,
      name: "VS000476"
    }, {
      list_id: "partial-new-item",
      is_active: true,
      item_type: "Inventory",
      quantity_on_order: 24,
      name: "SHOULD-NOT-BE-VISIBLE"
    }];

    expect(applyCompletedQuickBooksOnOrderSnapshot(items, [{
      item_list_id: "violet-hill",
      quantity_on_order: 0
    }])).toEqual([expect.objectContaining({ name: "VS000476", quantity_on_order: 0 })]);
  });

  it("rejects a completed snapshot whose persisted row count does not match the connector", () => {
    expect(() => assertCompletedQuickBooksSnapshotCount(1176, 1000))
      .toThrow("expected 1176 items, received 1000");
  });

  it("rejects a snapshot that raced ahead of the item mirror read", () => {
    expect(() => applyCompletedQuickBooksOnOrderSnapshot([], [{
      item_list_id: "new-item",
      quantity_on_order: 12
    }])).toThrow("1 items missing from the item mirror");
  });
});
