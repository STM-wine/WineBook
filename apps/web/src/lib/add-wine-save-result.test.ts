import { describe, expect, it } from "vitest";
import { addWineSaveFailure } from "./add-wine-save-result";

describe("Add Wine save failures", () => {
  it("turns a stale lock into a safe user-facing result", () => {
    expect(addWineSaveFailure(
      "This wine changed after you opened it. Refresh Add Wine and review the latest values before saving."
    )).toEqual({
      ok: false,
      code: "version_conflict",
      message: "This wine was already saved or changed after you opened it. Your changes were not applied again. Refresh Add Wine and review the saved item before retrying."
    });
  });

  it("handles a deleted edit target as the same review-required conflict", () => {
    expect(addWineSaveFailure("Supplier catalog wine not found for edit.")?.code).toBe("version_conflict");
  });

  it("does not hide unexpected database failures", () => {
    expect(addWineSaveFailure("connection terminated unexpectedly")).toBeNull();
  });
});
