// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClearApprovalsDialog } from "./clear-approvals-dialog";
const actions = vi.hoisted(() => ({ previewClearOrderApprovals: vi.fn(), clearOrderApprovals: vi.fn() }));
const flush = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions", () => actions);
vi.mock("@/lib/approval-navigation", () => ({ flushAllApprovals: flush }));
let host: HTMLDivElement, root: Root;
const scope = { reportRunId: "run" };
const preview = { scope, rows: [{ sourceType: "recommendation", id: "r1", lockVersion: 2 }], bottles: 12, supplierCount: 1 };
const close = vi.fn(), cleared = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  flush.mockResolvedValue(undefined); actions.previewClearOrderApprovals.mockResolvedValue(preview);
  actions.clearOrderApprovals.mockResolvedValue({ cleared: 1 });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount() { await act(async () => root.render(<ClearApprovalsDialog scope={scope} onClose={close} onCleared={cleared} />)); }
it("waits for unsaved edits before previewing and again before confirming", async () => {
  let release!: () => void;
  flush.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  await mount();
  expect(actions.previewClearOrderApprovals).not.toHaveBeenCalled();
  expect((host.querySelector('.clear-approvals-button') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => release());
  expect(actions.previewClearOrderApprovals).toHaveBeenCalledWith(scope);
  await act(async () => (host.querySelector('.clear-approvals-button') as HTMLButtonElement).click());
  expect(flush).toHaveBeenCalledTimes(2); expect(actions.clearOrderApprovals).toHaveBeenCalledWith(preview);
  expect(cleared).toHaveBeenCalledWith(1);
});
it("keeps a conflicting clear visible as an error without reporting success", async () => {
  actions.clearOrderApprovals.mockRejectedValue(new Error("Another buyer changed an approval. Nothing was cleared."));
  await mount();
  await act(async () => (host.querySelector('.clear-approvals-button') as HTMLButtonElement).click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Nothing was cleared");
  expect(cleared).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
it("does not allow clearing when pending edits failed to save", async () => {
  flush.mockRejectedValueOnce(new Error("Save failed")); await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Save failed");
  expect(actions.previewClearOrderApprovals).not.toHaveBeenCalled();
  expect((host.querySelector('.clear-approvals-button') as HTMLButtonElement).disabled).toBe(true);
});
