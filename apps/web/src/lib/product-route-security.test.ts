import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), service: vi.fn(), workbook: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.auth, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/product-workspace-export", () => ({ buildProductWorkspaceWorkbook: mocks.workbook }));
import { GET } from "@/app/api/products/workspace/route";
beforeEach(() => { vi.resetAllMocks(); });
describe("product API boundary", () => {
  it("rejects unauthenticated requests before accessing cached business data", async () => {
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    const response = await GET(new Request("http://local/api/products/workspace?snapshot=private"));
    expect(response.status).toBe(401); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("rejects users without an enabled profile before accessing cached business data", async () => {
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "disabled" } } }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) });
    const response = await GET(new Request("http://local/api/products/workspace?snapshot=private"));
    expect(response.status).toBe(403); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("exports every matching row past the first 1000 using one pinned filter and snapshot", async () => {
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "buyer" } } }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "buyer" }, error: null }) }) }) }) });
    const rpc = vi.fn(async (_name: string, args: { p_mode: string; p_offset: number }) => ({ error: null, data: {
      snapshotId: "immutable", generatedAt: "2026-09-26", data: args.p_mode === "counts" ? { visible: 1250 }
        : Array.from({ length: args.p_offset === 0 ? 1000 : 250 }, (_, id) => ({ id: `wine-${args.p_offset + id}` }))
    } }));
    mocks.service.mockReturnValue({ rpc }); mocks.workbook.mockReturnValue({ xlsx: { writeBuffer: async () => new Uint8Array([1, 2]) } });
    const response = await GET(new Request("http://local/api/products/workspace?mode=download&snapshot=immutable&search=rare"));
    expect(response.status).toBe(200); expect(response.headers.get("X-Export-Rows")).toBe("1250");
    expect(mocks.workbook.mock.calls[0][0]).toHaveLength(1250);
    expect(rpc.mock.calls.every(([, args]) => (args as any).p_snapshot === "immutable" && (args as any).p_filters.search === "rare")).toBe(true);
  });
});
