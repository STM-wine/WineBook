import type {
  SupplierOfferMatchCandidateDraft,
  SupplierOfferReviewTaskDraft,
  SupplierOfferValidationResultDraft
} from "./types";

export function reviewTasksFromValidationResults(results: SupplierOfferValidationResultDraft[]): SupplierOfferReviewTaskDraft[] {
  return results.map((result) => ({
    taskType: result.severity === "blocker" ? "validation_review" : "field_review",
    severity: result.severity,
    title: result.message,
    description: result.fieldName ? `Field: ${result.fieldName}` : null,
    createdByRule: result.ruleCode,
    metadata: result.details || {}
  }));
}

export function reviewTasksFromMatchCandidates(matches: SupplierOfferMatchCandidateDraft[]): SupplierOfferReviewTaskDraft[] {
  if (matches.length === 0) {
    return [{
      taskType: "match_review",
      severity: "warning",
      title: "No existing item match was found.",
      description: "Review whether this is a new wine or whether matching data is incomplete.",
      createdByRule: "no_match_candidates"
    }];
  }

  const top = matches[0];
  if (top.matchStatus === "exact_match" && top.score >= 0.9) return [];

  return [{
    taskType: "match_review",
    severity: "warning",
    title: "Likely item match needs review.",
    description: top.matchedDisplayName || "Review the suggested item match.",
    createdByRule: "likely_match_needs_review",
    metadata: {
      source: top.source,
      source_id: top.sourceId,
      score: top.score
    }
  }];
}

