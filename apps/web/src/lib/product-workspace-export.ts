import ExcelJS from "exceljs";
import type { ProductWorkspaceRow } from "./product-workspace-types";

const headers = [
  "Item #", "Product", "Brand", "Supplier", "Revenue", "Replenishment", "Auto reorder", "FOB", "Laid-in",
  "Frontline", "Best", "Lowest GP", "Status", "Source", "Vintage", "Pack", "Landed cost",
  "Current FL DA", "Current Best DA", "Current On 1-Case", "Current On 1-Case DA",
  "New FL", "New FL GP %", "New Best", "New Best GP %", "New On 1-Case", "New DA", "New On 1-Case GP %", "Review notes",
  "Original FOB", "Original laid-in", "Original New FL", "Original New Best", "Original New On 1-Case", "Original New DA"
];

const editableColumns = ["H", "I", "V", "X", "Z", "AA"];
const originalColumns = ["AD", "AE", "AF", "AG", "AH", "AI"];

export function onOneCaseLevels(row: ProductWorkspaceRow) {
  return row.priceLevels.filter((level) => /^(on)?1case$/.test(level.name.toLowerCase().replace(/[^a-z0-9]/g, "")));
}

function gpFormula(row: number, price: string, da: string, priceValue: number | null, cost: number | null, allowance: number) {
  const result = priceValue !== null && priceValue > 0 && cost !== null
    ? Math.round(((priceValue - Math.max(0, cost - allowance)) / priceValue) * 10000) / 10000 : "";
  return {
    formula: `IF(AND(ISNUMBER(${price}${row}),${price}${row}>0,ISNUMBER(Q${row}),ISNUMBER(${da}${row})),ROUND((${price}${row}-MAX(0,Q${row}-${da}${row}))/${price}${row},4),"")`,
    result
  };
}

/** Builds a snapshot of the visible rows; no live pricing is changed. */
export function buildProductWorkspaceWorkbook(rows: ProductWorkspaceRow[], generatedAt: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Stem Intelligence";
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet("Pricing model", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  sheet.columns = headers.map((header, index) => ({ header, width: index === 1 || index === 28 ? 48 : index === 3 || index === 12 ? 28 : 19 }));
  rows.forEach((product) => {
    const landedCost = product.fob !== null && product.laidIn !== null
      ? Math.round((product.fob + product.laidIn) * 100) / 100 : null;
    const flDa = product.priceLevels.find((level) => level.isFrontline)?.depletionAllowance ?? 0;
    const bestDa = product.priceLevels.find((level) => level.isBest)?.depletionAllowance ?? 0;
    const candidates = onOneCaseLevels(product);
    const oneCase = candidates.length === 1 ? candidates[0] : null;
    const notes = [
      flDa !== 0 ? "Existing FL DA retained." : "",
      bestDa !== 0 ? "Existing Best DA retained." : "",
      candidates.length === 0 ? "No On 1-Case match; enter price and DA." : "",
      candidates.length > 1 ? "Multiple On 1-Case matches; review Price levels tab and enter price/DA." : "",
    ].filter(Boolean).join(" ");
    const row = sheet.addRow([
      product.itemCode, product.productName, product.brand, product.supplierName, product.revenueCenter,
      product.orderingMarker.replenishmentPolicy,
      product.orderingMarker.replenishmentPolicy === "Allocated" || product.orderingMarker.replenishmentPolicy === "Special Order"
        ? "Manual only"
        : product.orderingMarker.recommendationsSuppressed ? "Paused" : "Automatic",
      product.fob, product.laidIn, product.frontline, product.bestPrice,
      product.lowestGpPercent === null ? null : product.lowestGpPercent / 100,
      product.statusLabel, product.sourceHealthLabel, product.vintage, product.pack, product.landedCost,
      flDa, bestDa, oneCase?.bottlePrice ?? null, oneCase?.depletionAllowance ?? null,
      product.frontline, null, product.bestPrice, null, oneCase?.bottlePrice ?? null, oneCase?.depletionAllowance ?? 0, null, notes
    ]);
    row.getCell("Q").value = {
      formula: `IF(COUNT(H${row.number}:I${row.number})=2,ROUND(H${row.number}+I${row.number},2),"")`,
      result: landedCost ?? ""
    };
    row.getCell("W").value = gpFormula(row.number, "V", "R", product.frontline, landedCost, flDa);
    row.getCell("Y").value = gpFormula(row.number, "X", "S", product.bestPrice, landedCost, bestDa);
    row.getCell("AB").value = gpFormula(row.number, "Z", "AA", oneCase?.bottlePrice ?? null, landedCost, oneCase?.depletionAllowance ?? 0);
    row.getCell("AC").value = {
      formula: `"${notes.replace(/"/g, '""')}"&IF(ISNUMBER(Q${row.number}),"","${notes ? " " : ""}Missing landed cost; scenario GP unavailable.")`,
      result: notes + (landedCost === null ? `${notes ? " " : ""}Missing landed cost; scenario GP unavailable.` : "")
    };
    for (const column of ["H", "I", "J", "K", "Q", "R", "S", "T", "U", "V", "X", "Z", "AA"]) row.getCell(column).numFmt = '"$"#,##0.00';
    for (const column of ["L", "W", "Y", "AB"]) row.getCell(column).numFmt = "0.00%";
    for (const [index, column] of editableColumns.entries()) {
      const cell = row.getCell(column);
      row.getCell(originalColumns[index]).value = cell.value;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      cell.font = { bold: true, color: { argb: "FF0000FF" } };
      cell.dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: "Use a positive number or zero", error: "Enter a numeric price or DA of zero or more.", errorStyle: "stop" };
    }
    row.alignment = { vertical: "middle" };
    for (const column of ["A", "B", "C", "D", "M", "N", "P", "AC"]) {
      row.getCell(column).alignment = { wrapText: true, vertical: "middle" };
    }
    row.height = Math.max(notes || landedCost === null ? 58 : 32, Math.ceil(product.productName.length / 42) * 15 + 8);
  });
  for (const [index, column] of editableColumns.entries()) {
    const original = originalColumns[index];
    sheet.getColumn(original).hidden = true;
    if (rows.length) sheet.addConditionalFormatting({
      ref: `${column}2:${column}${rows.length + 1}`,
      rules: [{ type: "expression", priority: index + 1,
        formulae: [`OR(ISBLANK(${column}2)<>ISBLANK(${original}2),${column}2<>${original}2)`],
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } } }
      }]
    });
  }
  const levels = workbook.addWorksheet("Price levels");
  levels.columns = ["Item #", "Product", "Price level", "Bottle price", "DA per bottle", "Current GP %", "Source", "Frontline", "Best"].map((header, i) => ({ header, width: i === 1 ? 48 : 24 }));
  for (const product of rows) for (const level of product.priceLevels) {
    const row = levels.addRow([product.itemCode, product.productName, level.name, level.bottlePrice, level.depletionAllowance, level.calculatedGpPercent === null ? null : level.calculatedGpPercent / 100, level.source, level.isFrontline ? "Yes" : "No", level.isBest ? "Yes" : "No"]);
    row.getCell(4).numFmt = row.getCell(5).numFmt = '"$"#,##0.00';
    row.getCell(6).numFmt = "0.00%";
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = Math.max(32, Math.ceil(product.productName.length / 42) * 15 + 8, Math.ceil(level.name.length / 22) * 15 + 8);
  }
  const guide = workbook.addWorksheet("Read me");
  guide.columns = [{ header: "Pricing model guide", width: 28 }, { header: "Details", width: 110 }];
  guide.addRows([
    ["Source", "https://stmhq.com/?view=product-workspace"],
    ["Data timestamp", generatedAt],
    ["Products exported", rows.length],
    ["Scope", "Current filtered products, in the same sort order as the workspace."],
    ["How to use", "Bold blue inputs are editable: FOB, laid-in, New FL, New Best, New On 1-Case and New DA. Changed inputs turn bright yellow; restoring the starting value removes the highlight. Landed cost and scenario GP recalculate. Edits do not update Stem."],
    ["Units", "All prices, costs and DAs are per bottle, including the On 1-Case price level."],
    ["GP formula", "(Price - MAX(0, landed cost - DA)) / Price. Landed cost is FOB plus laid-in. GP is rounded to 2 percentage decimals, matching the workspace calculation."],
    ["DA treatment", "New DA applies only to New On 1-Case. FL and Best retain their current DA, normally zero. Exceptions are flagged in Review notes."],
    ["Missing values", "Blank, zero or nonnumeric prices produce blank GP. Missing landed cost produces blank GP. Missing or ambiguous On 1-Case matches are flagged; review the Price levels tab."],
    ["Current GP", "Current GP values are preserved from the workspace. Supplier Hub values may use its saved calculation; scenario GP uses this workspace's landed-cost formula."],
    ["Price levels", "The Price levels tab preserves all current source price levels and their individual DAs for reference."]
  ]);
  guide.eachRow((row) => { row.alignment = { wrapText: true, vertical: "top" }; row.height = 44; });
  for (const tab of [sheet, levels, guide]) {
    tab.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    tab.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF203E36" } };
    tab.getRow(1).alignment = { wrapText: true, vertical: "middle" };
    tab.getRow(1).height = 34;
  }
  // Include the hidden starting values so they move with their product when sorting.
  sheet.autoFilter = { from: "A1", to: `AI${Math.max(1, sheet.rowCount)}` };
  levels.autoFilter = { from: "A1", to: `I${Math.max(1, levels.rowCount)}` };
  levels.views = [{ state: "frozen", ySplit: 1 }];
  return workbook;
}
