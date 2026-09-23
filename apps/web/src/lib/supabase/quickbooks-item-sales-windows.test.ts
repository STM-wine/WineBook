import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchQuickBooksItemSalesWindows, type QuickBooksItemSalesWindowRow } from "./quickbooks-item-sales-windows";

function salesRow(index: number): QuickBooksItemSalesWindowRow {
  return {
    item_list_id: `item-${index}`,
    item_full_name: `Wine ${index}`,
    last_30_quantity: index,
    last_60_quantity: index,
    last_90_quantity: index,
    prior_30_quantity: 0,
    last_year_next_30_quantity: 0,
    last_year_next_60_quantity: 0,
    last_year_next_90_quantity: 0
  };
}

describe("fetchQuickBooksItemSalesWindows", () => {
  it("fetches every sales row in one scalar payload instead of recomputing the RPC for each 1,000-row page", async () => {
    const allRows = Array.from({ length: 2456 }, (_, index) => salesRow(index));
    const supabase = {
      rpc: vi.fn(() => ({
        returns: async () => ({ data: allRows, error: null })
      }))
    };

    const rows = await fetchQuickBooksItemSalesWindows(supabase as never, "2026-09-15");

    expect(rows).toHaveLength(2456);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "quickbooks_item_sales_windows_payload",
      { p_reference_date: "2026-09-15" }
    );
  });

  it("surfaces an RPC error", async () => {
    const supabase = {
      rpc: vi.fn(() => ({
        returns: async () => ({ data: null, error: { message: "payload failed" } })
      }))
    };

    await expect(fetchQuickBooksItemSalesWindows(supabase as never, "2026-09-15")).rejects.toThrow("payload failed");
  });

  it("fails closed when the database does not provide an array payload", async () => {
    const supabase = {
      rpc: vi.fn(() => ({
        returns: async () => ({ data: null, error: null })
      }))
    };

    await expect(fetchQuickBooksItemSalesWindows(supabase as never, "2026-09-15"))
      .rejects.toThrow("QuickBooks sales windows did not return a complete payload.");
  });
});
