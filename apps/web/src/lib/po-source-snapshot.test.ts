import { describe, expect, it } from "vitest";
import { buildOrderingDraftSourceSnapshot, buildOrderingLineSourceSnapshot } from "./po-source-snapshot";
import type { Recommendation } from "./types";

const row: Recommendation = {
  id: "rec-1", report_run_id: "run-1", planning_sku: "AB12345", product_name: "Wine", product_code: "AB12345",
  supplier_name: "Supplier", brand_manager: "TDM", is_btg: false, is_core: true, last_30_day_sales: 12,
  last_60_day_sales: 20, last_90_day_sales: 30, next_30_day_forecast: 5, next_60_day_forecast: 10,
  next_90_day_forecast: 15, weekly_velocity: 3, velocity_trend_pct: 0, velocity_trend_label: "Flat",
  weeks_on_hand_with_on_order: 3, weeks_on_hand: 2, true_available: 6, on_order: 3,
  recommended_qty_rounded: 12, approved_qty: 18, recommendation_status: "edited", reorder_status: "LOW",
  risk_level: "Medium", pickup_location: "NJ", order_cost: 120, fob: 10, pack_size: 6,
  trucking_cost_per_bottle: 1, landed_cost: 132, order_path: "di",
  diagnostics: { quickbooks_item_as_of: "2026-09-14T10:00:00Z", quickbooks_item_list_id: "qb-1" }
};

describe("PO source snapshots", () => {
  it("records database/API provenance and keeps approved quantity distinct from the recommendation", () => {
    const snapshot = buildOrderingLineSourceSnapshot({
      row, reportRunId: "run-1", approvedQty: 18, recommendedQty: 12, trucking: 1,
      orderingSource: "database", vinosmithAvailableAsOf: "2026-09-14T12:00:00Z",
      runDiagnostics: { quickbooks_as_of: "2026-09-14T09:00:00Z" }
    });
    expect(snapshot).toMatchObject({
      ordering_source: "database", source_systems: ["quickbooks", "vinosmith_available", "stem"],
      approved_qty: 18, recommended_qty: 12, quickbooks_as_of: "2026-09-14T10:00:00Z",
      vinosmith_available_as_of: "2026-09-14T12:00:00Z"
    });
  });

  it("captures current supplier logistics and source timestamps on the draft", () => {
    const snapshot = buildOrderingDraftSourceSnapshot({
      supplier: "Supplier", reportRunId: "run-1", path: "stateside", orderingSource: "database",
      vinosmithAvailableAsOf: "2026-09-14T12:00:00Z", runDiagnostics: { quickbooks_as_of: "2026-09-14T10:00:00Z" },
      metadata: { id: "s-1", importer_id: null, name: "Supplier", eta_days: 7, pick_up_location: "NJ", freight_forwarder: "FF", order_frequency: "weekly", tdm: "TDM", trucking_cost_per_bottle: 1, notes: null, active: true },
      lines: [{ recommended_qty: 12, approved_qty: 18, wine_cost: 180, laid_in_cost: 18, landed_cost: 198 }]
    });
    expect(snapshot).toMatchObject({ ordering_source: "database", quickbooks_as_of: "2026-09-14T10:00:00Z", supplier_logistics: { eta_days: 7, tdm: "TDM" }, totals: { approved_qty: 18 } });
  });
});
