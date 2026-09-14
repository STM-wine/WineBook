import { describe, expect, it } from "vitest";
import { applyQuickBooksOnOrderToRecommendations } from "./quickbooks-on-order";
import type { Recommendation } from "./types";

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
    report_run_id: "run-1",
    planning_sku: null,
    product_name: "Test Wine",
    product_code: "AB12345",
    supplier_name: "Test Supplier",
    brand_manager: null,
    is_btg: false,
    is_core: false,
    last_30_day_sales: 0,
    last_60_day_sales: 0,
    last_90_day_sales: 0,
    next_30_day_forecast: 0,
    next_60_day_forecast: 0,
    next_90_day_forecast: 0,
    weekly_velocity: 4,
    velocity_trend_pct: null,
    velocity_trend_label: null,
    weeks_on_hand_with_on_order: 3,
    weeks_on_hand: 2,
    true_available: 8,
    on_order: 4,
    recommended_qty_rounded: 12,
    approved_qty: 0,
    recommendation_status: "rejected",
    reorder_status: "LOW",
    risk_level: "Low",
    pickup_location: null,
    order_cost: 0,
    fob: 10,
    pack_size: 12,
    trucking_cost_per_bottle: 0,
    landed_cost: 0,
    ...overrides
  };
}

describe("QuickBooks on-order overlay", () => {
  it("replaces report on_order with the active QuickBooks quantity_on_order and recalculates weeks", () => {
    const [row] = applyQuickBooksOnOrderToRecommendations(
      [recommendation()],
      [
        {
          list_id: "qb-1",
          name: "Wrong fallback",
          full_name: null,
          is_active: true,
          item_type: "Inventory",
          quantity_on_order: "10",
          custom_fields: {
            ItemNumber: { value: "ab12345" }
          }
        }
      ]
    );

    expect(row.on_order).toBe(10);
    expect(row.weeks_on_hand_with_on_order).toBe(4.5);
  });

  it("leaves rows unchanged when the matching QuickBooks item is inactive", () => {
    const original = recommendation();
    const [row] = applyQuickBooksOnOrderToRecommendations(
      [original],
      [
        {
          list_id: "qb-1",
          name: "AB12345",
          full_name: null,
          is_active: false,
          item_type: "Inventory",
          quantity_on_order: 10,
          custom_fields: null
        }
      ]
    );

    expect(row).toBe(original);
  });

  it("clamps negative QuickBooks on-order quantities to zero", () => {
    const [row] = applyQuickBooksOnOrderToRecommendations(
      [recommendation()],
      [
        {
          list_id: "qb-1",
          name: "AB12345",
          full_name: null,
          is_active: true,
          item_type: "Inventory",
          quantity_on_order: -2,
          custom_fields: null
        }
      ]
    );

    expect(row.on_order).toBe(0);
    expect(row.weeks_on_hand_with_on_order).toBe(2);
  });
});
