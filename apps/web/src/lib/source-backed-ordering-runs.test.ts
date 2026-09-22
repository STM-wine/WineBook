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
      diagnostics: { ordering_source: ORDERING_SOURCE, builder_version: ORDERING_BUILDER_VERSION }
    })).toBe(false);

    expect(sourceRunNeedsCurrentOverlay({
      run_type: "manual_upload",
      diagnostics: { ordering_source: ORDERING_SOURCE, builder_version: 1 }
    })).toBe(false);
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
});
