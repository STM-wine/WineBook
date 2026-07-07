import type { SupplierOfferEvidence, SupplierOfferExtractedFieldDraft } from "./types";

export function clampConfidence(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, Math.round(parsed * 10000) / 10000));
}

export function evidenceLabel(evidence: SupplierOfferEvidence) {
  const parts = [
    evidence.fileName,
    evidence.sheetName ? `sheet ${evidence.sheetName}` : null,
    evidence.rowNumber ? `row ${evidence.rowNumber}` : null,
    evidence.columnHeader ? `column ${evidence.columnHeader}` : null,
    evidence.cellRef ? `cell ${evidence.cellRef}` : null,
    evidence.pageNumber ? `page ${evidence.pageNumber}` : null
  ].filter(Boolean);

  return parts.join(" / ");
}

export function fieldHasUsableEvidence(field: Pick<SupplierOfferExtractedFieldDraft, "evidence" | "originalValue">) {
  return Boolean(
    field.originalValue ||
      field.evidence.rawValue ||
      field.evidence.cellRef ||
      field.evidence.rowNumber ||
      field.evidence.pageNumber
  );
}

