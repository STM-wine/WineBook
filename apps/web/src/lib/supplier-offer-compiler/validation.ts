import { fieldHasUsableEvidence } from "./evidence";
import type {
  SupplierOfferCandidateDraft,
  SupplierOfferPricingTraceDraft,
  SupplierOfferValidationResultDraft
} from "./types";

const INVENTORY_DOCUMENT_TYPES = new Set(["inventory", "allocation"]);

function fieldConfidence(candidate: SupplierOfferCandidateDraft, fieldName: string) {
  return candidate.fields.find((field) => field.canonicalField === fieldName)?.confidence ?? 0;
}

export function validateSupplierOfferCandidate(input: {
  candidate: SupplierOfferCandidateDraft;
  pricingTrace?: SupplierOfferPricingTraceDraft | null;
}): SupplierOfferValidationResultDraft[] {
  const { candidate, pricingTrace } = input;
  const results: SupplierOfferValidationResultDraft[] = [];
  const displayName = typeof candidate.metadata?.displayName === "string" ? candidate.metadata.displayName : "";

  if (!displayName.trim() && (!candidate.producer?.trim() || !candidate.wineName?.trim())) {
    results.push({
      fieldName: "wine_name",
      ruleCode: "missing_display_name",
      severity: "blocker",
      message: "Display name cannot be built from the extracted producer and wine name."
    });
  }
  if (!candidate.producer?.trim()) {
    results.push({ fieldName: "producer", ruleCode: "missing_producer", severity: "blocker", message: "Producer is required to identify the wine." });
  }
  if (!candidate.wineName?.trim()) {
    results.push({ fieldName: "wine_name", ruleCode: "missing_wine_name", severity: "blocker", message: "Wine name is required to identify the wine." });
  }
  if (!candidate.vintage?.trim()) {
    results.push({ fieldName: "vintage", ruleCode: "missing_vintage", severity: "blocker", message: "Vintage must be present or explicitly normalized as NV." });
  } else if (!/^(?:NV|N\/V|19\d{2}|20\d{2})$/i.test(candidate.vintage)) {
    results.push({ fieldName: "vintage", ruleCode: "impossible_vintage", severity: "blocker", message: "Vintage must be a four-digit year or NV." });
  } else if (candidate.metadata?.vintageExtractedFromWineName) {
    results.push({ fieldName: "vintage", ruleCode: "vintage_inferred_from_name", severity: "warning", message: "Vintage was inferred from the trailing year in the wine name." });
  }
  if (!candidate.fob || candidate.fob <= 0) {
    results.push({ fieldName: "fob", ruleCode: "missing_fob", severity: "blocker", message: "FOB/cost is required for a priced supplier offer." });
  }
  if (!candidate.packSize || candidate.packSize < 1) {
    results.push({ fieldName: "pack_size", ruleCode: "invalid_pack_size", severity: "blocker", message: "Pack size must be a positive number." });
  }
  if (!candidate.bottleSize?.trim()) {
    results.push({ fieldName: "bottle_size", ruleCode: "missing_bottle_size", severity: "blocker", message: "Bottle size is required for pricing and ordering." });
  }
  if (INVENTORY_DOCUMENT_TYPES.has(candidate.documentType) && !candidate.quantity) {
    results.push({ fieldName: "quantity", ruleCode: "missing_quantity", severity: "blocker", message: "Quantity is required for inventory/allocation offers." });
  }
  if (candidate.overallConfidence < 0.7) {
    results.push({ ruleCode: "low_compiler_confidence", severity: "warning", message: "Compiler confidence is below the review threshold.", details: { compiler_confidence: candidate.overallConfidence } });
  }
  if (pricingTrace && pricingTrace.calculatedMargin > 0 && pricingTrace.calculatedMargin < 0.28) {
    results.push({ ruleCode: "margin_below_target", severity: "warning", message: "Calculated margin is below the 28% floor.", details: { calculated_margin: pricingTrace.calculatedMargin } });
  }

  for (const field of candidate.fields) {
    if (["producer", "wine_name", "vintage", "pack_size", "bottle_size", "fob", "quantity"].includes(field.canonicalField) && !fieldHasUsableEvidence(field)) {
      results.push({ fieldName: field.canonicalField, ruleCode: "missing_field_evidence", severity: "blocker", message: `${field.canonicalField} requires source evidence before approval.` });
    }
    if (["producer", "wine_name", "vintage", "pack_size", "bottle_size", "fob", "quantity"].includes(field.canonicalField) && field.confidence < 0.7) {
      results.push({ fieldName: field.canonicalField, ruleCode: "low_field_confidence", severity: "warning", message: `${field.canonicalField} has low extraction confidence.`, details: { confidence: field.confidence } });
    }
  }

  for (const [fieldName, label] of [["appellation", "Appellation"], ["region", "Region"], ["country", "Country"], ["grape", "Varietal"]] as const) {
    const value = candidate[fieldName === "grape" ? "grape" : fieldName];
    if (!value) {
      results.push({ fieldName, ruleCode: `missing_${fieldName}`, severity: "info", message: `${label} was not found; this does not block offer review.` });
    } else if (fieldConfidence(candidate, fieldName) < 0.7) {
      results.push({ fieldName, ruleCode: `low_${fieldName}_confidence`, severity: "info", message: `${label} extraction has low confidence.` });
    }
  }

  return results;
}
