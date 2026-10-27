import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const state = vi.hoisted(() => ({ refresh: false, getUser: vi.fn(), role: "buyer", user: true }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: {
    getAll: () => { name: string; value: string }[];
    setAll: (cookies: { name: string; value: string; options: { path: string } }[]) => void;
  } }) => ({
    auth: {
      getUser: async () => {
        state.getUser();
        if (state.refresh) {
          options.cookies.setAll([{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } }]);
        }
        return { data: { user: state.user ? { id: "user" } : null }, error: null };
      }
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: state.role }, error: null }) }) }) })
  })
}));

beforeEach(() => { state.refresh = false; state.role = "buyer"; state.user = true; state.getUser.mockClear(); });

describe("session refresh middleware", () => {
  it("passes a refreshed session to both the current handler and the browser", async () => {
    state.refresh = true;
    const request = new NextRequest("https://example.com/api/ordering/snapshot?supplier=Brazos%20Imports", {
      headers: { cookie: "sb-test-auth-token=expired" }
    });
    const response = await middleware(request);

    expect(state.getUser).toHaveBeenCalledOnce();
    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  });

  it("leaves an unrefreshed request alone", async () => {
    const response = await middleware(new NextRequest("https://example.com/api/ordering/snapshot"));
    expect(state.getUser).toHaveBeenCalledOnce();
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("blocks a visit-only account from existing pages and service-role APIs", async () => {
    state.role = "visit_sales";
    expect((await middleware(new NextRequest("https://example.com/products"))).status).toBe(403);
    expect((await middleware(new NextRequest("https://example.com/api/sales-dashboard"))).status).toBe(403);
    expect((await middleware(new NextRequest("https://example.com/visits"))).status).toBe(200);
    expect((await middleware(new NextRequest("https://example.com/", { method: "POST" }))).status).toBe(403);
  });
});
