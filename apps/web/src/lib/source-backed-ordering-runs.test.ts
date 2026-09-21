import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ORDERING_BUILDER_VERSION, ORDERING_SOURCE } from "./source-backed-ordering";
import { overlayCurrentSourceRows, sourceRunNeedsCurrentOverlay } from "./ordering-run-overlay";

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
});
