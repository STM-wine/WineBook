import { describe, expect, it } from "vitest";
import { replenishmentPolicyLabel } from "./replenishment-policy";
import { normalizeSystemTags, systemTagLabel } from "./supplier-catalog";

describe("replenishment policy labels", () => {
  it("presents Limited Core as Select", () => {
    expect(replenishmentPolicyLabel("Limited Core")).toBe("Select");
    expect(replenishmentPolicyLabel("Core")).toBe("Core");
  });

  it("accepts Select input while preserving the legacy stored tag", () => {
    expect(systemTagLabel("Limited Core")).toBe("Select");
    expect(normalizeSystemTags(["Select", "Limited Core", "Core"])).toEqual(["Limited Core", "Core"]);
  });
});
