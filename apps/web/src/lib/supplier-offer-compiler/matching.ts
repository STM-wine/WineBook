import {
  searchProductIdentityCandidates,
  type ProductIdentityCandidate
} from "@/lib/product-identity-search";
import type { SupplierOfferCandidateDraft, SupplierOfferMatchCandidateDraft } from "./types";

export function buildSupplierOfferMatchCandidates(
  candidate: SupplierOfferCandidateDraft,
  identityCandidates: ProductIdentityCandidate[],
  limit = 8
): SupplierOfferMatchCandidateDraft[] {
  const query = [candidate.producer, candidate.wineName].filter(Boolean).join(" ");
  if (query.trim().length < 3) return [];

  return searchProductIdentityCandidates(
    {
      query,
      producer: candidate.producer,
      vintage: candidate.vintage,
      packSize: candidate.packSize,
      bottleSize: candidate.bottleSize,
      supplierId: candidate.supplierId,
      supplierName: candidate.supplierName,
      limit
    },
    identityCandidates
  ).map((match, index) => ({
    source: match.source,
    sourceId: match.sourceId,
    matchStatus: match.score >= 0.9 ? "exact_match" : "likely_match_needs_review",
    score: match.score,
    rank: index + 1,
    matchedDisplayName: match.displayName,
    matchedSupplier: match.supplierName,
    matchedVintage: match.vintage,
    matchedPackSize: match.packSize,
    matchedBottleSize: match.bottleSize,
    matchedFob: match.fobBottle,
    explanation: {
      source_label: match.sourceLabel,
      score: match.score,
      query,
      vintage_compared: candidate.vintage,
      pack_size_compared: candidate.packSize,
      bottle_size_compared: candidate.bottleSize
    }
  }));
}

