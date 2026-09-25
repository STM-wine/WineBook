import { describe, expect, it } from "vitest";
import { DEFAULT_ORDERING_LOGIC_SETTINGS } from "./ordering-logic";
import { MANUAL_RECOMMENDATION_PAUSE_REASON } from "./replenishment-policy";
import {
  buildSourceBackedOrderingRows,
  calculateSourceRecommendation,
  carryForwardBuyerState,
  quickBooksPackSize,
  recommendationAllowsSourceAssignmentRefresh,
  refreshSourceBackedRecommendation,
  type SourceQuickBooksItem,
  type SourceSalesWindows
} from "./source-backed-ordering";
import type { Recommendation } from "./types";

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

  it("recommends only the newest active vintage and carries the family Core policy forward", () => {
    const quickBooksItems = [
      qb({
        list_id: "qb-2024",
        name: "PAV000023",
        full_name: "PAV000023",
        sales_desc: "Pavette Pinot Noir 2024 12/750ml",
        quantity_on_hand: 10,
        quantity_on_order: 0,
        custom_fields: { "PACK SIZE": "12", item_number: "PAV000023", Vintage: "2024" }
      }),
      qb({
        list_id: "qb-2025",
        name: "PAV000029",
        full_name: "PAV000029",
        sales_desc: "Pavette Pinot Noir 2025 12/750ml",
        quantity_on_hand: 496,
        quantity_on_order: 0,
        custom_fields: { "PACK SIZE": "12", item_number: "PAV000029", Vintage: "2025" }
      })
    ];
    const vinosmithWines = [
      { wine_id: "wine-2024", code: "PAV000023", name: "Pavette Pinot Noir 2024 12/750ml", vintage: "2024", importer_name: "Fallback Supplier" },
      { wine_id: "wine-2025", code: "PAV000029", name: "Pavette Pinot Noir 2025 12/750ml", vintage: "2025", importer_name: "Fallback Supplier" }
    ];
    const markers = [
      {
        item_code: "PAV000023", quickbooks_item_list_id: "qb-2024", is_btg: false, is_core: true,
        replenishment_policy: "Core", policy_family_key: "pavette pinot noir", family_default_policy: "Core",
        note_source: "initial_upload"
      },
      {
        item_code: "PAV000029", quickbooks_item_list_id: "qb-2025", is_btg: false, is_core: false,
        replenishment_policy: "Limited Core", policy_family_key: "pavette pinot noir", family_default_policy: "Core",
        note_source: "initial_upload"
      }
    ];
    const common = {
      quickBooksItems,
      vinosmithWines,
      vinosmithAvailableByCode: new Map([["PAV000023", 10], ["PAV000029", 0]]),
      markers,
      salesByCode: new Map([["PAV000023", sales({ last30: 100 })], ["PAV000029", sales({ last30: 100 })]])
    };

    const inherited = build(common);
    const older = inherited.rows.find((row) => row.product_code === "PAV000023")!;
    const newest = inherited.rows.find((row) => row.product_code === "PAV000029")!;
    expect(inherited.rows).toHaveLength(2);
    expect(older).toMatchObject({ replenishment_policy: "Core", recommended_qty_rounded: 0 });
    expect(older.diagnostics).toMatchObject({ older_vintage_suppressed: true, latest_active_vintage: 2025 });
    expect(newest.replenishment_policy).toBe("Core");
    expect(newest.recommended_qty_rounded).toBeGreaterThan(0);
    expect(newest.diagnostics).toMatchObject({ policy_source: "family_inherited", is_latest_active_vintage: true });

    const manual = build({
      ...common,
      markers: markers.map((marker) => marker.item_code === "PAV000029"
        ? { ...marker, replenishment_policy: "Limited Core", note_source: "manual" }
        : marker)
    });
    expect(manual.rows.find((row) => row.product_code === "PAV000029")!).toMatchObject({
      replenishment_policy: "Limited Core",
      diagnostics: expect.objectContaining({ policy_source: "item_manual_override" })
    });

    const inactiveNewest = build({
      ...common,
      quickBooksItems: quickBooksItems.map((item) => item.name === "PAV000029" ? { ...item, is_active: false } : item)
    });
    expect(inactiveNewest.rows).toHaveLength(1);
    expect(inactiveNewest.rows[0].recommended_qty_rounded).toBeGreaterThan(0);
    expect(inactiveNewest.rows[0].diagnostics).toMatchObject({ is_latest_active_vintage: true, latest_active_vintage: 2024 });
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

  it("allows every automatic policy to be paused without disabling manual ordering", () => {
    for (const policy of ["Core", "Limited Core", "Limited"] as const) {
      const result = build({
        markers: [{
          item_code: "AB12345", quickbooks_item_list_id: "qb-1", is_btg: false, is_core: policy === "Core",
          replenishment_policy: policy, recommendations_suppressed: true, note_source: "manual"
        }],
        salesByCode: new Map([["AB12345", sales({ last30: 100 })]])
      });
      expect(result.rows[0]).toMatchObject({
        replenishment_policy: policy,
        recommendations_suppressed: true,
        recommended_qty_rounded: 0
      });
    }
  });

  it("recognizes the compatibility pause stored in the suppression reason", () => {
    const result = build({
      markers: [{
        item_code: "AB12345", quickbooks_item_list_id: "qb-1", is_btg: false, is_core: false,
        replenishment_policy: "Limited Core", recommendations_suppressed: false,
        suppression_reason: MANUAL_RECOMMENDATION_PAUSE_REASON, note_source: "manual"
      }],
      salesByCode: new Map([["AB12345", sales({ last30: 100 })]])
    });

    expect(result.rows[0]).toMatchObject({
      replenishment_policy: "Limited Core",
      recommendations_suppressed: true,
      recommended_qty_rounded: 0
    });
  });

  it("restores Supplier OOS recommendations on the selected resume date", () => {
    const result = build({
      referenceDate: "2026-10-15",
      markers: [{
        item_code: "AB12345", quickbooks_item_list_id: "qb-1", is_btg: false, is_core: true,
        replenishment_policy: "Core", recommendations_suppressed: true,
        suppression_reason: "Supplier OOS", suppressed_until: "2026-10-15", note_source: "manual"
      }],
      salesByCode: new Map([["AB12345", sales({ last30: 100 })]])
    });

    expect(result.rows[0].recommendations_suppressed).toBe(false);
    expect(result.rows[0].recommended_qty_rounded).toBeGreaterThan(0);
  });

  it("does not carry an unavailable item's pause onto the next vintage", () => {
    const result = build({
      quickBooksItems: [
        qb({
          list_id: "qb-2025",
          name: "SAN000025",
          sales_desc: "Domaine Test Sancerre 2025 12/750ml",
          custom_fields: { "PACK SIZE": "12", item_number: "SAN000025", Vintage: "2025" }
        }),
        qb({
          list_id: "qb-2026",
          name: "SAN000026",
          sales_desc: "Domaine Test Sancerre 2026 12/750ml",
          custom_fields: { "PACK SIZE": "12", item_number: "SAN000026", Vintage: "2026" }
        })
      ],
      vinosmithWines: [
        { wine_id: "wine-2025", code: "SAN000025", name: "Domaine Test Sancerre 2025 12/750ml", vintage: "2025", importer_name: "Fallback Supplier" },
        { wine_id: "wine-2026", code: "SAN000026", name: "Domaine Test Sancerre 2026 12/750ml", vintage: "2026", importer_name: "Fallback Supplier" }
      ],
      vinosmithAvailableByCode: new Map([["SAN000025", 0], ["SAN000026", 0]]),
      markers: [{
        item_code: "SAN000025", quickbooks_item_list_id: "qb-2025", is_btg: false, is_core: false,
        replenishment_policy: "Limited Core", policy_family_key: "domaine test sancerre",
        family_default_policy: "Limited Core", recommendations_suppressed: true, note_source: "manual"
      }],
      salesByCode: new Map([
        ["SAN000025", sales({ last30: 100 })],
        ["SAN000026", sales({ last30: 100 })]
      ])
    });

    expect(result.rows.find((row) => row.product_code === "SAN000025")).toMatchObject({
      recommendations_suppressed: true,
      recommended_qty_rounded: 0
    });
    expect(result.rows.find((row) => row.product_code === "SAN000026")).toMatchObject({
      replenishment_policy: "Limited Core",
      recommendations_suppressed: false
    });
    expect(result.rows.find((row) => row.product_code === "SAN000026")!.recommended_qty_rounded).toBeGreaterThan(0);
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

  it("refreshes current source facts without replacing the saved row or buyer decision", () => {
    const saved = {
      ...build().rows[0],
      id: "saved-recommendation",
      report_run_id: "saved-run",
      recommendation_status: "edited",
      approved_qty: 18,
      order_path: "di"
    } as Recommendation;
    const currentSales = sales({ last30: 50, last60: 70, last90: 90, prior30: 20 });
    const refreshed = refreshSourceBackedRecommendation(saved, {
      sales: currentSales,
      trueAvailable: 18,
      onOrder: 6,
      quickBooksItemAsOf: "2026-09-25T19:00:00Z",
      vinosmithAvailableAsOf: "2026-09-25T19:05:00Z"
    }, settings, "2026-09-25");
    const expected = calculateSourceRecommendation({
      weeklyVelocity: 50 / 4.345,
      trueAvailable: 18,
      onOrder: 6,
      isBtg: false,
      isCore: true,
      packSize: 6,
      settings,
      referenceDate: "2026-09-25"
    });

    expect(refreshed).toMatchObject({
      id: "saved-recommendation",
      report_run_id: "saved-run",
      recommendation_status: "edited",
      approved_qty: 18,
      order_path: "di",
      last_30_day_sales: 50,
      last_60_day_sales: 70,
      last_90_day_sales: 90,
      true_available: 18,
      on_order: 6,
      recommended_qty_rounded: expected.recommended_qty_rounded
    });
  });

  it("keeps recommendation suppression and older-vintage safeguards during a current-data refresh", () => {
    const saved = {
      ...build().rows[0],
      id: "saved-recommendation",
      report_run_id: "saved-run",
      recommendations_suppressed: true,
      suppression_reason: "Supplier OOS",
      suppressed_until: "2026-09-30",
      diagnostics: { ...build().rows[0].diagnostics, older_vintage_suppressed: true }
    } as Recommendation;
    const refreshed = refreshSourceBackedRecommendation(saved, {
      sales: sales({ last30: 100 }),
      trueAvailable: 0,
      onOrder: 0,
      quickBooksItemAsOf: "2026-09-25T19:00:00Z",
      vinosmithAvailableAsOf: "2026-09-25T19:05:00Z"
    }, settings, "2026-09-25");

    expect(refreshed.recommendations_suppressed).toBe(true);
    expect(refreshed.recommended_qty_rounded).toBe(0);
    expect(refreshed.diagnostics).toMatchObject({
      older_vintage_suppressed: true,
      automatic_recommendation: false
    });
  });

  it("refreshes a safe row to the currently mapped QuickBooks supplier and logistics", () => {
    const saved = {
      ...build().rows[0],
      id: "saved-recommendation",
      report_run_id: "saved-run",
      supplier_name: "Old Vendor Alias",
      brand_manager: null,
      trucking_cost_per_bottle: 0,
      recommendation_status: "rejected",
      approved_qty: 0
    } as Recommendation;
    const refreshed = refreshSourceBackedRecommendation(saved, {
      sales: sales({ last30: 20 }),
      trueAvailable: 5,
      onOrder: 3,
      quickBooksItemAsOf: "2026-09-25T21:32:58Z",
      vinosmithAvailableAsOf: "2026-09-25T21:34:00Z",
      supplier: {
        id: "canonical-supplier",
        name: "Grand Cru Selections",
        tdm: "Bethany",
        truckingCostPerBottle: 0.88,
        pickupLocation: "New Jersey",
        etaDays: 21,
        freightForwarder: "Dist Trans",
        orderFrequency: "as_needed",
        preferredVendorId: "active-qb-vendor",
        preferredVendorName: "Grand Cru Selections"
      }
    }, settings, "2026-09-25");

    expect(refreshed).toMatchObject({
      supplier_name: "Grand Cru Selections",
      brand_manager: "Bethany",
      pickup_location: "New Jersey",
      trucking_cost_per_bottle: 0.88,
      diagnostics: expect.objectContaining({
        supplier_id: "canonical-supplier",
        supplier_source: "quickbooks_preferred_vendor",
        quickbooks_preferred_vendor_list_id: "active-qb-vendor"
      })
    });
    expect(refreshed.landed_cost).toBeCloseTo(
      Number(refreshed.recommended_qty_rounded) * (Number(refreshed.fob) + 0.88)
    );
  });

  it("only allows current supplier reassignment for rejected, unapproved, uncommitted rows", () => {
    const row = {
      ...build().rows[0],
      id: "saved-recommendation",
      report_run_id: "saved-run",
      recommendation_status: "rejected",
      approved_qty: 0
    } as Recommendation;

    expect(recommendationAllowsSourceAssignmentRefresh(row, false)).toBe(true);
    expect(recommendationAllowsSourceAssignmentRefresh({ ...row, recommendation_status: "approved", approved_qty: 6 }, false)).toBe(false);
    expect(recommendationAllowsSourceAssignmentRefresh(row, true)).toBe(false);
  });
});
