// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";
import { ResetPasswordForm } from "./reset-password-form";

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signInWithOtp: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));

let host: HTMLDivElement;
let root: Root;

function enter(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  auth.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  auth.updateUser.mockReset().mockResolvedValue({ error: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("password recovery controls", () => {
  it("requests a recovery email with the app callback, without signing in", async () => {
    await act(async () => root.render(<LoginForm />));
    await act(async () => enter(host.querySelector('input[type="email"]')!, "bethany@stemwinecompany.com"));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Reset password")!.click());
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("bethany@stemwinecompany.com", {
      redirectTo: "http://localhost:3000/auth/callback?flow=recovery"
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(host.textContent).toContain("If an account exists");
  });

  it("updates a password only after the form entries agree", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await act(async () => root.render(<ResetPasswordForm />));
    const inputs = host.querySelectorAll<HTMLInputElement>('input[type="password"]');
    await act(async () => { enter(inputs[0], "new-password-1"); enter(inputs[1], "different-password"); });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Passwords do not match");

    await act(async () => enter(inputs[1], "new-password-1"));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-password-1" });
    expect(host.textContent).toContain("Password updated");
    expect(fetch).toHaveBeenCalledWith("/auth/reset-password/complete", { method: "POST" });
  });
});
