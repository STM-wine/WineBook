import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { poTemplateXlsxBuffer } from "./po-export";
import type { PurchaseOrderDraftWithLines } from "./types";

function draft(): PurchaseOrderDraftWithLines {
  return {
    id: "draft-1",
    report_run_id: "run-1",
    ordering_source: "report",
    source_snapshot: null,
    supplier_name: "North Berkeley",
    status: "draft",
    po_number: null,
    notes: "Order path: Stateside.",
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    lines: [{
      id: "line-1",
      purchase_order_draft_id: "draft-1",
      recommendation_id: "recommendation-1",
      supplier_catalog_wine_id: null,
      producer_name: "Domaine Vacheron",
      product_name: "Sancerre Blanc 2025 6/750ml",
      product_code: "BI00001",
      planning_sku: "sancerre-blanc-2025",
      recommended_qty: 6,
      approved_qty: 12,
      fob: 20,
      line_cost: 240,
      trucking_cost_per_bottle: 0.54,
      wine_cost: 240,
      laid_in_cost: 6.48,
      landed_cost: 246.48,
      is_new_item: false,
      new_item_warning: null,
      source_snapshot: null
    }]
  };
}

describe("PO workbook export", () => {
  it("writes Frontline and Best into template columns H and I", async () => {
    const buffer = await poTemplateXlsxBuffer([draft()], [], {
      "line-1": { frontline: 38, best: 36 }
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.worksheets[0];

    expect(sheet.getCell("H4").value).toBe(38);
    expect(sheet.getCell("I4").value).toBe(36);
  });
});
