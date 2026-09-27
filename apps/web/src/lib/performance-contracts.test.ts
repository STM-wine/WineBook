import { describe, expect, it } from "vitest";
import { mergeOrderingRead } from "./merge-ordering-read";
import { mergeDashboardSnapshot } from "./dashboard-snapshot-merge";
import type { CompanyDashboardData } from "./company-dashboard-data";
import { registerApprovalEditor, flushAllApprovals } from "./approval-navigation";
import { buildFreightReadModel } from "./freight-read-model";
import { readProductWorkspace } from "./product-workspace-reader";
import type { Recommendation } from "./types";

function dashboard(overrides: Partial<CompanyDashboardData> = {}): CompanyDashboardData {
  return { sourceVersion: 2, dateFrom: "2026-09-01", dateTo: "2026-09-26", businessLine: "all", selectedRep: null,
    breakdownsLoaded: false, byRep: [], byAccount: [], comparison: null, ...overrides } as CompanyDashboardData;
}
describe("snapshot composition", () => {
  it("retains completed breakdowns when a slower summary arrives from the same source", () => {
    const previous = dashboard({ breakdownsLoaded: true, byRep: [{ key: "a" }] as never, comparison: { label: "LY" } as never });
    expect(mergeDashboardSnapshot(previous, dashboard()).byRep).toEqual(previous.byRep);
    expect(mergeDashboardSnapshot(previous, dashboard()).comparison).toEqual(previous.comparison);
  });
  it.each([{ sourceVersion: 3 }, { dateTo: "2026-09-27" }, { businessLine: "stem" as const }, { selectedRep: "A" }])(
    "does not mix generations or ranges: %j", (change) => {
      const incoming = dashboard(change);
      expect(mergeDashboardSnapshot(dashboard({ breakdownsLoaded: true, byRep: [{ key: "old" }] as never }), incoming)).toBe(incoming);
    });
});
describe("multi-supplier pending work", () => {
  it("waits for every editor before the all-supplier PO action", async () => {
    let release!: () => void;
    let settled = false;
    const unregister = registerApprovalEditor(() => new Promise<void>((resolve) => { release = resolve; }));
    const pending = flushAllApprovals().then(() => { settled = true; });
    expect(settled).toBe(false); release(); await pending; expect(settled).toBe(true); unregister();
  });
  it("blocks navigation on a conflict without discarding the editor", async () => {
    const unregister = registerApprovalEditor(async () => { throw new Error("Conflict"); });
    await expect(flushAllApprovals()).rejects.toThrow("Conflict");
    await expect(flushAllApprovals()).rejects.toThrow("Conflict");
    unregister(); await expect(flushAllApprovals()).resolves.toBeUndefined();
  });
});
describe("server freight aggregates", () => {
  it("preserves full-set quantities and costs for both bases", () => {
    const rows = Array.from({ length: 1250 }, (_, i) => ({ id: String(i), supplier_name: "S", pickup_location: "California",
      recommended_qty_rounded: 12, approved_qty: 6, recommendation_status: "approved", fob: 10, trucking_cost_per_bottle: 2,
      order_path: "stateside" })) as Recommendation[];
    const model = buildFreightReadModel(rows, []);
    expect(model.suggested[0].quantity).toBe(15000);
    expect(model.suggested[0].estimatedCost).toBe(180000);
    expect(model.approved[0].quantity).toBe(7500);
  });
});
describe("real product page contract", () => {
  it("uses database filters, numeric sorting, an immutable snapshot, and a single lookahead row", async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (...args: unknown[]) => { calls.push(args); return { data: { data: Array.from({ length: 76 }, (_, id) => ({ id })) }, error: null }; } };
    const page = await readProductWorkspace(db as never, new URLSearchParams({ snapshot: "s", search: "rare wine", sort: "fob", direction: "desc", offset: "75" }));
    expect(page.rows).toHaveLength(75); expect(page.hasMore).toBe(true);
    expect(calls).toEqual([["read_product_workspace", expect.objectContaining({ p_snapshot: "s", p_offset: 75, p_limit: 76, p_sort: "fob", p_direction: "desc", p_filters: expect.objectContaining({ search: "rare wine" }) })]]);
  });
  it("rejects invalid offsets instead of silently truncating", async () => {
    await expect(readProductWorkspace({} as never, new URLSearchParams({ snapshot: "s", offset: "-1" }))).rejects.toThrow("Invalid product offset");
  });
});

describe("two-buyer visibility merge", () => {
  it("preserves an unsaved/conflicted quantity while advancing confirmed lock metadata", () => {
    const local = { id: "r", approved_qty: 12, recommendation_status: "edited", lock_version: 1, order_path: "stateside" } as Recommendation;
    const otherBuyer = { ...local, approved_qty: 24, lock_version: 2 };
    const [merged] = mergeOrderingRead([local], [otherBuyer], new Set(["recommendation:r"]));
    expect(merged.approved_qty).toBe(12); expect(merged.lock_version).toBe(2);
    expect(mergeOrderingRead([local], [otherBuyer], new Set())[0].approved_qty).toBe(24);
  });
  it("does not discard unsaved work when a source row disappears", () => {
    const local = { id: "removed", approved_qty: 12 } as Recommendation;
    expect(mergeOrderingRead([local], [], new Set(["recommendation:removed"]))).toEqual([local]);
  });
});
