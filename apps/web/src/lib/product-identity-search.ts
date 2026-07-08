import { asNumber } from "@/lib/order-data";
import {
  buildDisplayName,
  buildPlanningSku,
  calculatePricing,
  normalizeSpaces,
  normalizeVintage
} from "@/lib/supplier-catalog";

export type ProductIdentitySource = "supplier_catalog" | "product" | "recommendation" | "vinosmith" | "quickbooks_item";

export type ProductIdentityCandidate = {
  source: ProductIdentitySource;
  sourceId: string;
  supplierId: string | null;
  supplierName: string;
  producer: string;
  wineName: string;
  vintage: string;
  packSize: number;
  bottleSize: string;
  fobBottle: number;
  fobCase: number;
  laidInPerBottle: number;
  frontlineBottlePrice: number;
  bestPrice: number | null;
  grossProfitMargin: number;
  displayName: string;
  planningSku: string;
  planningSkuWithoutVintage: string;
  quickbooksItemNumber: string | null;
  quickbooksItemName: string | null;
  systemTags: string[];
  active: boolean;
  updatedAt: string | null;
};

export type ProductIdentityMatch = ProductIdentityCandidate & {
  score: number;
  sourceLabel: string;
  identityDiagnostics?: ProductIdentityScoreDiagnostics;
};

export type ProductIdentityScoreDiagnostics = {
  uploadedNormalizedIdentity: string;
  matchedNormalizedIdentity: string;
  uploadedTokens: string[];
  matchedTokens: string[];
  sharedTokens: string[];
  uploadedOnlyIdentityTokens: string[];
  matchedOnlyIdentityTokens: string[];
  missingCandidateIdentityTokens: string[];
  extraUploadedTokens: string[];
  directionalPenalty: number;
  penaltyReasons: string[];
  packMatches: boolean | null;
  bottleMatches: boolean | null;
  vintageMatches: boolean | null;
  baseScore: number;
  attributeScore: number;
  supplierScore: number;
  sourceWeight: number;
};

export type ParsedProductIdentityQuery = {
  producer: string;
  wineName: string;
  vintage: string | null;
  packSize: number | null;
  bottleSize: string | null;
};

type SearchInput = {
  query: string;
  producer?: string | null;
  vintage?: string | null;
  packSize?: number | null;
  bottleSize?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  limit?: number;
};

const SOURCE_WEIGHT: Record<ProductIdentitySource, number> = {
  supplier_catalog: 0.12,
  product: 0.1,
  recommendation: 0.06,
  vinosmith: 0.04,
  quickbooks_item: 0.11
};

const SOURCE_LABEL: Record<ProductIdentitySource, string> = {
  supplier_catalog: "Supplier Catalog",
  product: "Stem Product",
  recommendation: "Recent Report",
  vinosmith: "Vinosmith",
  quickbooks_item: "QuickBooks"
};

const VINTAGE_RE = /\b(?:(?:19|20)\d{2}|NV|N\/V)\b/gi;
const PACK_RE = /\b\d+\s*[/xX]\s*[0-9.]+\s*(?:ml|mL|ML|l|L)\b/g;
const PACK_PARSE_RE = /\b(\d+)\s*[/xX]\s*([0-9.]+)\s*(ml|mL|ML|l|L)\b/i;
const BROAD_WINE_TOKENS = new Set(["barolo", "barbaresco", "chianti", "brunello", "rosso", "bianco", "blanc", "rouge", "red", "white", "wine", "wines", "docg", "doc", "aoc", "aop"]);
const LOW_IDENTITY_TOKENS = new Set(["the", "and", "de", "del", "della", "di", "la", "le", "les", "il", "el", "los", "las", "da", "do", "dos", "of"]);

export function searchProductIdentityCandidates(
  input: SearchInput,
  candidates: ProductIdentityCandidate[]
): ProductIdentityMatch[] {
  const query = searchKey(input.query);
  const queryTokens = tokens(query);
  if (query.length < 3 || queryTokens.length === 0) return [];

  const scored = candidates
    .map((candidate) => {
      const candidateKeys = [
        `${candidate.producer} ${candidate.wineName}`,
        candidate.displayName,
        candidate.planningSkuWithoutVintage,
        candidate.planningSku,
        candidate.quickbooksItemName,
        candidate.quickbooksItemNumber
      ].filter(Boolean).map(searchKey);
      const baseScore = Math.max(...candidateKeys.map((key) => scoreKey(query, key)));
      const attributeScore = scoreIdentityAttributes(candidate, input);
      const supplierScore = supplierBonus(candidate, input);
      const activeScore = candidate.active ? 0.02 : 0;
      const sourceWeight = SOURCE_WEIGHT[candidate.source];
      const identityDiagnostics = scoreIdentityDirection(input, candidate, { baseScore, attributeScore, supplierScore, sourceWeight });
      const rawScore = baseScore + attributeScore + supplierScore + sourceWeight + activeScore - identityDiagnostics.directionalPenalty;
      const identityMismatchCount = identityDiagnostics.uploadedOnlyIdentityTokens.length + identityDiagnostics.matchedOnlyIdentityTokens.length;
      const identityScoreCap = identityMismatchCount
        ? identityMismatchCount >= 2 ? 0.44 : 0.49
        : 1;
      const packBottleScoreCap = identityDiagnostics.packMatches === false || identityDiagnostics.bottleMatches === false ? 0.74 : 1;
      const score = Math.max(0, Math.min(identityScoreCap, packBottleScoreCap, rawScore));
      return { ...candidate, score, sourceLabel: SOURCE_LABEL[candidate.source], identityDiagnostics };
    })
    .filter((match) => match.score >= minimumScore(queryTokens.length));

  return scored
    .sort((a, b) => b.score - a.score || sourceOrder(a.source) - sourceOrder(b.source) || newestFirst(a.updatedAt, b.updatedAt))
    .slice(0, Math.max(1, input.limit || 8));
}

export function quickbooksItemRowToCandidate(row: Record<string, unknown>): ProductIdentityCandidate {
  const name = normalizeSpaces(textValue(row.full_name) || textValue(row.name));
  const parsed = parseDisplayName(name);
  const packSize = normalizePackSize(parsed.packSize || numberFromCustomFields(row.custom_fields, ["pack_size", "pack", "unit_set"]) || 12);
  const bottleSize = normalizeBottleSize(parsed.bottleSize || textFromCustomFields(row.custom_fields, ["bottle_size", "size"]) || "750ml");
  const displayName = buildDisplayName({
    producer: parsed.producer,
    wineName: parsed.wineName,
    vintage: parsed.vintage,
    packSize,
    bottleSize
  });
  const pricing = calculatePricing({
    packSize,
    fobBottle: numberValue(row.purchase_cost),
    frontlineBottlePrice: numberValue(row.sales_price)
  });

  return {
    source: "quickbooks_item",
    sourceId: String(row.list_id || name),
    supplierId: null,
    supplierName: "QuickBooks Desktop",
    producer: parsed.producer,
    wineName: parsed.wineName,
    vintage: normalizeVintage(parsed.vintage),
    packSize,
    bottleSize,
    fobBottle: pricing.fobBottle,
    fobCase: pricing.fobCase,
    laidInPerBottle: pricing.laidInPerBottle,
    frontlineBottlePrice: pricing.frontlineBottlePrice,
    bestPrice: pricing.bestPrice,
    grossProfitMargin: pricing.grossProfitMargin,
    displayName: name || displayName,
    planningSku: buildPlanningSku(displayName),
    planningSkuWithoutVintage: buildPlanningSku(displayName, true),
    quickbooksItemNumber: stringOrNull(row.list_id),
    quickbooksItemName: name || null,
    systemTags: [],
    active: row.is_active !== false,
    updatedAt: stringOrNull(row.last_seen_at) || stringOrNull(row.time_modified)
  };
}

export function supplierCatalogRowToCandidate(row: Record<string, unknown>): ProductIdentityCandidate {
  const packSize = normalizePackSize(numberValue(row.pack_size) || 12);
  const bottleSize = normalizeBottleSize(textValue(row.bottle_size) || "750ml");
  const displayName = normalizeSpaces(textValue(row.display_name));
  const planningSku = normalizeSpaces(textValue(row.planning_sku)) || buildPlanningSku(displayName);
  const pricing = calculatePricing({
    packSize,
    fobBottle: numberValue(row.fob_bottle),
    fobCase: numberValue(row.fob_case),
    laidInPerBottle: numberValue(row.laid_in_per_bottle),
    frontlineBottlePrice: numberValue(row.frontline_bottle_price),
    bestPrice: row.best_price === null ? null : numberValue(row.best_price)
  });

  return {
    source: "supplier_catalog",
    sourceId: String(row.id || planningSku),
    supplierId: stringOrNull(row.supplier_id),
    supplierName: normalizeSpaces(row.supplier_name) || "No supplier",
    producer: normalizeSpaces(row.producer) || "Unknown Producer",
    wineName: normalizeSpaces(row.wine_name) || displayName,
    vintage: normalizeVintage(row.vintage),
    packSize,
    bottleSize,
    fobBottle: pricing.fobBottle,
    fobCase: pricing.fobCase,
    laidInPerBottle: pricing.laidInPerBottle,
    frontlineBottlePrice: pricing.frontlineBottlePrice,
    bestPrice: pricing.bestPrice,
    grossProfitMargin: pricing.grossProfitMargin,
    displayName,
    planningSku,
    planningSkuWithoutVintage: normalizeSpaces(row.planning_sku_without_vintage) || buildPlanningSku(displayName, true),
    quickbooksItemNumber: stringOrNull(row.quickbooks_item_number),
    quickbooksItemName: stringOrNull(row.quickbooks_item_name),
    systemTags: stringArray(row.system_tags),
    active: row.product_lifecycle_status !== "inactive",
    updatedAt: stringOrNull(row.updated_at)
  };
}

export function productRowToCandidate(
  row: Record<string, unknown>,
  supplierById: Map<string, { name: string; truckingCostPerBottle: number }>
): ProductIdentityCandidate {
  const supplierId = stringOrNull(row.supplier_id);
  const supplier = supplierId ? supplierById.get(supplierId) : null;
  const parsed = parseDisplayName(String(row.name || row.planning_sku || ""));
  const packSize = normalizePackSize(numberValue(row.pack_size) || parsed.packSize || 12);
  const bottleSize = normalizeBottleSize(parsed.bottleSize || "750ml");
  const pricing = calculatePricing({
    packSize,
    fobBottle: numberValue(row.current_fob),
    laidInPerBottle: supplier?.truckingCostPerBottle || 0
  });
  const displayName = buildDisplayName({
    producer: parsed.producer,
    wineName: parsed.wineName,
    vintage: row.vintage || parsed.vintage,
    packSize,
    bottleSize
  });
  const planningSku = normalizeSpaces(row.planning_sku) || buildPlanningSku(displayName);

  return {
    source: "product",
    sourceId: String(row.id || planningSku),
    supplierId,
    supplierName: supplier?.name || "No supplier",
    producer: parsed.producer,
    wineName: parsed.wineName,
    vintage: normalizeVintage(row.vintage || parsed.vintage),
    packSize,
    bottleSize,
    fobBottle: pricing.fobBottle,
    fobCase: pricing.fobCase,
    laidInPerBottle: pricing.laidInPerBottle,
    frontlineBottlePrice: pricing.frontlineBottlePrice,
    bestPrice: pricing.bestPrice,
    grossProfitMargin: pricing.grossProfitMargin,
    displayName,
    planningSku,
    planningSkuWithoutVintage: buildPlanningSku(displayName, true),
    quickbooksItemNumber: stringOrNull(row.product_code),
    quickbooksItemName: stringOrNull(row.name),
    systemTags: [row.is_core ? "Core" : "", row.is_btg ? "BTG" : ""].filter(Boolean),
    active: row.active !== false,
    updatedAt: stringOrNull(row.updated_at)
  };
}

export function recommendationRowToCandidate(row: Record<string, unknown>): ProductIdentityCandidate {
  const displaySource = String(row.product_name || row.planning_sku || "");
  const parsed = parseDisplayName(displaySource);
  const packSize = normalizePackSize(numberValue(row.pack_size) || parsed.packSize || 12);
  const bottleSize = normalizeBottleSize(parsed.bottleSize || "750ml");
  const pricing = calculatePricing({
    packSize,
    fobBottle: numberValue(row.fob),
    laidInPerBottle: numberValue(row.trucking_cost_per_bottle)
  });
  const displayName = buildDisplayName({
    producer: parsed.producer,
    wineName: parsed.wineName,
    vintage: parsed.vintage,
    packSize,
    bottleSize
  });
  const planningSku = normalizeSpaces(row.planning_sku) || buildPlanningSku(displayName);

  return {
    source: "recommendation",
    sourceId: String(row.id || planningSku),
    supplierId: null,
    supplierName: normalizeSpaces(row.supplier_name) || "No supplier",
    producer: parsed.producer,
    wineName: parsed.wineName,
    vintage: normalizeVintage(parsed.vintage),
    packSize,
    bottleSize,
    fobBottle: pricing.fobBottle,
    fobCase: pricing.fobCase,
    laidInPerBottle: pricing.laidInPerBottle,
    frontlineBottlePrice: pricing.frontlineBottlePrice,
    bestPrice: pricing.bestPrice,
    grossProfitMargin: pricing.grossProfitMargin,
    displayName,
    planningSku,
    planningSkuWithoutVintage: buildPlanningSku(displayName, true),
    quickbooksItemNumber: stringOrNull(row.product_code),
    quickbooksItemName: stringOrNull(row.product_name),
    systemTags: [row.is_core ? "Core" : "", row.is_btg ? "BTG" : ""].filter(Boolean),
    active: true,
    updatedAt: stringOrNull(row.created_at)
  };
}

export function vinosmithWineRowToCandidate(row: Record<string, unknown>): ProductIdentityCandidate {
  const parsed = parseDisplayName(String(row.name || ""));
  const producer = normalizeSpaces(textValue(row.producer_name)) || parsed.producer;
  const wineName = parsed.wineName || normalizeSpaces(textValue(row.name)) || "Unnamed Wine";
  const packSize = normalizePackSize(numberValue(row.unit_set) || parsed.packSize || 12);
  const bottleSize = normalizeBottleSize(textValue(row.bottle_size_label) || textValue(row.bottle_size) || parsed.bottleSize || "750ml");
  const pricing = calculatePricing({ packSize, fobBottle: numberValue(row.fob_price) });
  const displayName = buildDisplayName({
    producer,
    wineName,
    vintage: row.vintage || parsed.vintage,
    packSize,
    bottleSize
  });

  return {
    source: "vinosmith",
    sourceId: String(row.wine_id || row.code || displayName),
    supplierId: stringOrNull(row.supplier_id),
    supplierName: normalizeSpaces(row.importer_name) || "No supplier",
    producer,
    wineName,
    vintage: normalizeVintage(row.vintage || parsed.vintage),
    packSize,
    bottleSize,
    fobBottle: pricing.fobBottle,
    fobCase: pricing.fobCase,
    laidInPerBottle: pricing.laidInPerBottle,
    frontlineBottlePrice: pricing.frontlineBottlePrice,
    bestPrice: pricing.bestPrice,
    grossProfitMargin: pricing.grossProfitMargin,
    displayName,
    planningSku: buildPlanningSku(displayName),
    planningSkuWithoutVintage: buildPlanningSku(displayName, true),
    quickbooksItemNumber: stringOrNull(row.code),
    quickbooksItemName: stringOrNull(row.name),
    systemTags: [row.core ? "Core" : ""].filter(Boolean),
    active: row.active !== false && row.orderable !== false,
    updatedAt: stringOrNull(row.updated_at)
  };
}

function parseDisplayName(value: string) {
  const parsed = parseProductIdentityQuery(value);
  return {
    producer: parsed.producer,
    wineName: parsed.wineName,
    vintage: parsed.vintage || "NV",
    packSize: normalizePackSize(parsed.packSize || 12),
    bottleSize: normalizeBottleSize(parsed.bottleSize || "750ml")
  };
}

export function parseProductIdentityQuery(value: string): ParsedProductIdentityQuery {
  let remaining = normalizeSpaces(value);
  const packMatch = remaining.match(PACK_PARSE_RE);
  const packSize = packMatch ? normalizePackSize(packMatch[1]) : null;
  const bottleSize = packMatch ? normalizeBottleSize(`${packMatch[2]}${packMatch[3]}`) : null;
  remaining = normalizeSpaces(remaining.replace(PACK_RE, " "));
  const vintageMatch = remaining.match(VINTAGE_RE);
  const vintage = vintageMatch?.[0] || null;
  remaining = normalizeSpaces(remaining.replace(VINTAGE_RE, " "));
  const words = remaining.split(/\s+/).filter(Boolean);
  const producer = words[0] || "Unknown Producer";
  const wineName = words.slice(1).join(" ") || remaining || "Unnamed Wine";
  return { producer, wineName, vintage, packSize, bottleSize };
}

function searchKey(value: unknown) {
  return normalizeSpaces(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(PACK_RE, " ")
    .replace(VINTAGE_RE, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ");
}

function tokens(value: string) {
  return value.split(/\s+/).filter((token) => token.length > 1 && token !== "wine" && token !== "wines");
}

function scoreKey(query: string, candidate: string) {
  if (!query || !candidate) return 0;
  if (query === candidate) return 0.78;
  if (candidate.includes(query)) return 0.72;
  const queryTokens = tokens(query);
  const candidateTokens = tokens(candidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  const overlap = queryTokens.filter((token) => candidateSet.has(token)).length;
  const prefixOverlap = queryTokens.filter((token) => candidateTokens.some((candidateToken) => candidateToken.startsWith(token))).length;
  const coverage = Math.max(overlap, prefixOverlap * 0.92) / queryTokens.length;
  const precision = overlap / candidateTokens.length;
  return coverage * 0.62 + precision * 0.14;
}

function supplierBonus(candidate: ProductIdentityCandidate, input: Pick<SearchInput, "supplierId" | "supplierName">) {
  if (input.supplierId && candidate.supplierId === input.supplierId) return 0.08;
  if (input.supplierName && searchKey(candidate.supplierName) === searchKey(input.supplierName)) return 0.06;
  return 0;
}

function scoreIdentityAttributes(candidate: ProductIdentityCandidate, input: SearchInput) {
  let score = 0;
  if (input.producer && searchKey(candidate.producer) && scoreKey(searchKey(input.producer), searchKey(candidate.producer)) >= 0.6) {
    score += 0.08;
  }
  if (input.vintage && normalizeVintage(input.vintage) === normalizeVintage(candidate.vintage)) {
    score += 0.06;
  }
  if (input.packSize && normalizePackSize(candidate.packSize) === normalizePackSize(input.packSize)) {
    score += 0.04;
  }
  if (input.bottleSize && normalizeBottleSize(input.bottleSize) === normalizeBottleSize(candidate.bottleSize)) {
    score += 0.04;
  }
  return score;
}

function scoreIdentityDirection(
  input: SearchInput,
  candidate: ProductIdentityCandidate,
  scores: Pick<ProductIdentityScoreDiagnostics, "baseScore" | "attributeScore" | "supplierScore" | "sourceWeight">
): ProductIdentityScoreDiagnostics {
  const uploadedNormalizedIdentity = searchKey([input.producer, input.query].filter(Boolean).join(" ")).trim();
  const matchedNormalizedIdentity = searchKey([candidate.producer, candidate.wineName].filter(Boolean).join(" ")).trim();
  const uploadedTokens = identityTokens(uploadedNormalizedIdentity);
  const matchedTokens = identityTokens(matchedNormalizedIdentity);
  const uploadedSet = new Set(uploadedTokens);
  const matchedSet = new Set(matchedTokens);
  const sharedTokens = matchedTokens.filter((token) => uploadedSet.has(token));
  const matchedOnlyIdentityTokens = matchedTokens.filter((token) => !uploadedSet.has(token) && importantIdentityToken(token));
  const uploadedOnlyIdentityTokens = uploadedTokens.filter((token) => !matchedSet.has(token) && importantIdentityToken(token));
  const matchedImportantCount = matchedTokens.filter(importantIdentityToken).length;
  const uploadedImportantCount = uploadedTokens.filter(importantIdentityToken).length;
  const matchedOnlyRatio = matchedOnlyIdentityTokens.length / Math.max(1, matchedImportantCount);
  const uploadedOnlyRatio = uploadedOnlyIdentityTokens.length / Math.max(1, uploadedImportantCount);
  const sharedImportantCount = sharedTokens.filter(importantIdentityToken).length;
  const broadOnlyMatch = sharedImportantCount > 0
    && (matchedOnlyIdentityTokens.length > 0 || uploadedOnlyIdentityTokens.length > 0)
    && sharedTokens.some((token) => BROAD_WINE_TOKENS.has(token));
  const penaltyReasons: string[] = [];
  let directionalPenalty = Math.min(0.62,
    matchedOnlyIdentityTokens.length * 0.16 + matchedOnlyRatio * 0.22
    + uploadedOnlyIdentityTokens.length * 0.16 + uploadedOnlyRatio * 0.22
  );
  if (matchedOnlyIdentityTokens.length) {
    penaltyReasons.push(`matched record has extra identity terms: ${matchedOnlyIdentityTokens.join(", ")}`);
  }
  if (uploadedOnlyIdentityTokens.length) {
    penaltyReasons.push(`uploaded row has identity terms missing from matched record: ${uploadedOnlyIdentityTokens.join(", ")}`);
  }
  if (broadOnlyMatch) {
    directionalPenalty += 0.16;
    penaltyReasons.push("only broad producer/appellation tokens overlap");
  }
  const packMatches = input.packSize ? normalizePackSize(input.packSize) === normalizePackSize(candidate.packSize) : null;
  const bottleMatches = input.bottleSize ? normalizeBottleSize(input.bottleSize) === normalizeBottleSize(candidate.bottleSize) : null;
  const vintageMatches = input.vintage ? normalizeVintage(input.vintage) === normalizeVintage(candidate.vintage) : null;
  if (packMatches === false) penaltyReasons.push(`pack differs: ${normalizePackSize(input.packSize)} vs ${normalizePackSize(candidate.packSize)}`);
  if (bottleMatches === false) penaltyReasons.push(`bottle differs: ${normalizeBottleSize(input.bottleSize)} vs ${normalizeBottleSize(candidate.bottleSize)}`);
  directionalPenalty = Math.min(0.72, directionalPenalty);
  return {
    uploadedNormalizedIdentity,
    matchedNormalizedIdentity,
    uploadedTokens,
    matchedTokens,
    sharedTokens,
    uploadedOnlyIdentityTokens,
    matchedOnlyIdentityTokens,
    missingCandidateIdentityTokens: matchedOnlyIdentityTokens,
    extraUploadedTokens: uploadedOnlyIdentityTokens,
    directionalPenalty,
    penaltyReasons,
    packMatches,
    bottleMatches,
    vintageMatches,
    ...scores
  };
}

function identityTokens(value: unknown) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens(searchKey(value)).filter((token) => !LOW_IDENTITY_TOKENS.has(token))) {
    if (!seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}

function importantIdentityToken(token: string) {
  return token.length > 2 && !BROAD_WINE_TOKENS.has(token) && !LOW_IDENTITY_TOKENS.has(token);
}

function minimumScore(queryTokenCount: number) {
  return queryTokenCount <= 1 ? 0.56 : 0.36;
}

function sourceOrder(source: ProductIdentitySource) {
  return ["quickbooks_item", "supplier_catalog", "product", "recommendation", "vinosmith"].indexOf(source);
}

function newestFirst(a: string | null, b: string | null) {
  return (b || "").localeCompare(a || "");
}

function stringOrNull(value: unknown) {
  const normalized = normalizeSpaces(textValue(value));
  return normalized || null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => normalizeSpaces(textValue(item))).filter(Boolean) : [];
}

function textValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return value;
  return String(value);
}

function numberValue(value: unknown) {
  return asNumber(textValue(value));
}

function textFromCustomFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const fields = value as Record<string, unknown>;
  for (const key of keys) {
    const match = Object.entries(fields).find(([fieldKey]) => searchKey(fieldKey) === searchKey(key));
    if (match) return normalizeSpaces(textValue(match[1]));
  }
  return "";
}

function numberFromCustomFields(value: unknown, keys: string[]) {
  const text = textFromCustomFields(value, keys);
  return text ? numberValue(text) : 0;
}

export function normalizePackSize(value: unknown) {
  return Math.max(1, Math.trunc(Number(value) || 12));
}

export function normalizeBottleSize(value: unknown) {
  const compact = normalizeSpaces(value || "750ml").toLowerCase().replace(/\s+/g, "");
  const match = compact.match(/^([0-9.]+)(ml|l)$/i);
  if (!match) return "750ml";
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return "750ml";
  const ml = match[2].toLowerCase() === "l" ? amount * 1000 : amount;
  return `${Math.round(ml)}ml`;
}
