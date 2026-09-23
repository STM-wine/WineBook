import { describe, expect, it } from "vitest";
import {
  applyApprovalCommitments,
  applySupplierTargetWeeks,
  applyVinosmithAvailability,
  DEFAULT_SUPPLIER_TARGET_WEEKS,
  filterRecommendations,
  formatVelocityTrend,
  mergeSupplierCatalogRows,
  removeSupplierCatalogWineFromWorkbench,
  replaceSupplierCatalogWineInWorkbench,
  recommendationMatchesCatalogWine,
  sortSupplierGroups
} from "./order-data";
import type { ApprovalCommitment, Recommendation, SupplierCatalogWine } from "./types";

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

  it("only surfaces an inactive catalog item when it was explicitly restored for this report", () => {
    const inactive = catalogWine({
      product_lifecycle_status: "inactive",
      workbench_items: [{
        id: "workbench-1",
        report_run_id: "run-1",
        supplier_catalog_wine_id: "catalog-1",
        recommendation_status: "rejected",
        recommended_qty: 6,
        approved_qty: 0,
        order_path: "stateside",
        active: true,
        notes: null,
        created_by: null,
        created_at: "2026-09-13T00:00:00Z",
        updated_at: "2026-09-13T00:00:00Z"
      }]
    });

    expect(mergeSupplierCatalogRows([], [inactive], "another-run")).toHaveLength(0);
    expect(mergeSupplierCatalogRows([], [inactive], "run-1")).toHaveLength(1);
  });

  it("does not duplicate the same catalog row when its supplier is blank", () => {
    const wine = catalogWine({ supplier_name: "" });
    const existing = recommendation({
      supplier_name: null,
      supplier_catalog_wine_id: wine.id,
      planning_sku: wine.planning_sku
    });

    expect(mergeSupplierCatalogRows([existing], [wine], "run-1")).toEqual([existing]);
  });

  it("replaces an edited catalog wine in the visible workbench without losing its order state", () => {
    const original = recommendation({
      id: "workbench-1",
      supplier_catalog_wine_id: "catalog-1",
      supplier_catalog_workbench_item_id: "workbench-1",
      recommended_qty_rounded: 12,
      approved_qty: 6,
      recommendation_status: "edited",
      order_path: "di"
    });
    const editedWine = catalogWine({
      display_name: "Domaine Vacheron Sancerre Blanc Les Garennes 2022 6/750ml",
      planning_sku: "domaine vacheron sancerre blanc les garennes 2022 6/750ml",
      vintage: "2022",
      fob_bottle: 10,
      laid_in_per_bottle: 2
    });

    const [updated] = replaceSupplierCatalogWineInWorkbench([original], editedWine, "run-1");

    expect(updated.product_name).toBe(editedWine.display_name);
    expect(updated.id).toBe("workbench-1");
    expect(updated.approved_qty).toBe(6);
    expect(updated.recommendation_status).toBe("edited");
    expect(updated.order_path).toBe("di");
    expect(updated.order_cost).toBe(120);
    expect(updated.landed_cost).toBe(144);
  });

  it("removes a deleted catalog wine from the visible workbench", () => {
    const deleted = recommendation({ supplier_catalog_wine_id: "catalog-1" });
    const retained = recommendation({ id: "rec-2", supplier_catalog_wine_id: "catalog-2" });

    expect(removeSupplierCatalogWineFromWorkbench([deleted, retained], "catalog-1")).toEqual([retained]);
  });
});

describe("order summary display and filters", () => {
  it("suppresses only the exact approval version already entered in QuickBooks", () => {
    const baseCommitment: ApprovalCommitment = {
      id: "commitment-1",
      report_run_id: "run-1",
      source_type: "recommendation",
      source_id: "rec-1",
      source_lock_version: 1,
      purchase_order_draft_id: "draft-1",
      draft_revision_no: 1,
      quantity: 12,
      actor_id: "buyer-1",
      created_at: "2026-09-22T00:00:00Z"
    };

    const [processed] = applyApprovalCommitments([
      recommendation({ recommendation_status: "approved", approved_qty: 12, lock_version: 1 })
    ], [baseCommitment]);
    expect(processed).toMatchObject({
      committed_qty: 12,
      outstanding_approved_qty: 0,
      approval_processing_status: "committed"
    });

    const [increased] = applyApprovalCommitments([
      recommendation({ recommendation_status: "edited", approved_qty: 18, lock_version: 1 })
    ], [baseCommitment]);
    expect(increased).toMatchObject({
      committed_qty: 12,
      outstanding_approved_qty: 6,
      approval_processing_status: "partially_committed"
    });

    const [freshDecision] = applyApprovalCommitments([
      recommendation({ recommendation_status: "edited", approved_qty: 18, lock_version: 2 })
    ], [baseCommitment]);
    expect(freshDecision).toMatchObject({
      committed_qty: 0,
      outstanding_approved_qty: 18,
      approval_processing_status: "unprocessed"
    });
  });

  it("formats velocity direction as a signed percentage while preserving non-computable labels", () => {
    expect(formatVelocityTrend(recommendation({ velocity_trend_pct: 100, velocity_trend_label: "Up" }))).toBe("+100%");
    expect(formatVelocityTrend(recommendation({ velocity_trend_pct: -50, velocity_trend_label: "Down" }))).toBe("-50%");
    expect(formatVelocityTrend(recommendation({ velocity_trend_pct: 0, velocity_trend_label: "Flat" }))).toBe("0%");
    expect(formatVelocityTrend(recommendation({ velocity_trend_pct: null, velocity_trend_label: "New" }))).toBe("New");
  });

  it("filters workbench rows by replenishment policy", () => {
    const rows = [
      recommendation({ id: "core", replenishment_policy: "Core" }),
      recommendation({ id: "limited", replenishment_policy: "Limited" }),
      recommendation({ id: "special", replenishment_policy: "Special Order" })
    ];
    expect(filterRecommendations(rows, {
      supplier: "All",
      brandManager: "All",
      search: "",
      suggestedOnly: false,
      replenishmentPolicy: "Limited"
    }).map((row) => row.id)).toEqual(["limited"]);
  });

  it("sorts suggested orders by bottle quantity and offers value as a separate sort", () => {
    const groups = [
      { supplier: "North Berkeley", recommendedBottles: 726, suggestedValue: 13662.52 },
      { supplier: "Broadbent Selections", recommendedBottles: 996, suggestedValue: 8512.51 },
      { supplier: "VINTUS LLC", recommendedBottles: 684, suggestedValue: 10363.67 }
    ].map((group) => ({
      ...group,
      rows: [],
      skuCount: 0,
      urgentCount: 0,
      freeGoodProgramCount: 0,
      approvedBottles: 0,
      approvedValue: 0
    }));

    expect(sortSupplierGroups(groups, "default").map((group) => group.supplier)).toEqual([
      "Broadbent Selections",
      "North Berkeley",
      "VINTUS LLC"
    ]);
    expect(sortSupplierGroups(groups, "value").map((group) => group.supplier)).toEqual([
      "North Berkeley",
      "VINTUS LLC",
      "Broadbent Selections"
    ]);
  });
});

describe("live Order Review inventory and target weeks", () => {
  it("replaces the report snapshot with current Vinosmith availability and recalculates coverage", () => {
    const [updated] = applyVinosmithAvailability([
      recommendation({ product_code: "abc000001", true_available: 99, weekly_velocity: 2, on_order: 4 })
    ], new Map([["ABC000001", 2]]));

    expect(updated.true_available).toBe(2);
    expect(updated.weeks_on_hand).toBe(1);
    expect(updated.weeks_on_hand_with_on_order).toBe(3);
  });

  it("treats a report item absent from the latest Vinosmith inventory snapshot as zero available", () => {
    const [updated] = applyVinosmithAvailability([
      recommendation({ product_code: "ABC000001", true_available: 99, weekly_velocity: 2 })
    ], new Map());

    expect(updated.true_available).toBe(0);
    expect(updated.weeks_on_hand).toBe(0);
  });

  it("preserves negative Vinosmith Available values exactly", () => {
    const [updated] = applyVinosmithAvailability([
      recommendation({ product_code: "ABC000001", true_available: 99, weekly_velocity: 2 })
    ], new Map([["ABC000001", -6]]));

    expect(updated.true_available).toBe(-6);
    expect(updated.weeks_on_hand).toBe(-3);
  });

  it("uses five target weeks by default, keeps supplier overrides, and lets a global override win", () => {
    const row = recommendation({
      supplier_name: "Stateside",
      weekly_velocity: 10,
      true_available: 20,
      on_order: 0,
      pack_size: 12,
      fob: 10,
      trucking_cost_per_bottle: 1,
      recommended_qty_rounded: 96
    });

    expect(DEFAULT_SUPPLIER_TARGET_WEEKS).toBe(5);
    expect(applySupplierTargetWeeks([row], {})[0].recommended_qty_rounded).toBe(36);
    expect(applySupplierTargetWeeks([row], { Stateside: 6 })[0].recommended_qty_rounded).toBe(48);
    expect(applySupplierTargetWeeks([row], { Stateside: 0 })[0].recommended_qty_rounded).toBe(0);
    expect(applySupplierTargetWeeks([row], { Stateside: 8 }, DEFAULT_SUPPLIER_TARGET_WEEKS, 2)[0].recommended_qty_rounded).toBe(0);
  });

  it("sets every automatic supplier recommendation from the same global target", () => {
    const rows = [
      recommendation({ id: "stateside", supplier_name: "Stateside", weekly_velocity: 10, true_available: 0, pack_size: 12 }),
      recommendation({ id: "valkyrie", supplier_name: "Valkyrie", weekly_velocity: 4, true_available: 0, pack_size: 6 }),
      recommendation({
        id: "direct-import",
        supplier_name: "Direct Import",
        order_path: "di",
        weekly_velocity: 10,
        true_available: 0,
        pack_size: 12,
        recommended_qty_rounded: 13440
      })
    ];

    const updated = applySupplierTargetWeeks(rows, { Stateside: 8, Valkyrie: 9 }, DEFAULT_SUPPLIER_TARGET_WEEKS, 2);

    expect(updated.map((row) => row.recommended_qty_rounded)).toEqual([24, 12, 24]);
  });

  it("keeps a manually suppressed Select wine at zero during target-week recalculation", () => {
    const [updated] = applySupplierTargetWeeks([recommendation({
      replenishment_policy: "Limited Core",
      recommendations_suppressed: true,
      weekly_velocity: 100,
      true_available: 0,
      recommended_qty_rounded: 540,
      order_cost: 9000,
      landed_cost: 9300
    })], {}, DEFAULT_SUPPLIER_TARGET_WEEKS, 8);

    expect(updated).toMatchObject({
      recommended_qty_rounded: 0,
      order_cost: 0,
      landed_cost: 0
    });
  });

  it("never restores an older vintage suppressed by the source builder", () => {
    const olderVintage = recommendation({
      product_name: "Averaen Willamette Valley Pinot Noir 2023 12/750ml",
      weekly_velocity: 23.5,
      true_available: 0,
      on_order: 0,
      pack_size: 12,
      fob: 11.2,
      trucking_cost_per_bottle: 1,
      recommended_qty_rounded: 120,
      order_cost: 1344,
      landed_cost: 1464,
      diagnostics: {
        vintage: 2023,
        latest_active_vintage: 2024,
        is_latest_active_vintage: false,
        older_vintage_suppressed: true,
        automatic_recommendation: false
      }
    });

    expect(applySupplierTargetWeeks([olderVintage], {})[0]).toMatchObject({
      recommended_qty_rounded: 0,
      order_cost: 0,
      landed_cost: 0
    });
  });

  it("preserves the saved one-case quantity for a new workbench wine without sales velocity", () => {
    const newWine = recommendation({
      supplier_catalog_wine_id: "catalog-1",
      supplier_catalog_workbench_item_id: "workbench-1",
      is_new_item: true,
      weekly_velocity: 0,
      pack_size: 6,
      recommended_qty_rounded: 6
    });

    const updated = applySupplierTargetWeeks([newWine], {});
    expect(updated[0].recommended_qty_rounded).toBe(6);
    expect(filterRecommendations(updated, {
      supplier: "All",
      brandManager: "All",
      search: "",
      suggestedOnly: true
    })).toHaveLength(1);
  });
});
