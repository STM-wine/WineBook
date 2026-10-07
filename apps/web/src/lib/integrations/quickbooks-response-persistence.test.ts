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

function customerResponse(count: number) {
  return `<QBXMLMsgsRs><CustomerQueryRs>${Array.from({ length: count }, (_, index) =>
    `<CustomerRet><ListID>customer-${index}</ListID><FullName>Customer ${index}</FullName></CustomerRet>`
  ).join("")}</CustomerQueryRs></QBXMLMsgsRs>`;
}

function vendorResponse(count: number) {
  return `<QBXMLMsgsRs><VendorQueryRs>${Array.from({ length: count }, (_, index) =>
    `<VendorRet><ListID>vendor-${index}</ListID><Name>Vendor ${index}</Name><FullName>Vendor ${index}</FullName></VendorRet>`
  ).join("")}</VendorQueryRs></QBXMLMsgsRs>`;
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

describe("QuickBooks customer response persistence", () => {
  it("batches an oversized response and retries only the timed-out batch", async () => {
    const calls: string[][] = [];
    createServiceRoleClient.mockReturnValue({
      from: (table: string) => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "raw-1" }, error: null }) }) }),
        select: () => ({ returns: async () => ({ data: [], error: null }) }),
        upsert: async (rows: Array<{ list_id: string }>) => {
          if (table !== "quickbooks_customers") return { error: null };
          calls.push(rows.map((row) => row.list_id));
          return { error: calls.length === 2 ? { code: "57014", message: "statement timeout" } : null };
        }
      })
    });

    await persistQuickBooksResponse({
      ...input(0),
      request: { requestType: "CustomerQueryRq", qbxmlVersion: "16.0", qbxml: "<CustomerQueryRq/>" } as never,
      response: customerResponse(240)
    });

    expect(calls.map((rows) => rows.length)).toEqual([100, 100, 100, 40]);
    expect(calls[1]).toEqual(calls[2]);
    expect([...calls[0], ...calls[2], ...calls[3]])
      .toEqual(Array.from({ length: 240 }, (_, index) => `customer-${index}`));
  });
});

describe("other QuickBooks table writes", () => {
  it("caps vendor upserts even if a response exceeds its requested page size", async () => {
    const sizes: number[] = [];
    createServiceRoleClient.mockReturnValue({
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "raw-1" }, error: null }) }) }),
        upsert: async (rows: unknown[]) => { sizes.push(rows.length); return { error: null }; }
      })
    });

    await persistQuickBooksResponse({
      ...input(0),
      request: { requestType: "VendorQueryRq", qbxmlVersion: "16.0", qbxml: "<VendorQueryRq/>" } as never,
      response: vendorResponse(450)
    });

    expect(sizes).toEqual([200, 200, 50]);
  });
});
