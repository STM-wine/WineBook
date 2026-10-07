// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "./account-menu";
import { AppUserMenu } from "./app-user-menu";

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), updateUser: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));

let host: HTMLDivElement;
let root: Root;

function enter(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  auth.signInWithPassword.mockReset();
  auth.updateUser.mockReset().mockResolvedValue({ error: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe.each([
  ["account menu", <AccountMenu />, "Account"],
  ["app menu", <AppUserMenu />, "Open app menu"],
])("%s password change", (_name, menu, trigger) => {
  it("updates the signed-in user's password without asking for the old password", async () => {
    await act(async () => root.render(menu));
    const triggerButton = host.querySelector<HTMLButtonElement>(`button[aria-label="${trigger}"]`)
      || [...host.querySelectorAll("button")].find((button) => button.textContent === trigger)!;
    await act(async () => triggerButton.click());
    if (trigger === "Open app menu") {
      await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Change Password")!.click());
    }

    const inputs = host.querySelectorAll<HTMLInputElement>('input[type="password"]');
    expect(inputs).toHaveLength(2);
    await act(async () => { enter(inputs[0], "new-password-1"); enter(inputs[1], "new-password-1"); });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-password-1" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Password updated.");
  });
});
