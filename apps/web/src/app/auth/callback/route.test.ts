import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));

beforeEach(() => {
  auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  auth.verifyOtp.mockReset().mockResolvedValue({ error: null });
});

describe("auth callback recovery routing", () => {
  it("sends a verified recovery code to a short-lived password form", async () => {
    const response = await GET(new Request("https://stmhq.com/auth/callback?flow=recovery&code=example"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("example");
    expect(response.headers.get("location")).toBe("https://stmhq.com/auth/reset-password");
    expect(response.headers.get("set-cookie")).toContain("stem_password_recovery=1");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=600");
  });

  it("also accepts a verified recovery token hash", async () => {
    const response = await GET(new Request("https://stmhq.com/auth/callback?flow=recovery&type=recovery&token_hash=example"));
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "example", type: "recovery" });
    expect(response.headers.get("location")).toBe("https://stmhq.com/auth/reset-password");
  });

  it("does not treat a different OTP type as password recovery", async () => {
    const response = await GET(new Request("https://stmhq.com/auth/callback?flow=recovery&type=invite&token_hash=example"));
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("/login?error=");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("preserves ordinary sign-in redirects and rejects failed recovery codes", async () => {
    const signIn = await GET(new Request("https://stmhq.com/auth/callback?code=example"));
    expect(signIn.headers.get("location")).toBe("https://stmhq.com/");
    expect(signIn.headers.get("set-cookie")).toBeNull();

    auth.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "expired" } });
    const expired = await GET(new Request("https://stmhq.com/auth/callback?flow=recovery&code=expired"));
    expect(expired.headers.get("location")).toContain("/login?error=expired");
    expect(expired.headers.get("set-cookie")).toBeNull();
  });
});
