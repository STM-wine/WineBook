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
  it("fetches every RPC page instead of stopping at Supabase's 1,000-row response limit", async () => {
    const allRows = Array.from({ length: 2456 }, (_, index) => salesRow(index));
    const ranges: Array<[number, number]> = [];
    const supabase = {
      rpc: vi.fn((_name, _args, options) => ({
        range: (from: number, to: number) => {
          ranges.push([from, to]);
          return {
            returns: async () => ({ data: allRows.slice(from, to + 1), error: null, count: allRows.length })
          };
        }
      }))
    };

    const rows = await fetchQuickBooksItemSalesWindows(supabase as never, "2026-09-15");

    expect(rows).toHaveLength(2456);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(supabase.rpc).toHaveBeenCalledTimes(3);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "quickbooks_item_sales_windows",
      { p_reference_date: "2026-09-15" },
      { count: "exact" }
    );
  });

  it("surfaces an error from a later page", async () => {
    let page = 0;
    const supabase = {
      rpc: vi.fn(() => ({
        range: () => ({
          returns: async () => page++ === 0
            ? { data: Array.from({ length: 1000 }, (_, index) => salesRow(index)), error: null, count: 1500 }
            : { data: null, error: { message: "page failed" }, count: 1500 }
        })
      }))
    };

    await expect(fetchQuickBooksItemSalesWindows(supabase as never, "2026-09-15")).rejects.toThrow("page failed");
  });

  it("refuses to return a silently truncated result", async () => {
    let page = 0;
    const supabase = {
      rpc: vi.fn(() => ({
        range: () => ({
          returns: async () => ({
            data: page++ === 0
              ? Array.from({ length: 1000 }, (_, index) => salesRow(index))
              : Array.from({ length: 900 }, (_, index) => salesRow(index + 1000)),
            error: null,
            count: 2456
          })
        })
      }))
    };

    await expect(fetchQuickBooksItemSalesWindows(supabase as never, "2026-09-15"))
      .rejects.toThrow("QuickBooks sales windows was incomplete (expected 2456 rows, received 1900).");
  });

  it("fails closed when the database does not provide a completeness count", async () => {
    const supabase = {
      rpc: vi.fn(() => ({
        range: () => ({
          returns: async () => ({ data: [salesRow(1)], error: null, count: null })
        })
      }))
    };

    await expect(fetchQuickBooksItemSalesWindows(supabase as never, "2026-09-15"))
      .rejects.toThrow("QuickBooks sales windows did not return a completeness count.");
  });
});
