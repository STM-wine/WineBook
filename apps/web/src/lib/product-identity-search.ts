import { asNumber } from "./order-data";
import {
  quickBooksItemCode,
  quickBooksItemDisplayName,
  quickBooksImporter,
  quickBooksPackFormat,
  quickBooksProducer,
  quickBooksVintage,
  type QuickBooksItemIdentityRow
} from "./quickbooks-item-fields";
import {
  buildDisplayName,
  buildPlanningSku,
  calculateGpMargin,
  calculatePricing,
  normalizeSpaces,
  normalizeVintage
} from "./supplier-catalog";

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
  quickbooksItemId: string | null;
  quickbooksItemNumber: string | null;
  quickbooksItemName: string | null;
  systemTags: string[];
  active: boolean;
  updatedAt: string | null;
  priceLevels?: ProductIdentityPriceLevel[];
};

export type ProductIdentityPriceLevel = {
  id: string;
  name: string;
  bottlePrice: number;
  depletionAllowance: number;
  isFrontline: boolean;
  isBest: boolean;
  active: boolean;
  sourceSystem: string;
  updatedAt: string | null;
};

export type ProductIdentityMatch = ProductIdentityCandidate & {
  score: number;
  sourceLabel: string;
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
  includeInactive?: boolean;
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

export function searchProductIdentityCandidates(
  input: SearchInput,
  candidates: ProductIdentityCandidate[]
): ProductIdentityMatch[] {
  const query = searchKey(input.query);
  const queryTokens = tokens(query);
  if (query.length < 3 || queryTokens.length === 0) return [];

  const scored = candidates
    .filter((candidate) => input.includeInactive || candidate.active)
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
      const score = Math.min(1, baseScore + attributeScore + supplierScore + SOURCE_WEIGHT[candidate.source] + activeScore);
      return {
        ...candidate,
        score,
        sourceLabel: `${SOURCE_LABEL[candidate.source]}${candidate.active ? "" : " · Inactive"}`
      };
    })
    .filter((match) => match.score >= minimumScore(queryTokens.length));

  return scored
    .sort((a, b) => b.score - a.score || sourceOrder(a.source) - sourceOrder(b.source) || newestFirst(a.updatedAt, b.updatedAt))
    .slice(0, Math.max(1, input.limit || 8));
}

export function dedupeProductIdentityCandidates(candidates: ProductIdentityCandidate[]) {
  const bySourceIdentity = new Map<string, ProductIdentityCandidate>();
  for (const candidate of candidates) {
    // A shared normalized SKU is not proof that two source records are the same
    // item. QuickBooks can legitimately contain both active and inactive rows.
    // Recommendation rows are historical report snapshots, so their row IDs
    // change on every run even when the underlying QuickBooks SKU does not.
    const recommendationIdentity = candidate.source === "recommendation"
      ? normalizeSpaces(candidate.quickbooksItemNumber || candidate.planningSku).toLowerCase()
      : "";
    const key = candidate.source === "recommendation" && recommendationIdentity
      ? `${candidate.source}:${recommendationIdentity}`
      : `${candidate.source}:${candidate.sourceId}`;
    const existing = bySourceIdentity.get(key);
    if (!existing || (candidate.active && !existing.active) || newestFirst(candidate.updatedAt, existing.updatedAt) < 0) {
      bySourceIdentity.set(key, candidate);
    }
  }
  return Array.from(bySourceIdentity.values());
}

export function latestProductIdentityPriceLevels(levels: ProductIdentityPriceLevel[]) {
  const latest = new Map<string, ProductIdentityPriceLevel>();
  for (const level of [...levels].sort((a, b) => newestFirst(a.updatedAt, b.updatedAt))) {
    const key = searchKey(level.name);
    if (!latest.has(key)) latest.set(key, level);
  }
  return Array.from(latest.values());
}

export function mergeProductIdentityPriceLevels(
  matches: ProductIdentityMatch[],
  candidates: ProductIdentityCandidate[]
) {
  return matches.map((match) => {
    const related = candidates.filter((candidate) => productIdentityMatches(match, candidate));
    const supplier = related
      .filter(hasUsableSupplier)
      .sort((a, b) => supplierAuthority(b) - supplierAuthority(a) || newestFirst(a.updatedAt, b.updatedAt))[0];
    const levels = related
      .flatMap((candidate) => (candidate.priceLevels || []).map((level) => ({
        level,
        authority: candidate.source === "supplier_catalog" ? 3 : candidate.source === "vinosmith" ? 2 : 1
      })))
      .filter(({ level }) => level.active !== false)
      .sort((a, b) => b.authority - a.authority || newestFirst(a.level.updatedAt, b.level.updatedAt));
    const merged = new Map<string, ProductIdentityPriceLevel>();

    for (const { level } of levels) {
      const key = level.isFrontline ? "role:frontline" : level.isBest ? "role:best" : `name:${searchKey(level.name)}`;
      if (!merged.has(key)) merged.set(key, level);
    }

    const priceLevels = Array.from(merged.values()).sort((a, b) =>
      priceLevelDisplayOrder(a) - priceLevelDisplayOrder(b) || a.name.localeCompare(b.name)
    );
    const frontline = priceLevels.find((level) => level.isFrontline);
    const best = priceLevels.find((level) => level.isBest);
    const laidInPerBottle = supplier ? supplier.laidInPerBottle : match.laidInPerBottle;
    const landedBottleCost = Number((match.fobBottle + laidInPerBottle).toFixed(2));

    return {
      ...match,
      supplierId: supplier?.supplierId || match.supplierId,
      supplierName: supplier?.supplierName || match.supplierName,
      laidInPerBottle,
      priceLevels,
      frontlineBottlePrice: frontline?.bottlePrice ?? match.frontlineBottlePrice,
      bestPrice: best?.bottlePrice ?? match.bestPrice,
      grossProfitMargin: frontline
        ? calculateGpMargin({
            bottlePrice: frontline.bottlePrice,
            landedBottleCost,
            depletionAllowance: frontline.depletionAllowance
          })
        : match.grossProfitMargin
    };
  });
}

function hasUsableSupplier(candidate: ProductIdentityCandidate) {
  const name = searchKey(candidate.supplierName);
  return Boolean(candidate.supplierId || (name && name !== "no supplier"));
}

function supplierAuthority(candidate: ProductIdentityCandidate) {
  const sourceAuthority: Record<ProductIdentitySource, number> = {
    supplier_catalog: 5,
    product: 4,
    vinosmith: 3,
    recommendation: 2,
    quickbooks_item: 1
  };
  return sourceAuthority[candidate.source] + (candidate.supplierId ? 10 : 0);
}

function productIdentityMatches(left: ProductIdentityCandidate, right: ProductIdentityCandidate) {
  const leftCode = searchKey(left.quickbooksItemNumber || "");
  const rightCode = searchKey(right.quickbooksItemNumber || "");
  if (leftCode && rightCode) return leftCode === rightCode;
  return searchKey(left.planningSku) === searchKey(right.planningSku);
}

function priceLevelDisplayOrder(level: ProductIdentityPriceLevel) {
  if (level.isFrontline) return 0;
  if (level.isBest) return 1;
  return 2;
}

export function quickbooksItemRowToCandidate(row: Record<string, unknown>): ProductIdentityCandidate {
  const item = {
    list_id: String(row.list_id || row.name || ""),
    name: stringOrNull(row.name),
    full_name: stringOrNull(row.full_name),
    sales_desc: stringOrNull(row.sales_desc),
    purchase_desc: stringOrNull(row.purchase_desc),
    custom_fields: row.custom_fields && typeof row.custom_fields === "object" && !Array.isArray(row.custom_fields)
      ? row.custom_fields as Record<string, unknown>
      : null,
    raw_data: row.raw_data && typeof row.raw_data === "object" && !Array.isArray(row.raw_data)
      ? row.raw_data as Record<string, unknown>
      : null
  } satisfies QuickBooksItemIdentityRow;
  const name = normalizeSpaces(quickBooksItemDisplayName(item));
  const parsed = parseDisplayName(name);
  const producer = normalizeSpaces(quickBooksProducer(item)) || parsed.producer;
  const nameWithoutProducer = searchKey(name).startsWith(searchKey(producer))
    ? normalizeSpaces(name.slice(producer.length).replace(PACK_RE, " ").replace(VINTAGE_RE, " "))
    : parsed.wineName;
  const pack = quickBooksPackFormat(item);
  const packSize = pack.packSize || parsed.packSize || 12;
  const bottleSize = pack.bottleSize || parsed.bottleSize || "750ml";
  const vintage = normalizeVintage(quickBooksVintage(item) || parsed.vintage);
  const salesPrice = numberValue(row.sales_price);
  const displayName = buildDisplayName({
    producer,
    wineName: nameWithoutProducer || parsed.wineName,
    vintage,
    packSize,
    bottleSize
  });
  const pricing = calculatePricing({
    packSize,
    fobBottle: numberValue(row.purchase_cost),
    laidInPerBottle: 0,
    frontlineBottlePrice: salesPrice > 0 ? salesPrice : null
  });

  return {
    source: "quickbooks_item",
    sourceId: item.list_id || name,
    supplierId: null,
    supplierName: normalizeSpaces(quickBooksImporter(item)) || "No supplier",
    producer,
    wineName: nameWithoutProducer || parsed.wineName,
    vintage,
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
    quickbooksItemId: stringOrNull(row.list_id),
    quickbooksItemNumber: quickBooksItemCode(item),
    quickbooksItemName: name || null,
    systemTags: [],
    active: row.is_active !== false,
    updatedAt: stringOrNull(row.last_seen_at) || stringOrNull(row.time_modified),
    priceLevels: salesPrice > 0 ? [{
      id: `quickbooks:${item.list_id || name}:frontline`,
      name: "Frontline",
      bottlePrice: salesPrice,
      depletionAllowance: 0,
      isFrontline: true,
      isBest: false,
      active: row.is_active !== false,
      sourceSystem: "quickbooks_item",
      updatedAt: stringOrNull(row.last_seen_at) || stringOrNull(row.time_modified)
    }] : []
  };
}

export function supplierCatalogRowToCandidate(row: Record<string, unknown>): ProductIdentityCandidate {
  const packSize = Math.max(1, Math.trunc(numberValue(row.pack_size) || 12));
  const bottleSize = normalizeSpaces(textValue(row.bottle_size) || "750ml");
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
    quickbooksItemId: stringOrNull(row.quickbooks_item_id),
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
  const packSize = Math.max(1, Math.trunc(numberValue(row.pack_size) || parsed.packSize || 12));
  const bottleSize = parsed.bottleSize || "750ml";
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
    quickbooksItemId: null,
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
  const packSize = Math.max(1, Math.trunc(numberValue(row.pack_size) || parsed.packSize || 12));
  const bottleSize = parsed.bottleSize || "750ml";
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
    quickbooksItemId: null,
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
  const packSize = Math.max(1, Math.trunc(numberValue(row.unit_set) || parsed.packSize || 12));
  const bottleSize = normalizeSpaces(textValue(row.bottle_size_label) || textValue(row.bottle_size) || parsed.bottleSize || "750ml");
  const pricing = calculatePricing({ packSize, fobBottle: numberValue(row.fob_price), laidInPerBottle: 0 });
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
    quickbooksItemId: null,
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
    packSize: parsed.packSize || 12,
    bottleSize: parsed.bottleSize || "750ml"
  };
}

export function parseProductIdentityQuery(value: string): ParsedProductIdentityQuery {
  let remaining = normalizeSpaces(value);
  const packMatch = remaining.match(PACK_PARSE_RE);
  const packSize = packMatch ? Math.max(1, Math.trunc(Number(packMatch[1]) || 12)) : null;
  const bottleSize = packMatch ? `${packMatch[2]}${packMatch[3].toLowerCase() === "ml" ? "ml" : "L"}` : null;
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
  if (input.packSize && Number(candidate.packSize) === Number(input.packSize)) {
    score += 0.04;
  }
  if (input.bottleSize && normalizePackFormatBottle(input.bottleSize) === normalizePackFormatBottle(candidate.bottleSize)) {
    score += 0.04;
  }
  return score;
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

function normalizePackFormatBottle(value: unknown) {
  return normalizeSpaces(value).toLowerCase().replace(/\s+/g, "");
}
