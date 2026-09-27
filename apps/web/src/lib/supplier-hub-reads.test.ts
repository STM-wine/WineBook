import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fetchSupplierHubData } from "./supplier-hub-reads";

describe("company-wide Supplier Hub reads", () => {
  it("keeps catalog wines and queues from every supplier across database pages", async () => {
    const tables = {
      supplier_catalog_wines: Array.from({ length: 1001 }, (_, id) => ({
        id: String(id), supplier_name: id % 2 ? "Supplier A" : "Supplier B",
        price_levels: [{ id: `price-${id}` }], free_goods: [], workbench_items: []
      })),
      wine_requests: Array.from({ length: 1002 }, (_, id) => ({ id: String(id), supplier_name: id % 2 ? "Supplier A" : "Supplier B" })),
      price_change_events: Array.from({ length: 1003 }, (_, id) => ({ id: String(id), supplier: id % 2 ? "Supplier A" : "Supplier B" }))
    };
    const ranges: Record<string, number[]> = {};
    const db = {
      from(table: keyof typeof tables) {
        const query = {
          select(_columns: string, options: { count: string }) {
            expect(options.count).toBe("exact");
            return query;
          },
          order() { return query; },
          range(from: number, to: number) {
            (ranges[table] ||= []).push(from);
            return Promise.resolve({ data: tables[table].slice(from, to + 1), count: tables[table].length, error: null });
          }
        };
        return query;
      }
    } as unknown as SupabaseClient;

    const result = await fetchSupplierHubData(db);
    expect(result.catalog).toEqual(tables.supplier_catalog_wines);
    expect(result.requests).toEqual(tables.wine_requests);
    expect(result.priceChanges).toEqual(tables.price_change_events);
    for (const starts of Object.values(ranges)) expect(starts).toEqual([0, 1000]);
  });
});
