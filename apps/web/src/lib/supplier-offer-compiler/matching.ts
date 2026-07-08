import { normalizeSpaces, normalizeVintage } from "@/lib/supplier-catalog";
import {
  normalizeBottleSize,
  normalizePackSize,
  searchProductIdentityCandidates,
  type ProductIdentityCandidate,
  type ProductIdentityMatch
} from "@/lib/product-identity-search";
import type { SupplierOfferCandidateDraft, SupplierOfferMatchCandidateDraft } from "./types";

type MatchConflict = {
  field: "vintage" | "pack_size" | "bottle_size" | "supplier" | "fob" | "active";
  candidateValue: string | number | boolean | null;
  matchedValue: string | number | boolean | null;
  severity: "blocker" | "warning" | "info";
};

const SOURCE_TABLE: Record<ProductIdentityCandidate["source"], string> = {
  product: "products",
  supplier_catalog: "supplier_catalog_wines",
  quickbooks_item: "quickbooks_items",
  vinosmith: "vinosmith_wines",
  recommendation: "reorder_recommendations"
};

const SOURCE_LABEL: Record<ProductIdentityCandidate["source"], string> = {
  product: "Stem Product",
  supplier_catalog: "Supplier Catalog",
  quickbooks_item: "QuickBooks Item",
  vinosmith: "VinoSmith Wine",
  recommendation: "Recent Recommendation"
};

export function searchSupplierOfferIdentityMatches(
  candidate: SupplierOfferCandidateDraft,
  identityCandidates: ProductIdentityCandidate[],
  limit = 8
): ProductIdentityMatch[] {
  const query = supplierOfferIdentityQuery(candidate);
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
  );
}

export function buildSupplierOfferMatchCandidates(
  candidate: SupplierOfferCandidateDraft,
  identityCandidates: ProductIdentityCandidate[],
  limit = 8
): SupplierOfferMatchCandidateDraft[] {
  return classifySupplierOfferIdentityMatches(candidate, searchSupplierOfferIdentityMatches(candidate, identityCandidates, limit));
}

export function classifySupplierOfferIdentityMatches(
  candidate: SupplierOfferCandidateDraft,
  matches: ProductIdentityMatch[]
): SupplierOfferMatchCandidateDraft[] {
  const query = supplierOfferIdentityQuery(candidate);

  return matches.map((match, index) => {
    const conflicts = matchConflicts(candidate, match);
    const classification = classifyMatch(candidate, match, conflicts);
    const reasons = matchReasons(candidate, match, conflicts, classification.label);

    return {
      source: match.source,
      sourceId: match.sourceId,
      matchStatus: classification.matchStatus,
      score: match.score,
      rank: index + 1,
      matchedDisplayName: match.displayName,
      matchedSupplier: match.supplierName,
      matchedVintage: match.vintage,
      matchedPackSize: match.packSize,
      matchedBottleSize: match.bottleSize,
      matchedFob: match.fobBottle,
      explanation: {
        classification: classification.label,
        cost_changed: classification.costChanged,
        source_label: SOURCE_LABEL[match.source],
        source_table: SOURCE_TABLE[match.source],
        source_id: match.sourceId,
        score: match.score,
        query,
        canonical_search: "product-identity-search",
        candidate_display_name: candidate.metadata?.displayName || null,
        matched_display_name: match.displayName,
        active: match.active,
        vintage_compared: candidate.vintage,
        pack_size_compared: candidate.packSize,
        bottle_size_compared: candidate.bottleSize,
        supplier_compared: candidate.supplierName,
        fob_compared: candidate.fob,
        uploaded_normalized_identity: match.identityDiagnostics?.uploadedNormalizedIdentity || null,
        matched_normalized_identity: match.identityDiagnostics?.matchedNormalizedIdentity || null,
        uploaded_tokens: match.identityDiagnostics?.uploadedTokens || [],
        matched_tokens: match.identityDiagnostics?.matchedTokens || [],
        shared_tokens: match.identityDiagnostics?.sharedTokens || [],
        uploaded_only_identity_tokens: match.identityDiagnostics?.uploadedOnlyIdentityTokens || [],
        matched_only_identity_tokens: match.identityDiagnostics?.matchedOnlyIdentityTokens || [],
        missing_candidate_identity_tokens: match.identityDiagnostics?.missingCandidateIdentityTokens || [],
        score_penalty_applied: match.identityDiagnostics?.directionalPenalty || 0,
        penalty_reasons: match.identityDiagnostics?.penaltyReasons || [],
        pack_comparison: match.identityDiagnostics?.packMatches,
        bottle_comparison: match.identityDiagnostics?.bottleMatches,
        vintage_comparison: match.identityDiagnostics?.vintageMatches,
        conflicts,
        reasons
      }
    };
  });
}

export function supplierOfferIdentityQuery(candidate: SupplierOfferCandidateDraft) {
  return normalizeSpaces(candidate.metadata?.displayName || [candidate.producer, candidate.wineName].filter(Boolean).join(" "));
}

function classifyMatch(candidate: SupplierOfferCandidateDraft, match: ProductIdentityMatch, conflicts: MatchConflict[]) {
  const matchedOnlyTokens = match.identityDiagnostics?.matchedOnlyIdentityTokens || [];
  const uploadedOnlyTokens = match.identityDiagnostics?.uploadedOnlyIdentityTokens || [];
  const hasIdentityTokenMismatch = matchedOnlyTokens.length > 0 || uploadedOnlyTokens.length > 0;
  const sameWine = (sameIdentity(candidate, match) || match.score >= 0.72) && !hasIdentityTokenMismatch;
  const relatedWine = hasIdentityTokenMismatch && (sameIdentity(candidate, match) || match.score >= 0.36);
  const packSame = samePack(candidate, match);
  const bottleSame = sameBottle(candidate, match);
  const packagingSame = packSame && bottleSame;
  const vintageSame = sameVintage(candidate.vintage, match.vintage);
  const vintageDifferent = Boolean(candidate.vintage && match.vintage && !vintageSame);
  const costChanged = conflicts.some((conflict) => conflict.field === "fob");
  const reviewConflict = conflicts.some((conflict) => conflict.field === "supplier" || conflict.field === "active");

  if (relatedWine) {
    return { label: "Possible related wine", matchStatus: "possible_duplicate" as const, costChanged };
  }
  if (sameWine && !bottleSame) {
    return { label: "New SKU - Bottle Size", matchStatus: "conflict" as const, costChanged };
  }
  if (sameWine && !packSame) {
    return { label: "New SKU - Pack Size", matchStatus: "conflict" as const, costChanged };
  }
  if (sameWine && reviewConflict) {
    return { label: "Possible duplicate / conflict", matchStatus: "possible_duplicate" as const, costChanged };
  }
  if (sameWine && vintageSame && packagingSame && costChanged) {
    return { label: "Existing item - cost changed", matchStatus: "exact_match" as const, costChanged };
  }
  if (sameWine && vintageSame && packagingSame) {
    return { label: "Existing item", matchStatus: "exact_match" as const, costChanged };
  }
  if (sameWine && vintageDifferent && packagingSame) {
    return { label: "New vintage candidate", matchStatus: "new_vintage_candidate" as const, costChanged };
  }
  if (match.score >= 0.46) {
    return { label: "Possible duplicate", matchStatus: "possible_duplicate" as const, costChanged };
  }
  return { label: "New wine", matchStatus: "new_wine_candidate" as const, costChanged };
}

function matchConflicts(candidate: SupplierOfferCandidateDraft, match: ProductIdentityMatch): MatchConflict[] {
  const conflicts: MatchConflict[] = [];
  if (candidate.vintage && match.vintage && !sameVintage(candidate.vintage, match.vintage)) {
    conflicts.push({ field: "vintage", candidateValue: candidate.vintage, matchedValue: match.vintage, severity: "info" });
  }
  if (candidate.packSize && Number(match.packSize) && normalizePackSize(candidate.packSize) !== normalizePackSize(match.packSize)) {
    conflicts.push({ field: "pack_size", candidateValue: normalizePackSize(candidate.packSize), matchedValue: normalizePackSize(match.packSize), severity: "blocker" });
  }
  if (candidate.bottleSize && match.bottleSize && !sameBottle(candidate, match)) {
    conflicts.push({ field: "bottle_size", candidateValue: candidate.bottleSize, matchedValue: match.bottleSize, severity: "blocker" });
  }
  if (candidate.supplierId && match.supplierId && candidate.supplierId !== match.supplierId) {
    conflicts.push({ field: "supplier", candidateValue: candidate.supplierName, matchedValue: match.supplierName, severity: "warning" });
  } else if (candidate.supplierName && match.supplierName && key(candidate.supplierName) !== key(match.supplierName) && match.supplierName !== "No supplier") {
    conflicts.push({ field: "supplier", candidateValue: candidate.supplierName, matchedValue: match.supplierName, severity: "warning" });
  }
  if (candidate.fob && match.fobBottle && Math.abs(Number(candidate.fob) - Number(match.fobBottle)) >= 0.5) {
    conflicts.push({ field: "fob", candidateValue: candidate.fob, matchedValue: match.fobBottle, severity: "warning" });
  }
  if (!match.active) {
    conflicts.push({ field: "active", candidateValue: true, matchedValue: false, severity: "warning" });
  }
  return conflicts;
}

function matchReasons(candidate: SupplierOfferCandidateDraft, match: ProductIdentityMatch, conflicts: MatchConflict[], classification: string) {
  const reasons = [`Canonical identity search returned ${Math.round(match.score * 100)}% from ${SOURCE_TABLE[match.source]}.`];
  reasons.push(`Compiler review classification: ${classification}.`);
  const matchedOnlyTokens = match.identityDiagnostics?.matchedOnlyIdentityTokens || [];
  const uploadedOnlyTokens = match.identityDiagnostics?.uploadedOnlyIdentityTokens || [];
  if (matchedOnlyTokens.length) reasons.push(`Matched producer/appellation, but candidate has extra identity terms not present in uploaded row: ${matchedOnlyTokens.join(", ")}.`);
  if (uploadedOnlyTokens.length) reasons.push(`Uploaded row has identity terms missing from the matched record: ${uploadedOnlyTokens.join(", ")}.`);
  for (const reason of match.identityDiagnostics?.penaltyReasons || []) reasons.push(reason);
  if (match.identityDiagnostics?.directionalPenalty) reasons.push(`Directional identity penalty applied: ${Math.round(match.identityDiagnostics.directionalPenalty * 100)} points.`);
  if (sameIdentity(candidate, match)) reasons.push("Producer and wine name line up after normalization.");
  if (sameVintage(candidate.vintage, match.vintage)) reasons.push("Vintage matches.");
  else if (candidate.vintage && match.vintage) reasons.push("Vintage differs, which can indicate a rollover/new vintage.");
  if (samePack(candidate, match) && sameBottle(candidate, match)) reasons.push("Pack and bottle size match.");
  else if (!sameBottle(candidate, match)) reasons.push("Bottle size differs, so this is a different Stem SKU unless reviewed otherwise.");
  else if (!samePack(candidate, match)) reasons.push("Pack size differs, so this is a different Stem SKU unless reviewed otherwise.");
  if (conflicts.some((conflict) => conflict.field === "fob")) reasons.push("FOB differs from the matched record; flag for cost review.");
  if (conflicts.length) reasons.push(`${conflicts.length} conflict(s) need review: ${conflicts.map((conflict) => conflict.field).join(", ")}.`);
  return reasons;
}

function sameIdentity(candidate: SupplierOfferCandidateDraft, match: ProductIdentityMatch) {
  const candidateIdentity = key([candidate.producer, candidate.wineName].filter(Boolean).join(" "));
  const matchIdentity = key([match.producer, match.wineName].filter(Boolean).join(" "));
  if (!candidateIdentity || !matchIdentity) return false;
  return candidateIdentity === matchIdentity || matchIdentity.includes(candidateIdentity) || candidateIdentity.includes(matchIdentity);
}

function sameVintage(a: unknown, b: unknown) {
  return normalizeVintage(a) === normalizeVintage(b);
}

function samePack(candidate: SupplierOfferCandidateDraft, match: ProductIdentityMatch) {
  return Number(candidate.packSize || 0) > 0 && normalizePackSize(candidate.packSize) === normalizePackSize(match.packSize);
}

function sameBottle(candidate: SupplierOfferCandidateDraft, match: ProductIdentityMatch) {
  return normalizeBottleSize(candidate.bottleSize) === normalizeBottleSize(match.bottleSize);
}

function key(value: unknown) {
  return normalizeSpaces(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

