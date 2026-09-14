import { describe, expect, it } from "vitest";
import { mergeSupplierCatalogRows, recommendationMatchesCatalogWine } from "./order-data";
import type { Recommendation, SupplierCatalogWine } from "./types";

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
    report_run_id: "run-1",
    planning_sku: "official-vacheron-2025",
    product_name: "Domaine Vacheron Sancerre Blanc 2025 6/750ml",
    product_code: "VC25001",
    supplier_name: "Stateside",
    brand_manager: null,
    is_btg: false,
    is_core: false,
    last_30_day_sales: 0,
    last_60_day_sales: 0,
    last_90_day_sales: 0,
    next_30_day_forecast: 0,
    next_60_day_forecast: 0,
    next_90_day_forecast: 0,
    weekly_velocity: 0,
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
    fob: 0,
    pack_size: 6,
    trucking_cost_per_bottle: 0,
    landed_cost: 0,
    ...overrides
  };
}

function catalogWine(overrides: Partial<SupplierCatalogWine> = {}): SupplierCatalogWine {
  return {
    id: "catalog-1",
    supplier_id: null,
    supplier_name: "Stateside",
    producer: "Domaine Vacheron",
    wine_name: "Sancerre Blanc",
    vintage: "2025",
    pack_size: 6,
    bottle_size: "750ml",
    pricing_basis: "bottle",
    fob_bottle: 0,
    fob_case: 0,
    laid_in_per_bottle: 0,
    landed_bottle_cost: 0,
    frontline_bottle_price: 0,
    best_price: null,
    gross_profit_margin: 0,
    availability_status: "available",
    conversion_status: "net_new_product",
    display_name: "Domaine Vacheron Sancerre Blanc 2025 6/750ml",
    planning_sku: "domaine vacheron sancerre blanc 2025 6/750ml",
    planning_sku_without_vintage: "domaine vacheron sancerre blanc 6/750ml",
    diagnostics: null,
    quickbooks_item_id: null,
    quickbooks_item_name: null,
    quickbooks_item_number: null,
    quickbooks_sync_status: "not_created",
    product_lifecycle_status: "pending_product_creation",
    accounting_create_payload: null,
    created_at: "2026-09-13T00:00:00Z",
    updated_at: "2026-09-13T00:00:00Z",
    ...overrides
  };
}

describe("supplier catalog recommendation merge", () => {
  it("recognizes the real item by exact supplier, display name, and pack even when SKUs differ", () => {
    expect(recommendationMatchesCatalogWine(recommendation(), catalogWine())).toBe(true);
    expect(mergeSupplierCatalogRows([recommendation()], [catalogWine()], "run-1")).toHaveLength(1);
  });

  it("trusts the matching embedded format when a recommendation retained the default pack size", () => {
    expect(recommendationMatchesCatalogWine(
      recommendation({ pack_size: 12 }),
      catalogWine({ pack_size: 6 })
    )).toBe(true);
  });

  it("does not hide a same-named wine from another supplier or pack", () => {
    expect(recommendationMatchesCatalogWine(recommendation(), catalogWine({ supplier_name: "Another Supplier" }))).toBe(false);
    expect(recommendationMatchesCatalogWine(
      recommendation(),
      catalogWine({
        pack_size: 12,
        display_name: "Domaine Vacheron Sancerre Blanc 2025 12/750ml",
        quickbooks_item_name: "Domaine Vacheron Sancerre Blanc 2025 12/750ml"
      })
    )).toBe(false);
  });

  it("still matches a linked catalog wine by item number", () => {
    expect(recommendationMatchesCatalogWine(
      recommendation({ product_name: "Renamed in the report" }),
      catalogWine({ quickbooks_item_number: "vc25001" })
    )).toBe(true);
  });
});
