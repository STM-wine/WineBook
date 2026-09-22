import { describe, expect, it } from "vitest";
import { applyDiContainerRecommendations, buildDiContainerPlans, isDiOpportunity } from "./di-planning";
import type { Recommendation } from "./types";

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
    report_run_id: "run-1",
    planning_sku: "ant-moore-2024",
    product_name: "Ant Moore Sauvignon Blanc 2024 12/750ml",
    product_code: "AM24001",
    supplier_name: "Test Supplier",
    brand_manager: null,
    is_btg: false,
    is_core: true,
    last_30_day_sales: 120,
    last_60_day_sales: 240,
    last_90_day_sales: 360,
    last_365_day_sales: 1440,
    next_30_day_forecast: 0,
    next_60_day_forecast: 0,
    next_90_day_forecast: 0,
    weekly_velocity: 30,
    velocity_trend_pct: 0,
    velocity_trend_label: null,
    weeks_on_hand_with_on_order: 0,
    weeks_on_hand: 0,
    true_available: 0,
    on_order: 0,
    recommended_qty_rounded: 0,
    approved_qty: 0,
    recommendation_status: "rejected",
    reorder_status: "LOW",
    risk_level: "Low",
    pickup_location: null,
    order_cost: 0,
    fob: 10,
    pack_size: 12,
    trucking_cost_per_bottle: 1,
    landed_cost: 0,
    order_path: "di",
    ...overrides
  };
}

describe("DI vintage eligibility", () => {
  it("excludes an older suppressed vintage from container planning", () => {
    const olderVintage = recommendation({
      recommended_qty_rounded: 120,
      order_cost: 1200,
      landed_cost: 1320,
      diagnostics: {
        vintage: 2023,
        latest_active_vintage: 2024,
        older_vintage_suppressed: true
      }
    });

    expect(isDiOpportunity(olderVintage)).toBe(false);
    expect(buildDiContainerPlans([olderVintage])).toEqual([]);
    expect(applyDiContainerRecommendations([olderVintage])[0]).toMatchObject({
      recommended_qty_rounded: 0,
      order_cost: 0,
      landed_cost: 0
    });
  });

  it("excludes an item whose automatic recommendations were manually turned off", () => {
    const suppressed = recommendation({
      id: "suppressed",
      product_name: "Ant Moore Sauvignon Blanc 2025 12/750ml",
      order_path: "di",
      recommendations_suppressed: true,
      last_30_day_sales: 120,
      recommended_qty_rounded: 120
    });

    expect(isDiOpportunity(suppressed)).toBe(false);
    expect(buildDiContainerPlans([suppressed])).toEqual([]);
    expect(applyDiContainerRecommendations([suppressed])[0].recommended_qty_rounded).toBe(0);
  });
});
