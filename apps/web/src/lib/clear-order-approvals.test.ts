import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { clearSavedOrderApprovals, previewOrderApprovalClear } from "./clear-order-approvals";

const scope = { reportRunId: "run" };
function fixture(count = 2) {
  const recommendations = Array.from({ length: count }, (_, i) => ({ id: `r${i}`, lock_version: i + 1,
    approved_qty: 12, supplier_name: i === 0 ? " Supplier A " : "Supplier B" }));
  const catalog = [{ id: "c1", lock_version: 7, approved_qty: 6, wine: { supplier_name: "Supplier A" } }];
  const eq = vi.fn(), statuses = vi.fn(), ranges = vi.fn();
  const rpc = vi.fn(async (_name: string, args: { p_updates: unknown[] }) => ({ data: { ok: true, saved: args.p_updates }, error: null }));
  const db = { rpc, from: vi.fn((table: string) => {
    const rows = table === "reorder_recommendations" ? recommendations : catalog;
    const query = { select: () => query, eq: (...args: unknown[]) => { eq(...args); return query; },
      in: (...args: unknown[]) => { statuses(...args); return query; }, order: () => query,
      range: async (from: number, to: number) => { ranges(table, from, to); return { data: rows.slice(from, to + 1), error: null }; } };
    return query;
  }) };
  return { db: db as unknown as SupabaseClient, recommendations, catalog, rpc, eq, statuses, ranges };
}
describe("clear saved approvals", () => {
  it("previews both sources for the ordering run without loading wine calculations", async () => {
    const f = fixture();
    const all = await previewOrderApprovalClear(f.db, scope);
    expect(all.rows).toHaveLength(3); expect(all.bottles).toBe(30); expect(all.supplierCount).toBe(2);
    expect(f.eq.mock.calls).toEqual([["report_run_id", "run"], ["report_run_id", "run"]]);
    expect(f.statuses).toHaveBeenCalledWith("recommendation_status", ["approved", "edited"]);
    const supplier = await previewOrderApprovalClear(f.db, { ...scope, supplier: "Supplier A" });
    expect(supplier.rows.map(r => r.id)).toEqual(["r0", "c1"]); expect(supplier.bottles).toBe(18);
  });
  it("includes approvals beyond the database page limit", async () => {
    const f = fixture(1001);
    expect((await previewOrderApprovalClear(f.db, scope)).rows).toHaveLength(1002);
    expect(f.ranges).toHaveBeenCalledWith("reorder_recommendations", 1000, 1999);
  });
  it("clears the whole supplier in one versioned transaction without touching drafts", async () => {
    const f = fixture();
    const preview = await previewOrderApprovalClear(f.db, { ...scope, supplier: "Supplier A" });
    expect(await clearSavedOrderApprovals(f.db, preview)).toEqual({ cleared: 2 });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("save_order_approvals", { p_updates: [
      { sourceType: "recommendation", id: "r0", expectedLockVersion: 1, recommendationStatus: "rejected", approvedQty: 0 },
      { sourceType: "catalog_workbench", id: "c1", expectedLockVersion: 7, recommendationStatus: "rejected", approvedQty: 0 }
    ] });
  });
  it.each(["changed", "added", "removed", "duplicate"])("rejects %s approvals since confirmation with no writes", async change => {
    const f = fixture(); const preview = await previewOrderApprovalClear(f.db, scope);
    if (change === "changed") f.recommendations[0].lock_version++;
    if (change === "added") f.recommendations.push({ ...f.recommendations[0], id: "new" });
    if (change === "removed") f.recommendations.pop();
    if (change === "duplicate") preview.rows.push(preview.rows[0]);
    await expect(clearSavedOrderApprovals(f.db, preview)).rejects.toThrow("Nothing was cleared");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("surfaces a conflict occurring inside the transaction", async () => {
    const f = fixture(); const preview = await previewOrderApprovalClear(f.db, scope);
    f.rpc.mockResolvedValueOnce({ data: { ok: false, saved: [] }, error: null });
    await expect(clearSavedOrderApprovals(f.db, preview)).rejects.toThrow("Another buyer");
  });
  it("does not write when no approvals remain", async () => {
    const f = fixture(0); f.catalog.length = 0;
    expect(await clearSavedOrderApprovals(f.db, await previewOrderApprovalClear(f.db, scope))).toEqual({ cleared: 0 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
