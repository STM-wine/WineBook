import { describe, expect, it } from "vitest";
import { recommendationsAreSuppressed, replenishmentPolicyLabel } from "./replenishment-policy";
import { normalizeSystemTags, systemTagLabel } from "./supplier-catalog";

describe("replenishment policy labels", () => {
  it("presents Limited Core as Select", () => {
    expect(replenishmentPolicyLabel("Limited Core")).toBe("Select");
    expect(replenishmentPolicyLabel("Core")).toBe("Core");
  });

  it("automatically resumes a Supplier OOS item on its selected date", () => {
    expect(recommendationsAreSuppressed(true, "Supplier OOS", "2026-10-15", "2026-10-14")).toBe(true);
    expect(recommendationsAreSuppressed(true, "Supplier OOS", "2026-10-15", "2026-10-15")).toBe(false);
    expect(recommendationsAreSuppressed(true, "Supplier OOS", "2026-10-15", "2026-10-16")).toBe(false);
  });

  it("keeps end-of-vintage and end-of-allocation suppressions off until a user restores them", () => {
    expect(recommendationsAreSuppressed(true, "End of Vintage", null, "2027-01-01")).toBe(true);
    expect(recommendationsAreSuppressed(true, "End of Allocation", null, "2027-01-01")).toBe(true);
  });

  it("accepts Select input while preserving the legacy stored tag", () => {
    expect(systemTagLabel("Limited Core")).toBe("Select");
    expect(normalizeSystemTags(["Select", "Limited Core", "Core"])).toEqual(["Limited Core", "Core"]);
  });
});
