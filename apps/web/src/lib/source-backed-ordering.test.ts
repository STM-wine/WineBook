import { describe, expect, it } from "vitest";
import { DEFAULT_ORDERING_LOGIC_SETTINGS } from "./ordering-logic";
import {
  buildSourceBackedOrderingRows,
  calculateSourceRecommendation,
  carryForwardBuyerState,
  quickBooksPackSize,
  type SourceQuickBooksItem,
  type SourceSalesWindows
} from "./source-backed-ordering";

const settings = { ...DEFAULT_ORDERING_LOGIC_SETTINGS, monthly_mode_enabled: false };

function qb(overrides: Partial<SourceQuickBooksItem> = {}): SourceQuickBooksItem {
  return {
    list_id: "qb-1", name: "AB12345", full_name: "Domaine Test 2025 6/750ml", sales_desc: "Domaine Test Blanc 2025",
    is_active: true, item_type: "Inventory", quantity_on_hand: 99, quantity_on_order: 3,
    purchase_cost: 10, average_cost: 8, custom_fields: { "PACK SIZE": "6", item_number: "AB12345" },
    raw_data: { preferred_vendor_ref: { ListID: "vendor-1", FullName: "Mapped Vendor" } }, last_seen_at: "2026-09-14T10:00:00Z",
    ...overrides
  };
}

function sales(overrides: Partial<SourceSalesWindows> = {}): SourceSalesWindows {
  return { last30: 20, last60: 30, last90: 40, prior30: 10, next30Ly: 8, next60Ly: 16, next90Ly: 24, ...overrides };
}

function build(overrides: Partial<Parameters<typeof buildSourceBackedOrderingRows>[0]> = {}) {
  return buildSourceBackedOrderingRows({
    quickBooksItems: [qb()],
    vinosmithWines: [{ wine_id: "wine-1", code: " ab12345 ", name: "Vinosmith Name", importer_name: "Fallback Supplier" }],
    vinosmithAvailableByCode: new Map([["AB12345", 5]]),
    vinosmithAvailableAsOf: "2026-09-14T12:00:00Z", quickBooksAsOf: "2026-09-14T10:00:00Z",
    suppliers: [
      { id: "supplier-1", name: "Mapped Supplier", eta_days: 7, pick_up_location: "NJ", freight_forwarder: "FF", order_frequency: "weekly", tdm: "Alex", trucking_cost_per_bottle: 1, active: true },
      { id: "supplier-2", name: "Fallback Supplier", eta_days: 5, pick_up_location: "NY", freight_forwarder: null, order_frequency: null, tdm: null, trucking_cost_per_bottle: 2, active: true }
    ],
    quickBooksVendors: [{ list_id: "vendor-1", name: "Mapped Vendor", full_name: "Mapped Vendor" }],
    vendorMappings: [{ quickbooks_vendor_list_id: "vendor-1", supplier_id: "supplier-1", vendor_classification: "inventory_wine" }],
    markers: [{
      item_code: "ab12345", quickbooks_item_list_id: "qb-1", is_btg: false, is_core: true,
      replenishment_policy: "Core", policy_family_key: "vinosmith name", family_default_policy: "Core"
    }],
    salesByCode: new Map([["AB12345", sales()]]), settings, referenceDate: "2026-09-14", ...overrides
  });
}

describe("source-backed ordering rows", () => {
  it("joins QB, Vinosmith Available, sales, markers, and suppliers by normalized exact code", () => {
    const result = build();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      product_code: "AB12345", product_name: "Domaine Test Blanc 2025", supplier_name: "Mapped Supplier",
      true_available: 5, on_order: 3, fob: 10, pack_size: 6, is_btg: false, is_core: true,
      replenishment_policy: "Core", recommendations_suppressed: false,
      last_30_day_sales: 20, next_60_day_forecast: 16, brand_manager: "Alex"
    });
    expect(result.rows[0].diagnostics).toMatchObject({ quickbooks_item_list_id: "qb-1", vinosmith_wine_id: "wine-1", supplier_source: "quickbooks_preferred_vendor" });
    expect(result.diagnostics).toMatchObject({ ordering_source: "quickbooks_vinosmith_stem", uses_rb6: false, uses_rads: false });
  });

  it("filters inactive and non-inventory QuickBooks items", () => {
    expect(build({ quickBooksItems: [qb({ is_active: false }), qb({ list_id: "qb-2", item_type: "Service" })] }).rows).toHaveLength(0);
  });

  it("distinguishes a real zero Available value from a missing Vinosmith inventory row", () => {
    const zero = build({ vinosmithAvailableByCode: new Map([["AB12345", 0]]) });
    const missing = build({ vinosmithAvailableByCode: new Map() });
    expect(zero.rows[0].true_available).toBe(0);
    expect(zero.diagnostics.missing_vinosmith_available).toBe(0);
    expect(missing.diagnostics.missing_vinosmith_available).toBe(1);
  });

  it("preserves a negative Vinosmith Available value instead of substituting another inventory bucket", () => {
    expect(build({ vinosmithAvailableByCode: new Map([["AB12345", -2]]) }).rows[0].true_available).toBe(-2);
  });

  it("does not fuzzy-match a different Vinosmith code", () => {
    const result = build({ vinosmithWines: [{ wine_id: "wrong", code: "AB12346", name: "Similar", importer_name: "Fallback Supplier" }] });
    expect(result.diagnostics.missing_vinosmith_code).toBe(1);
    expect(result.rows[0].diagnostics.vinosmith_wine_id).toBeNull();
  });

  it("uses invoice-minus-credit net sales supplied by the QB sales window", () => {
    const result = build({ salesByCode: new Map([["AB12345", sales({ last30: 12 - 4, prior30: 7 })]]) });
    expect(result.rows[0].last_30_day_sales).toBe(8);
    expect(result.rows[0].weekly_velocity).toBeCloseTo(8 / 4.345);
  });

  it("falls back from purchase cost to average cost and reports missing cost", () => {
    expect(build({ quickBooksItems: [qb({ purchase_cost: null, average_cost: 7.5 })] }).rows[0].fob).toBe(7.5);
    expect(build({ quickBooksItems: [qb({ purchase_cost: null, average_cost: null })] }).diagnostics.missing_fob).toBe(1);
  });

  it("uses QB PACK SIZE, then item-name, then the logic default with a warning", () => {
    expect(quickBooksPackSize(qb(), 12)).toMatchObject({ packSize: 6, fromCustomField: true });
    expect(quickBooksPackSize(qb({ custom_fields: { item_number: "AB12345" }, name: "AB12345 3/750ml" }), 12)).toMatchObject({ packSize: 3, fromCustomField: false });
    expect(quickBooksPackSize(qb({ custom_fields: { item_number: "AB12345" }, name: "AB12345", full_name: "No format" }), 12)).toMatchObject({ packSize: 12, fromCustomField: false });
  });

  it("never hides an unmapped preferred vendor behind the Vinosmith importer fallback", () => {
    const result = build({ vendorMappings: [] });
    expect(result.rows[0].supplier_name).toBe("Unmapped QB Vendor: Mapped Vendor");
    expect(result.diagnostics.unmapped_preferred_vendor).toBe(1);
  });

  it("uses Vinosmith importer fallback only when QB has no preferred vendor", () => {
    const result = build({ quickBooksItems: [qb({ raw_data: {} })] });
    expect(result.rows[0].supplier_name).toBe("Fallback Supplier");
    expect(result.rows[0].diagnostics.supplier_source).toBe("vinosmith_importer_fallback");
  });

  it("defaults missing policies to Limited and removes the redundant BTG behavior", () => {
    expect(build({ markers: [] }).rows[0]).toMatchObject({
      is_core: false, is_btg: false, replenishment_policy: "Limited", recommendations_suppressed: false
    });
  });

  it("inherits the family default for a newly introduced vintage", () => {
    const result = build({
      markers: [{
        item_code: "OLD12345", quickbooks_item_list_id: null, is_btg: false, is_core: true,
        replenishment_policy: "Core", policy_family_key: "vinosmith name", family_default_policy: "Core"
      }]
    });
    expect(result.rows[0]).toMatchObject({ replenishment_policy: "Core", is_core: true });
    expect(result.rows[0].diagnostics).toMatchObject({ policy_source: "family_inherited" });
  });

  it("keeps legacy Core and BTG markers compatible during rollback", () => {
    for (const marker of [
      { item_code: "AB12345", quickbooks_item_list_id: "qb-1", is_btg: false, is_core: true },
      { item_code: "AB12345", quickbooks_item_list_id: "qb-1", is_btg: true, is_core: false }
    ]) {
      const result = build({ markers: [marker] });
      expect(result.rows[0]).toMatchObject({ replenishment_policy: "Core", is_core: true, is_btg: false });
    }
  });

  it("never automatically recommends Allocated or Special Order wines", () => {
    for (const policy of ["Allocated", "Special Order"] as const) {
      const result = build({
        markers: [{ item_code: "AB12345", quickbooks_item_list_id: "qb-1", is_btg: false, is_core: false, replenishment_policy: policy }],
        salesByCode: new Map([["AB12345", sales({ last30: 100 })]])
      });
      expect(result.rows[0]).toMatchObject({ replenishment_policy: policy, recommended_qty_raw: 0, recommended_qty_rounded: 0 });
    }
  });

  it("allows Limited recommendations to be paused without disabling manual ordering", () => {
    const result = build({
      markers: [{
        item_code: "AB12345", quickbooks_item_list_id: "qb-1", is_btg: false, is_core: false,
        replenishment_policy: "Limited", recommendations_suppressed: true
      }],
      salesByCode: new Map([["AB12345", sales({ last30: 100 })]])
    });
    expect(result.rows[0]).toMatchObject({ replenishment_policy: "Limited", recommendations_suppressed: true, recommended_qty_rounded: 0 });
  });
});

describe("recommendation math and buyer state", () => {
  it("subtracts only Available and QB On Order, then rounds to pack", () => {
    expect(calculateSourceRecommendation({ weeklyVelocity: 10, trueAvailable: 5, onOrder: 4, isBtg: false, isCore: true, packSize: 6, settings, referenceDate: "2026-09-14" })).toMatchObject({ target_qty: 10 * (30 / 7), recommended_qty_rounded: 36 });
  });

  it("carries approved quantity and DI path by exact code but excludes entered items", () => {
    const rows = build().rows;
    const prior = [{ product_code: " ab12345 ", recommendation_status: "edited", approved_qty: 18, order_path: "di" }];
    const carried = carryForwardBuyerState(rows, prior, new Set());
    expect(carried.carried).toBe(1);
    expect(carried.rows[0]).toMatchObject({ recommendation_status: "edited", approved_qty: 18, order_path: "di" });
    expect(carryForwardBuyerState(rows, prior, new Set(["AB12345"])).carried).toBe(0);
  });
});
