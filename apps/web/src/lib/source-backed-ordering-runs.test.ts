import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ORDERING_BUILDER_VERSION, ORDERING_SOURCE } from "./source-backed-ordering";
import {
  catalogReconciliationUpdates,
  missingSourceRowsForRun,
  overlayCurrentSourceRows,
  sourceRunNeedsCurrentOverlay
} from "./ordering-run-overlay";

describe("source-backed ordering run compatibility", () => {
  it("rehydrates source runs created before the current builder version", () => {
    expect(sourceRunNeedsCurrentOverlay({
      run_type: "quickbooks_sync",
      diagnostics: { ordering_source: ORDERING_SOURCE, builder_version: ORDERING_BUILDER_VERSION - 1 }
    })).toBe(true);

    expect(sourceRunNeedsCurrentOverlay({
      run_type: "quickbooks_sync",
      report_date: "2026-09-23",
      diagnostics: { ordering_source: ORDERING_SOURCE, builder_version: ORDERING_BUILDER_VERSION }
    }, "2026-09-23")).toBe(false);

    expect(sourceRunNeedsCurrentOverlay({
      run_type: "manual_upload",
      diagnostics: { ordering_source: ORDERING_SOURCE, builder_version: 1 }
    })).toBe(false);
  });

  it("rehydrates a prior-day source run so dated suppressions resume automatically", () => {
    expect(sourceRunNeedsCurrentOverlay({
      run_type: "quickbooks_sync",
      report_date: "2026-09-22",
      diagnostics: { ordering_source: ORDERING_SOURCE, builder_version: ORDERING_BUILDER_VERSION }
    }, "2026-09-23")).toBe(true);
  });

  it("replaces stale source calculations while preserving buyer state and row identity", () => {
    const saved = {
      id: "recommendation-1",
      report_run_id: "run-1",
      product_code: " mon000043 ",
      product_name: "Montinore Estate Red Cap Pinot Noir 2023",
      last_30_day_sales: 0,
      weekly_velocity: 0,
      recommended_qty_rounded: 0,
      recommendation_status: "edited",
      approved_qty: 24,
      order_path: "stateside"
    };
    const current = {
      product_code: "MON000043",
      product_name: "Montinore Estate Red Cap Pinot Noir 2023",
      last_30_day_sales: 479,
      weekly_velocity: 479 / 4.345,
      recommended_qty_rounded: 420,
      recommendation_status: "rejected",
      approved_qty: 0,
      order_path: "di"
    };

    expect(overlayCurrentSourceRows([saved as never], [current])).toEqual([
      expect.objectContaining({
        id: "recommendation-1",
        report_run_id: "run-1",
        product_code: "MON000043",
        last_30_day_sales: 479,
        recommended_qty_rounded: 420,
        recommendation_status: "edited",
        approved_qty: 24,
        order_path: "stateside"
      })
    ]);
  });

  it("refreshes Ronchi NBI000363 from the locked Sep 15 total without changing its buyer decision", () => {
    const saved = {
      id: "ronchi-recommendation",
      report_run_id: "locked-sep-15-run",
      product_code: "NBI000363",
      product_name: "Ronchi Barbaresco 2022 12/750ml",
      last_30_day_sales: 21,
      recommendation_status: "approved",
      approved_qty: 12,
      order_path: "stateside"
    };
    const current = {
      product_code: "NBI000363",
      product_name: "Ronchi Barbaresco 2022 12/750ml",
      last_30_day_sales: 50,
      recommendation_status: "rejected",
      approved_qty: 0,
      order_path: "di"
    };

    expect(overlayCurrentSourceRows([saved as never], [current])).toEqual([
      expect.objectContaining({
        id: "ronchi-recommendation",
        report_run_id: "locked-sep-15-run",
        product_code: "NBI000363",
        last_30_day_sales: 50,
        recommendation_status: "approved",
        approved_qty: 12,
        order_path: "stateside"
      })
    ]);
  });

  it("finds newly discovered QuickBooks items that are absent from a locked ordering run", () => {
    const saved = [{ product_code: "OLD0001", planning_sku: "old wine 2022 12/750ml" }];
    const current = [
      { product_code: "OLD0001", planning_sku: "old wine 2022 12/750ml" },
      { product_code: "AE000004", planning_sku: "amulet estate proprietary red wine 2022 3/750ml" }
    ];

    expect(missingSourceRowsForRun(saved, current)).toEqual([current[1]]);
  });

  it("canonicalizes a linked supplier alias and reconciles an exact catalog wine to QuickBooks", () => {
    const updates = catalogReconciliationUpdates(
      [{
        id: "catalog-1",
        supplier_id: "supplier-1",
        supplier_name: "Amulet",
        display_name: "Amulet Estate Proprietary Red Wine 2022 3/750ml",
        planning_sku: "amulet estate proprietary red wine 2022 3/750ml",
        quickbooks_item_number: null,
        quickbooks_sync_status: "not_created"
      }],
      [{
        product_code: "AE000004",
        product_name: "Amulet Estate Proprietary Red Wine 2022 3/750ml",
        planning_sku: "amulet estate proprietary red wine 2022 3/750ml",
        diagnostics: {
          supplier_id: "supplier-1",
          quickbooks_item_list_id: "qb-item-1"
        }
      }],
      new Map([["supplier-1", "Amulet Estate"]])
    );

    expect(updates).toEqual([{
      id: "catalog-1",
      values: expect.objectContaining({
        supplier_name: "Amulet Estate",
        quickbooks_item_id: "qb-item-1",
        quickbooks_item_number: "AE000004",
        quickbooks_sync_status: "linked",
        conversion_status: "exact_existing_product",
        product_lifecycle_status: "supplier_available"
      })
    }]);
  });

  it("does not auto-link a New Item when duplicate QuickBooks rows make the identity ambiguous", () => {
    const catalog = {
      id: "catalog-duplicate",
      supplier_id: "supplier-1",
      supplier_name: "Illahe",
      display_name: "Illahe Viognier 2027 12/750ml",
      planning_sku: "illahe viognier 2027 12/750ml",
      quickbooks_item_number: null,
      quickbooks_sync_status: "not_created"
    };
    const source = {
      product_name: catalog.display_name,
      planning_sku: catalog.planning_sku,
      diagnostics: { supplier_id: "supplier-1" }
    };

    expect(catalogReconciliationUpdates(
      [catalog],
      [
        { ...source, product_code: "ILL000031", diagnostics: { ...source.diagnostics, quickbooks_item_list_id: "qb-1" } },
        { ...source, product_code: "ILL000032", diagnostics: { ...source.diagnostics, quickbooks_item_list_id: "qb-2" } }
      ],
      new Map([["supplier-1", "Illahe"]])
    )).toEqual([]);
  });

  it("reconciles legacy pack formatting to one authoritative QuickBooks SKU", () => {
    const updates = catalogReconciliationUpdates(
      [{
        id: "catalog-vacheron",
        supplier_id: "supplier-nbi",
        supplier_name: "North Berkeley",
        display_name: "Domaine Vacheron Sancerre Blanc Les Romains 6/750 2024 6/750ml",
        planning_sku: "domaine vacheron sancerre blanc les romains 6/750 2024 6/750ml",
        vintage: "2024",
        pack_size: 6,
        bottle_size: "750ml",
        quickbooks_item_number: null,
        quickbooks_sync_status: "not_created"
      }],
      [{
        product_code: "NBI000392",
        product_name: "Domaine Vacheron Sancerre Blanc Les Romains 2024 6/750",
        planning_sku: "NBI000392",
        pack_size: 6,
        diagnostics: {
          vintage: 2024,
          supplier_id: "supplier-nbi",
          quickbooks_item_list_id: "qb-les-romains"
        }
      }],
      new Map([["supplier-nbi", "North Berkeley"]])
    );

    expect(updates).toEqual([{
      id: "catalog-vacheron",
      values: expect.objectContaining({
        quickbooks_item_id: "qb-les-romains",
        quickbooks_item_number: "NBI000392",
        quickbooks_sync_status: "linked",
        conversion_status: "exact_existing_product",
        product_lifecycle_status: "supplier_available"
      })
    }]);
  });

  it("repairs a missing catalog supplier from the exact QuickBooks item number", () => {
    const updates = catalogReconciliationUpdates(
      [{
        id: "catalog-illahe",
        supplier_id: null,
        supplier_name: "",
        display_name: "Illahe Willamette Valley Pinot Noir 2024 12/750ml",
        planning_sku: "illahe willamette valley pinot noir 2024 12/750ml",
        quickbooks_item_number: "ILL000030",
        quickbooks_sync_status: "linked"
      }],
      [{
        product_code: "ill000030",
        product_name: "Illahe Willamette Valley Pinot Noir 2024 12/750ml",
        planning_sku: "illahe willamette valley pinot noir 2024 12/750ml",
        diagnostics: {
          supplier_id: "supplier-illahe",
          quickbooks_item_list_id: "qb-illahe-pinot"
        }
      }],
      new Map([["supplier-illahe", "Illahe"]])
    );

    expect(updates).toEqual([{
      id: "catalog-illahe",
      values: {
        supplier_id: "supplier-illahe",
        supplier_name: "Illahe"
      }
    }]);
  });
});
