import ExcelJS from "exceljs";
import {
  canonicalFieldForHeader,
  normalizeFieldValue
} from "./normalization";
import { SUPPLIER_OFFER_PARSER_VERSION, type SupplierOfferParser } from "./parser";
import type { SupplierOfferExtractedFieldDraft } from "./types";

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && value.text) return String(value.text);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || "").join("");
    }
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return String(value.result);
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function rowValues(row: ExcelJS.Row, maxColumn: number) {
  return Array.from({ length: maxColumn }, (_, index) => cellText(row.getCell(index + 1)).trim());
}

function detectHeaderRow(sheet: ExcelJS.Worksheet) {
  const maxColumn = Math.max(sheet.columnCount, 1);
  let best = { rowNumber: 1, confidence: 0, mappedHeaders: 0 };

  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 12); rowNumber += 1) {
    const values = rowValues(sheet.getRow(rowNumber), maxColumn);
    const mappedHeaders = values.filter((value) => canonicalFieldForHeader(value).field).length;
    const nonEmpty = values.filter(Boolean).length;
    const confidence = nonEmpty > 0 ? mappedHeaders / Math.max(nonEmpty, 1) : 0;
    if (mappedHeaders > best.mappedHeaders || (mappedHeaders === best.mappedHeaders && confidence > best.confidence)) {
      best = { rowNumber, confidence, mappedHeaders };
    }
  }

  return best;
}

export const xlsxSupplierOfferParser: SupplierOfferParser = {
  canParse(input) {
    const name = input.fileName.toLowerCase();
    return (
      input.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls")
    );
  },
  async parse(input) {
    const workbook = new ExcelJS.Workbook();
    const bytes = input.bytes;
    const workbookData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await workbook.xlsx.load(workbookData as ArrayBuffer);
    const rows = [];
    const sheetDiagnostics = [];

    for (const sheet of workbook.worksheets) {
      if (sheet.actualRowCount <= 0) continue;
      const maxColumn = Math.max(sheet.columnCount, 1);
      const header = detectHeaderRow(sheet);
      const headers = rowValues(sheet.getRow(header.rowNumber), maxColumn);
      sheetDiagnostics.push({
        sheet_name: sheet.name,
        header_row: header.rowNumber,
        header_confidence: header.confidence,
        mapped_headers: header.mappedHeaders,
        row_count: sheet.rowCount
      });

      for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const values = rowValues(row, maxColumn);
        if (values.every((value) => !value)) continue;
        const rawRow = Object.fromEntries(headers.map((headerValue, index) => [headerValue || `column_${index + 1}`, values[index] || ""]));
        const fields: SupplierOfferExtractedFieldDraft[] = headers.flatMap((headerValue, index) => {
          const { field, confidence } = canonicalFieldForHeader(headerValue);
          if (!field) return [];
          const cell = row.getCell(index + 1);
          const originalValue = values[index] || "";
          return [{
            canonicalField: field,
            sourceHeader: headerValue,
            sourceColumn: String(index + 1),
            sourceCellRef: cell.address,
            originalValue,
            normalizedValue: normalizeFieldValue(field, originalValue),
            dataType: "text",
            extractionMethod: "xlsx_header_mapping",
            confidence: Math.min(0.98, confidence * Math.max(0.65, header.confidence || 0.65)),
            evidence: {
              fileName: input.fileName,
              sheetName: sheet.name,
              rowNumber,
              columnHeader: headerValue,
              columnKey: String(index + 1),
              cellRef: cell.address,
              rawValue: originalValue,
              rawRow
            }
          }];
        });

        rows.push({
          sourceKind: "spreadsheet_row" as const,
          sheetName: sheet.name,
          rowNumber,
          rawRow,
          rawText: values.join(" | "),
          rowConfidence: fields.length ? fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length : 0,
          fields
        });
      }
    }

    return {
      parserType: "xlsx",
      parserVersion: SUPPLIER_OFFER_PARSER_VERSION,
      rows,
      diagnostics: {
        workbook_name: input.fileName,
        sheets: sheetDiagnostics,
        row_count: rows.length
      }
    };
  }
};
