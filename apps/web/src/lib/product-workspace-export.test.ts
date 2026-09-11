import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildProductWorkspaceWorkbook, onOneCaseLevels } from "./product-workspace-export";
import type { ProductWorkspaceRow } from "./product-workspace-types";

function product(overrides: Partial<ProductWorkspaceRow> = {}): ProductWorkspaceRow {
  return {
    itemCode: "00123", productName: "Test Wine", brand: "Test", supplierName: "Supplier", revenueCenter: "Stem Core",
    orderingMarker: { isCore: true, isBtg: false }, fob: 8, laidIn: 2, landedCost: 10,
    frontline: 20, bestPrice: 16, lowestGpPercent: 33.33, statusLabel: "Active match", sourceHealthLabel: "Ready",
    priceLevels: [
      { id: "fl", name: "Frontline", bottlePrice: 20, depletionAllowance: 0, calculatedGpPercent: 50, isFrontline: true, isBest: false, source: "Vinosmith" },
      { id: "best", name: "Best", bottlePrice: 16, depletionAllowance: 1, calculatedGpPercent: 43.75, isFrontline: false, isBest: true, source: "Vinosmith" },
      { id: "case", name: "On 1-Case", bottlePrice: 12, depletionAllowance: 2, calculatedGpPercent: 33.33, isFrontline: false, isBest: false, source: "Vinosmith" }
    ], ...overrides
  } as ProductWorkspaceRow;
}

describe("pricing model export", () => {
  it("preserves source values, DA exceptions and per-bottle scenario formulas through Excel serialization", async () => {
    const workbook = buildProductWorkspaceWorkbook([product()], "2026-09-11T12:00:00Z");
    const saved = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(saved);
    const sheet = reopened.getWorksheet("Pricing model")!;
    expect(sheet.getCell("A2").value).toBe("00123");
    expect(sheet.getCell("S2").value).toBe(1);
    expect(sheet.getCell("AA2").value).toBe(2);
    expect(sheet.getCell("W2").value).toMatchObject({ result: 0.5 });
    expect(sheet.getCell("Y2").value).toMatchObject({ result: 0.4375 });
    expect(sheet.getCell("AB2").value).toEqual({ formula: 'IF(AND(ISNUMBER(Z2),Z2>0,ISNUMBER(Q2),ISNUMBER(AA2)),ROUND((Z2-MAX(0,Q2-AA2))/Z2,4),"")', result: 0.3333 });
    expect(sheet.getCell("AC2").value).toContain("Existing Best DA retained");
    expect(reopened.getWorksheet("Price levels")!.rowCount).toBe(4);
  });

  it("leaves GP blank for missing cost or invalid prices and caps cost relief at zero", () => {
    const rows = [product({ landedCost: null }), product({ frontline: 0, bestPrice: null }), product({ landedCost: 1 })];
    const sheet = buildProductWorkspaceWorkbook(rows, "now").getWorksheet("Pricing model")!;
    // Read the cached result directly: ExcelJS omits empty strings from its value object.
    for (const address of ["W2", "W3", "Y3"]) {
      expect(sheet.getCell(address).result).toBe("");
      expect(sheet.getCell(address).formula).toContain(',4),"")');
    }
    expect(sheet.getCell("AB4").value).toMatchObject({ result: 1 });
    expect(sheet.getCell("AB4").formula).toContain("Q4-AA4");
  });

  it("accepts punctuation variants, excludes other case tiers, and flags missing or ambiguous matches", () => {
    for (const name of ["On 1- Case", "ON 1 CASE", "On-1-Case", "1 Case"]) {
      const p = product();
      p.priceLevels[2].name = name;
      expect(onOneCaseLevels(p)).toHaveLength(1);
    }
    const missing = product();
    missing.priceLevels[2].name = "On 10-Case";
    const ambiguous = product();
    ambiguous.priceLevels.push({ ...ambiguous.priceLevels[2], id: "duplicate" });
    const sheet = buildProductWorkspaceWorkbook([missing, ambiguous], "now").getWorksheet("Pricing model")!;
    expect(sheet.getCell("Z2").value).toBeNull();
    expect(sheet.getCell("AC2").value).toContain("No On 1-Case match");
    expect(sheet.getCell("Z3").value).toBeNull();
    expect(sheet.getCell("AC3").value).toContain("Multiple On 1-Case matches");
  });
});
