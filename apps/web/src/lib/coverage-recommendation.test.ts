import { describe, expect, it } from "vitest";
import { calculateCoverageRecommendation } from "./coverage-recommendation";
import { calculateSourceRecommendation } from "./source-backed-ordering";
import { applySupplierTargetWeeks } from "./order-data";
import { previewOrderingLogicImpact } from "./ordering-preview";
import { DEFAULT_ORDERING_LOGIC_SETTINGS as settings } from "./ordering-logic";
import type { Recommendation } from "./types";

const facts = { weeklyVelocity: 10, trueAvailable: 5, onOrder: 4, packSize: 6 };
describe("coverage ordering", () => {
  it.each([
    [5, 10, 5, 4, 42], [2.5, 10, 5, 4, 18], [5, 10, 60, 0, 0],
    [5, 0, -12, 0, 0], [5, -10, -12, 0, 0], [0, 10, -12, 0, 0],
    [5, 10, -12, 0, 66], [5, 10, 49, 0, 6]
  ])("calculates weeks=%s velocity=%s available=%s incoming=%s", (targetWeeks, weeklyVelocity, trueAvailable, onOrder, expected) => {
    expect(calculateCoverageRecommendation({ ...facts, targetWeeks, weeklyVelocity, trueAvailable, onOrder })
      .recommended_qty_rounded).toBe(expected);
  });
  it.each(["Core", "Limited Core"] as const)("keeps source, workbench, and preview in agreement for %s", policy => {
    const source = calculateSourceRecommendation({ ...facts, settings, referenceDate: "2026-10-01", isCore: policy === "Core" });
    const row = { id: "wine", supplier_name: "Supplier", replenishment_policy: policy,
      weekly_velocity: 10, true_available: 5, on_order: 4, pack_size: 6, fob: 10,
      approved_qty: 24, recommendation_status: "edited", lock_version: 8,
      ...source } as unknown as Recommendation;
    const display = applySupplierTargetWeeks([row], {})[0];
    expect(display).toMatchObject({ ...source, approved_qty: 24, recommendation_status: "edited", lock_version: 8 });
    expect(previewOrderingLogicImpact([row], settings).changedSkus).toBe(0);
    expect(applySupplierTargetWeeks([row], { Supplier: 8 }, 5, 2.5)[0]).toMatchObject({
      target_qty: 25, recommended_qty_rounded: 18, approved_qty: 24
    });
  });
  it("does not add a case from floating-point dust at a coverage or pack boundary", () => {
    const velocity = 43.45 / 4.345;
    expect(calculateCoverageRecommendation({ ...facts, weeklyVelocity: velocity, trueAvailable: 50, onOrder: 0 }).recommended_qty_rounded).toBe(0);
    expect(calculateCoverageRecommendation({ ...facts, weeklyVelocity: velocity, trueAvailable: 44, onOrder: 0 }).recommended_qty_rounded).toBe(6);
  });
  it("updates risk against effective coverage instead of leaving old target classifications", () => {
    const row = { replenishment_policy: "Core", weekly_velocity: 10, true_available: 30,
      on_order: 0, pack_size: 6, reorder_status: "URGENT", risk_level: "High" } as Recommendation;
    expect(applySupplierTargetWeeks([row], {}, 5, 2)[0]).toMatchObject({ recommended_qty_rounded: 0, reorder_status: "OK", risk_level: "Low" });
    expect(applySupplierTargetWeeks([row], {}, 5, 8)[0]).toMatchObject({ recommended_qty_rounded: 54, reorder_status: "URGENT", risk_level: "High" });
  });
  it.each(["Limited", "Allocated", "Special Order"] as const)("keeps %s manual-only in proposal previews", policy => {
    const row = { replenishment_policy: policy, weekly_velocity: 10, true_available: 0,
      on_order: 0, pack_size: 6, recommended_qty_rounded: 0 } as Recommendation;
    expect(previewOrderingLogicImpact([row], settings).zeroToPositive).toBe(0);
  });
});
