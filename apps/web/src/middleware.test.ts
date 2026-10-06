import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const state = vi.hoisted(() => ({ refresh: false, getClaims: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: {
    getAll: () => { name: string; value: string }[];
    setAll: (cookies: { name: string; value: string; options: { path: string } }[]) => void;
  } }) => ({
    auth: {
      getClaims: async () => {
        state.getClaims();
        if (state.refresh) {
          options.cookies.setAll([{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } }]);
        }
        return { data: { claims: { sub: "user" } }, error: null };
      }
    }
  })
}));

beforeEach(() => { state.refresh = false; state.getClaims.mockClear(); });

describe("session refresh middleware", () => {
  it("passes a refreshed session to both the current handler and the browser", async () => {
    state.refresh = true;
    const request = new NextRequest("https://example.com/api/ordering/snapshot?supplier=Brazos%20Imports", {
      headers: { cookie: "sb-test-auth-token=expired" }
    });
    const response = await middleware(request);

    expect(state.getClaims).toHaveBeenCalledOnce();
    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  });

  it("leaves an unrefreshed request alone", async () => {
    const response = await middleware(new NextRequest("https://example.com/api/ordering/snapshot"));
    expect(state.getClaims).toHaveBeenCalledOnce();
    expect(response.cookies.getAll()).toHaveLength(0);
  });
});
