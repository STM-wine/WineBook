import ExcelJS from "exceljs";
import { access } from "node:fs/promises";
import path from "node:path";
import type { PurchaseOrderDraftWithLines, SupplierLogistics } from "./types";
import { poExportLines, type PoExportLine } from "./po-utils";

async function templatePath() {
  const candidates = [
    path.join(process.cwd(), "templates/po_draft_template_stm.xlsx"),
    path.join(process.cwd(), "../../templates/po_draft_template_stm.xlsx"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next likely monorepo/runtime location.
    }
  }

  return null;
}

function copyRowStyle(sheet: ExcelJS.Worksheet, sourceRowNumber: number, targetRowNumber: number, maxColumn: number) {
  const sourceRow = sheet.getRow(sourceRowNumber);
  const targetRow = sheet.getRow(targetRowNumber);

  for (let column = 1; column <= maxColumn; column += 1) {
    const source = sourceRow.getCell(column);
    const target = targetRow.getCell(column);
    target.style = { ...source.style };
  }
}

function buildFallbackWorkbook(lines: PoExportLine[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("POs");
  sheet.columns = [
    { header: "Supplier", key: "supplier", width: 28 },
    { header: "Producer", key: "producer", width: 28 },
    { header: "Quantity", key: "quantity", width: 10 },
    { header: "Code", key: "code", width: 14 },
    { header: "Item Warning", key: "itemWarning", width: 28 },
    { header: "Wine", key: "wine", width: 48 },
    { header: "FOB", key: "fob", width: 12 },
    { header: "Laid In Cost", key: "laidInPerBottle", width: 14 }
  ];
  sheet.getRow(1).font = { bold: true };

  let previousSupplier: string | null = null;
  for (const line of lines) {
    if (previousSupplier !== null && line.supplier !== previousSupplier) {
      sheet.addRow({});
    }
    previousSupplier = line.supplier;
    sheet.addRow({
      supplier: line.supplier,
      producer: line.producer,
      quantity: line.quantity,
      code: line.code,
      itemWarning: line.itemWarning,
      wine: line.wine,
      fob: line.fob,
      laidInPerBottle: line.laidInPerBottle
    });
  }

  return workbook;
}

export async function poTemplateXlsxBuffer(drafts: PurchaseOrderDraftWithLines[], suppliers: SupplierLogistics[] = []) {
  const lines = poExportLines(drafts, suppliers);
  const workbook = new ExcelJS.Workbook();
  const existingTemplate = await templatePath();

  if (!existingTemplate) {
    const fallback = buildFallbackWorkbook(lines);
    return Buffer.from(await fallback.xlsx.writeBuffer());
  }

  await workbook.xlsx.readFile(existingTemplate);
  const sheet = workbook.worksheets[0] || workbook.addWorksheet("POs");
  const startRow = 4;
  const templateStyleRow = 4;
  const maxColumn = Math.max(sheet.columnCount, 23);

  if (sheet.rowCount >= startRow) {
    for (let rowNumber = startRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      for (let column = 1; column <= maxColumn; column += 1) {
        row.getCell(column).value = null;
      }
    }
  }

  let excelRow = startRow;
  let previousSupplier: string | null = null;

  for (const line of lines) {
    if (previousSupplier !== null && line.supplier !== previousSupplier) {
      copyRowStyle(sheet, templateStyleRow, excelRow, maxColumn);
      excelRow += 1;
    }
    previousSupplier = line.supplier;
    copyRowStyle(sheet, templateStyleRow, excelRow, maxColumn);
    sheet.getCell(excelRow, 1).value = line.supplier;
    sheet.getCell(excelRow, 2).value = line.producer;
    sheet.getCell(excelRow, 3).value = line.quantity;
    sheet.getCell(excelRow, 4).value = line.code;
    sheet.getCell(excelRow, 5).value = line.wine;
    sheet.getCell(excelRow, 6).value = line.fob;
    sheet.getCell(excelRow, 7).value = line.laidInPerBottle;
    if (line.itemWarning) {
      for (let column = 1; column <= 7; column += 1) {
        sheet.getCell(excelRow, column).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF2CC" }
        };
      }
    }
    excelRow += 1;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
