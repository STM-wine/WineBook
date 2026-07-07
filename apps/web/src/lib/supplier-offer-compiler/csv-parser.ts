import {
  canonicalFieldForHeader,
  normalizeFieldValue
} from "./normalization";
import { SUPPLIER_OFFER_PARSER_VERSION, type SupplierOfferParser } from "./parser";
import type { SupplierOfferExtractedFieldDraft } from "./types";

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export const csvSupplierOfferParser: SupplierOfferParser = {
  canParse(input) {
    return input.contentType === "text/csv" || input.fileName.toLowerCase().endsWith(".csv");
  },
  async parse(input) {
    const text = input.bytes.toString("utf8");
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const headers = parseCsvLine(lines[0] || "");
    const rows = lines.slice(1).map((line, index) => {
      const cells = parseCsvLine(line);
      const rawRow = Object.fromEntries(headers.map((header, cellIndex) => [header || `column_${cellIndex + 1}`, cells[cellIndex] || ""]));
      const fields: SupplierOfferExtractedFieldDraft[] = headers.flatMap((header, cellIndex) => {
        const { field, confidence } = canonicalFieldForHeader(header);
        if (!field) return [];
        const originalValue = cells[cellIndex] || "";
        return [{
          canonicalField: field,
          sourceHeader: header,
          sourceColumn: String(cellIndex + 1),
          originalValue,
          normalizedValue: normalizeFieldValue(field, originalValue),
          dataType: "text",
          extractionMethod: "csv_header_mapping",
          confidence,
          evidence: {
            fileName: input.fileName,
            rowNumber: index + 2,
            columnHeader: header,
            columnKey: String(cellIndex + 1),
            rawValue: originalValue,
            rawRow
          }
        }];
      });

      return {
        sourceKind: "csv_row" as const,
        rowNumber: index + 2,
        rawRow,
        rawText: line,
        rowConfidence: fields.length ? fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length : 0,
        fields
      };
    });

    return {
      parserType: "csv",
      parserVersion: SUPPLIER_OFFER_PARSER_VERSION,
      rows,
      diagnostics: {
        header_row: 1,
        headers,
        row_count: rows.length
      }
    };
  }
};

