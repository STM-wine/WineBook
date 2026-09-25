import { describe, expect, it, vi } from "vitest";
import { commitPendingQuantityForApproval } from "./workbench-approval";

describe("workbench approval editing", () => {
  it("reads and commits the pending quantity before approval is saved", () => {
    const calls: string[] = [];
    const stopEditing = vi.fn();

    const qty = commitPendingQuantityForApproval(
      () => {
        calls.push("read");
        return "18";
      },
      () => {
        calls.push("commit");
        stopEditing();
      },
      0
    );

    expect(qty).toBe(18);
    expect(calls).toEqual(["read", "commit"]);
    expect(stopEditing).toHaveBeenCalledOnce();
  });

  it("falls back to the committed quantity when no editor is active", () => {
    const stopEditing = vi.fn();

    const qty = commitPendingQuantityForApproval(
      () => undefined,
      stopEditing,
      12
    );

    expect(qty).toBe(12);
    expect(stopEditing).toHaveBeenCalledOnce();
  });
});
