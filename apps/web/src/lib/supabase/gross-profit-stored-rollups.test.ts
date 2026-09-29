import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchStoredGrossProfitRollups } from "./gross-profit-stored-rollups";

it("excludes tagged historical non-wine adjustments without changing stored GP or revenue", async () => {
  const row = { period_date: "2026-01-01", business_line: "stem", scope_type: "company", scope_key: "all",
    invoice_sales: 150, credit_memos: 10, net_sales: 140, invoice_count: 2, credit_memo_count: 1,
    sample_cost: 5, gross_profit: 30, gross_profit_percent: 30/140,
    confidence_buckets: { non_wine_adjustment: { grossSales: 40 } } };
  const db = { from() { const filters: Array<(r: typeof row) => boolean> = []; const query = {
    select() { return query; }, gte() { return query; }, lte() { return query; },
    eq(k: keyof typeof row, value: unknown) { if (k !== ("formula_version" as keyof typeof row)) filters.push(r => r[k] === value); return query; },
    in(k: keyof typeof row, values: unknown[]) { filters.push(r => values.includes(r[k])); return query; },
    order() { return query; }, range() { return query; },
    returns() { return Promise.resolve({ data: filters.every(f => f(row)) ? [row] : [], error: null }); }
  }; return query; } } as unknown as SupabaseClient;
  const result = await fetchStoredGrossProfitRollups(db, { from: "2026-01-01", to: "2026-01-01" }, { businessLine: "stem", includeBreakdowns: false });
  expect(result.summary.netSales).toBe(140);
  expect(result.summary.grossProfit).toBe(30);
  expect(result.summary.grossProfitNetSales).toBe(100);
  expect(result.summary.grossProfitPercent).toBe(.3);
  expect(result.summary.sampleCost).toBe(5);
});
