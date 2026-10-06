import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient }));

import { persistQuickBooksResponse } from "./quickbooks-response-persistence";

function itemResponse(count: number) {
  return `<QBXMLMsgsRs><ItemQueryRs>${Array.from({ length: count }, (_, index) =>
    `<ItemInventoryRet><ListID>item-${index}</ListID><FullName>Wine ${index}</FullName></ItemInventoryRet>`
  ).join("")}</ItemQueryRs></QBXMLMsgsRs>`;
}

function input(count: number) {
  return {
    request: { requestType: "ItemQueryRq", qbxmlVersion: "16.0", qbxml: "<ItemQueryRq/>" } as never,
    response: itemResponse(count),
    status: [],
    responseChecksum: "checksum",
    receivedAt: "2026-10-06T17:48:39.967Z",
    sourceSyncRunId: "run-1"
  };
}

describe("QuickBooks item response persistence", () => {
  it("writes item and snapshot batches and retries a timed-out batch without losing rows", async () => {
    const calls: Array<{ table: string; ids: string[] }> = [];
    let itemAttempts = 0;
    createServiceRoleClient.mockReturnValue({
      from: (table: string) => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "raw-1" }, error: null }) }) }),
        upsert: async (rows: Array<{ list_id?: string; item_list_id?: string }>) => {
          calls.push({ table, ids: rows.map((row) => row.list_id || row.item_list_id || "") });
          if (table === "quickbooks_items" && ++itemAttempts === 2) {
            return { error: { code: "57014", message: "canceling statement due to statement timeout" } };
          }
          return { error: null };
        }
      })
    });

    await persistQuickBooksResponse(input(450));

    expect(calls.map((call) => [call.table, call.ids.length])).toEqual([
      ["quickbooks_items", 200], ["quickbooks_items", 200], ["quickbooks_items", 200],
      ["quickbooks_items", 50], ["quickbooks_inventory_snapshots", 200],
      ["quickbooks_inventory_snapshots", 200], ["quickbooks_inventory_snapshots", 50]
    ]);
    expect(calls[1].ids).toEqual(calls[2].ids);
    expect(calls.filter((call) => call.table === "quickbooks_items" && call !== calls[1])
      .flatMap((call) => call.ids)).toEqual(Array.from({ length: 450 }, (_, index) => `item-${index}`));
    expect(calls.filter((call) => call.table === "quickbooks_inventory_snapshots")
      .flatMap((call) => call.ids)).toEqual(Array.from({ length: 450 }, (_, index) => `item-${index}`));
  });

  it("stops after bounded timeout retries and names the failed table and batch", async () => {
    const upsert = vi.fn(async () => ({ error: { code: "57014", message: "statement timeout" } }));
    createServiceRoleClient.mockReturnValue({
      from: (table: string) => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "raw-1" }, error: null }) }) }),
        upsert: table === "quickbooks_items" ? upsert : vi.fn()
      })
    });

    await expect(persistQuickBooksResponse(input(201)))
      .rejects.toThrow("quickbooks_items upsert failed for rows 1-200: statement timeout");
    expect(upsert).toHaveBeenCalledTimes(3);
  });
});
