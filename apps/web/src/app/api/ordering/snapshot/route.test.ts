import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const state = vi.hoisted(() => ({
  requested: {} as Record<string, unknown>, completed: null as Record<string, unknown> | null,
  eq: vi.fn(), rpc: vi.fn(), signedIn: true
}));
vi.mock("@/lib/ordering-snapshot", () => ({ ORDERING_READ_FORMULA: "test-formula", orderingReadKey: () => "current" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.signedIn ? { id: "user" } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "user" } }) }) }) })
  }),
  createServiceRoleClient: () => ({
    rpc: state.rpc,
    from: () => {
      const query = { select: () => query, eq: (...args: unknown[]) => { state.eq(...args); return query; },
        gte: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: state.completed }) };
      return query;
    }
  })
}));
beforeEach(() => {
  vi.clearAllMocks(); state.signedIn = true; state.completed = null;
  state.requested = { id: "new", status: "failed", error: "canceling statement due to statement timeout", source_version: 269, business_date: "2026-09-26" };
  state.rpc.mockImplementation(async () => ({ data: [state.requested] }));
});
describe("ordering snapshot recovery", () => {
  it("keeps the browser polling after a timeout and serves the recovered generation", async () => {
    const pending = await GET(new Request("https://example.com/api/ordering/snapshot"));
    expect(pending.status).toBe(202);
    expect(await pending.json()).toMatchObject({ pending: true });
    expect(state.eq).toHaveBeenCalledWith("source_version", 269);
    expect(state.eq).toHaveBeenCalledWith("formula_version", "test-formula");
    state.completed = { id: "recovered", result: { groups: [{ supplier: "Example" }] }, completed_at: "2026-09-27T03:28:59Z" };
    const ready = await GET(new Request("https://example.com/api/ordering/snapshot"));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ snapshotId: "recovered", sourceVersion: 269, groups: [{ supplier: "Example" }] });
  });
  it("keeps substantive source failures visible instead of polling indefinitely", async () => {
    state.requested.error = "No completed ordering run is available.";
    const response = await GET(new Request("https://example.com/api/ordering/snapshot"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "No completed ordering run is available." });
  });
  it("also recovers when requesting the job itself times out", async () => {
    state.rpc.mockResolvedValueOnce({ error: { message: "canceling statement due to statement timeout" } });
    const response = await GET(new Request("https://example.com/api/ordering/snapshot"));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ pending: true });
  });
  it("does not access snapshots for unauthenticated callers", async () => {
    state.signedIn = false;
    expect((await GET(new Request("https://example.com/api/ordering/snapshot"))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
