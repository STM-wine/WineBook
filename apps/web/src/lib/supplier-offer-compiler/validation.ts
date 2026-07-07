import { fieldHasUsableEvidence } from "./evidence";
import type {
  SupplierOfferCandidateDraft,
  SupplierOfferPricingTraceDraft,
  SupplierOfferValidationResultDraft
} from "./types";

export function validateSupplierOfferCandidate(input: {
  candidate: SupplierOfferCandidateDraft;
  pricingTrace?: SupplierOfferPricingTraceDraft | null;
}): SupplierOfferValidationResultDraft[] {
  const { candidate, pricingTrace } = input;
  const results: SupplierOfferValidationResultDraft[] = [];

  if (!candidate.producer?.trim()) {
    results.push({
      fieldName: "producer",
      ruleCode: "missing_producer",
      severity: "blocker",
      message: "Producer is required before approval."
    });
  }
  if (!candidate.wineName?.trim()) {
    results.push({
      fieldName: "wine_name",
      ruleCode: "missing_wine_name",
      severity: "blocker",
      message: "Wine name is required before approval."
    });
  }
  if (!candidate.vintage?.trim()) {
    results.push({
      fieldName: "vintage",
      ruleCode: "missing_vintage",
      severity: "blocker",
      message: "Vintage must be present or explicitly normalized as NV."
    });
  }
  if (!candidate.fob || candidate.fob <= 0) {
    results.push({
      fieldName: "fob",
      ruleCode: "missing_fob",
      severity: "blocker",
      message: "FOB/cost is required for a priced supplier offer."
    });
  }
  if (!candidate.packSize || candidate.packSize < 1) {
    results.push({
      fieldName: "pack_size",
      ruleCode: "invalid_pack_size",
      severity: "blocker",
      message: "Pack size must be a positive number."
    });
  }
  if (!candidate.bottleSize?.trim()) {
    results.push({
      fieldName: "bottle_size",
      ruleCode: "missing_bottle_size",
      severity: "warning",
      message: "Bottle size is missing and may need review."
    });
  }
  if (!candidate.quantity) {
    results.push({
      fieldName: "quantity",
      ruleCode: "missing_quantity",
      severity: "warning",
      message: "Available quantity is missing."
    });
  }
  if (candidate.overallConfidence < 0.7) {
    results.push({
      ruleCode: "low_candidate_confidence",
      severity: "blocker",
      message: "Candidate confidence is below review threshold.",
      details: { overall_confidence: candidate.overallConfidence }
    });
  }
  if (pricingTrace && pricingTrace.calculatedMargin > 0 && pricingTrace.calculatedMargin < 0.28) {
    results.push({
      ruleCode: "margin_below_target",
      severity: "blocker",
      message: "Calculated margin is below the 28% floor.",
      details: { calculated_margin: pricingTrace.calculatedMargin }
    });
  }

  for (const field of candidate.fields) {
    if (["producer", "wine_name", "vintage", "fob"].includes(field.canonicalField) && !fieldHasUsableEvidence(field)) {
      results.push({
        fieldName: field.canonicalField,
        ruleCode: "missing_field_evidence",
        severity: "blocker",
        message: `${field.canonicalField} requires source evidence before approval.`
      });
    }
    if (field.confidence < 0.7) {
      results.push({
        fieldName: field.canonicalField,
        ruleCode: "low_field_confidence",
        severity: field.confidence < 0.5 ? "blocker" : "warning",
        message: `${field.canonicalField} has low extraction confidence.`,
        details: { confidence: field.confidence }
      });
    }
  }

  return results;
}

