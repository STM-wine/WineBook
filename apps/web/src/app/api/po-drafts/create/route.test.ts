import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const state = vi.hoisted(() => ({
  role: "buyer", rpc: vi.fn(), overlay: vi.fn(), tables: [] as string[],
  recommendations: [] as Array<Record<string, unknown>>,
  catalogWines: [] as Array<Record<string, unknown>>
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => {
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "buyer-id" } } }) },
    rpc: state.rpc,
    from: (table: string) => {
      state.tables.push(table);
      // Any post-commit draft display read would time out in this regression.
      if (table.startsWith("purchase_order_")) throw new Error("canceling statement due to statement timeout");
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: table === "app_profiles" ? { role: state.role }
          : { id: "run-id", diagnostics: {} }, error: null }),
        returns: async () => ({ data: [], error: null })
      };
      return query;
    }
  };
  return { createClient: async () => db, createServiceRoleClient: () => db };
});
vi.mock("@/lib/supabase/recommendations", () => ({
  fetchAllRecommendationsForRun: async () => state.recommendations, fetchQuickBooksOnOrderItems: async () => []
}));
vi.mock("@/lib/supabase/fetch-all-exact", () => ({ fetchAllExact: async () => state.catalogWines }));
vi.mock("@/lib/supabase/vinosmith-availability", () => ({
  fetchLiveVinosmithAvailability: async () => ({ byProductCode: new Map(), snapshotAt: "2026-09-28T12:00:00Z" })
}));
vi.mock("@/lib/source-backed-ordering-runs", () => ({ isSourceBackedRun: () => true }));
vi.mock("@/lib/source-backed-ordering-server", () => ({ fetchCurrentOrderingOverlay: state.overlay }));
const request = () => new Request("https://example.test/api/po-drafts/create", {
  method: "POST", body: JSON.stringify({ reportRunId: "run-id", idempotencyKey: "request-key" })
});
beforeEach(() => {
  state.role = "buyer"; state.tables = []; state.recommendations = []; state.catalogWines = [];
  state.rpc.mockReset(); state.overlay.mockReset();
  state.rpc.mockResolvedValue({ data: { ok: true, updated: ["existing-draft"] }, error: null });
  state.overlay.mockResolvedValue({ rows: [], diagnostics: {} });
});
describe("create PO drafts transaction boundary", () => {
  it("includes a hidden matched catalog approval in the atomic PO manifest", async () => {
    state.recommendations = [{
      id: "recommendation-1", report_run_id: "run-id", product_name: "Matched Wine",
      product_code: "MATCH001", planning_sku: "MATCH001", supplier_name: "Supplier",
      recommendation_status: "rejected", approved_qty: 0, lock_version: 1, pack_size: 12
    }];
    state.catalogWines = [{
      id: "catalog-1", display_name: "Matched Wine", planning_sku: "matched wine",
      producer: "Producer", supplier_name: "Supplier", quickbooks_item_number: "MATCH001",
      quickbooks_sync_status: "linked", product_lifecycle_status: "supplier_available",
      pack_size: 12, fob_bottle: 10, laid_in_per_bottle: 1,
      workbench_items: [{
        id: "workbench-1", report_run_id: "run-id", active: true,
        recommendation_status: "edited", approved_qty: 12, recommended_qty: 12,
        lock_version: 3, order_path: "stateside"
      }]
    }];
    state.overlay.mockResolvedValue({ rows: state.recommendations, diagnostics: {} });

    expect((await POST(request())).status).toBe(200);
    const args = state.rpc.mock.calls[0][1];
    expect(args.p_approval_manifest).toEqual([{
      sourceType: "catalog_workbench", sourceId: "workbench-1",
      recommendationStatus: "edited", approvedQty: 12, lockVersion: 3
    }]);
    expect(args.p_groups[0].lines[0]).toMatchObject({
      sourceType: "catalog_workbench", sourceId: "workbench-1", approvedQty: 12
    });
  });
  it("returns a successful existing-draft update without loading every draft's details afterward", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ created: [], updated: ["existing-draft"], skipped: [], errors: [] });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0][1].p_idempotency_key).toBe("request-key");
    expect(state.tables.some((table) => table.startsWith("purchase_order_"))).toBe(false);
  });
  it("does not write drafts if source verification fails", async () => {
    state.overlay.mockRejectedValue(new Error("canceling statement due to statement timeout"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("does not blindly retry an ambiguous write error", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "connection lost" } });
    expect((await POST(request())).status).toBe(500);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it("preserves approval conflict and buyer authorization checks", async () => {
    state.rpc.mockResolvedValue({ data: { ok: false, conflicts: [{ sourceId: "changed" }] }, error: null });
    expect((await POST(request())).status).toBe(409);
    state.rpc.mockClear(); state.role = "viewer";
    expect((await POST(request())).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
