import type {
  PriceChangeEvent,
  SupplierCatalogFreeGood,
  SupplierCatalogPriceLevel,
  SupplierCatalogWine,
  SupplierLogistics,
  WineRequest
} from "@/lib/types";

export const AVAILABILITY_STATUSES = ["available", "limited", "sold_out", "unknown"] as const;
export const SYSTEM_TAGS = ["Core", "BTG", "Limited", "Special Order", "Allocated"] as const;
export const CONVERSION_STATUSES = [
  "exact_existing_product",
  "new_vintage",
  "new_format",
  "possible_match_needs_review",
  "net_new_product"
] as const;
export const QUICKBOOKS_SYNC_STATUSES = ["not_created", "pending_create", "created", "linked", "sync_error"] as const;
export const PRODUCT_LIFECYCLE_STATUSES = [
  "supplier_available",
  "pending_product_creation",
  "active_product",
  "inactive"
] as const;
export const PLACEMENT_TYPES = ["BTG", "List", "Shelf", "Club", "Special Order", "Other"] as const;
export const REQUEST_STATUSES = ["pending_review", "approved", "rejected", "on_hold"] as const;
export const FULFILLMENT_STATUSES = [
  "waiting_for_next_order",
  "added_to_po",
  "ordered",
  "received",
  "cancelled"
] as const;
export const APPROVER_NAMES = ["Mark", "Ryan", "John"] as const;
export const APPROVAL_DECISIONS = [
  "approve",
  "reject",
  "hold",
  "approve_as_special_order",
  "approve_as_new_stem_product"
] as const;

const GP_WARNING_PERSISTED = "Gross profit margin is below 27%.";
const GP_WARNING_THRESHOLD = 0.27;
const PACK_RE = /^\s*(\d+)\s*[/xX]\s*([0-9.]+)\s*(ml|mL|ML|l|L)\s*$/;
const PACK_SEARCH_RE = /\b(\d+)\s*[/xX]\s*([0-9.]+)\s*(ml|mL|ML|l|L)\b/i;
const PACK_SEARCH_GLOBAL_RE = /\b\d+\s*[/xX]\s*[0-9.]+\s*(?:ml|mL|ML|l|L)\b/g;
const VINTAGE_SEARCH_RE = /\b((?:19|20)\d{2}|NV|N\/V)\b/i;
const VINTAGE_SEARCH_GLOBAL_RE = /\b(?:(?:19|20)\d{2}|NV|N\/V)\b/gi;
const SEARCH_STOP_WORDS = new Set(["wine", "wines"]);

export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export type SystemTag = (typeof SYSTEM_TAGS)[number];

export type SupplierCatalogPriceLevelInput = {
  id?: string;
  name: string;
  bottlePrice?: number | null;
  depletionAllowance?: number | null;
  targetGpMargin?: number | null;
  calculatedGpMargin?: number | null;
  isFrontline?: boolean;
  isBest?: boolean;
  displayOrder?: number;
  active?: boolean;
  sourceSystem?: string | null;
  sourceId?: string | null;
};

export type SupplierCatalogFreeGoodInput = {
  id?: string;
  buyQuantity?: number | null;
  freeQuantity?: number | null;
  unit?: "bottle" | "case";
  programName?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  notes?: string | null;
  active?: boolean;
};

export type SupplierCatalogWineInput = {
  supplierId?: string | null;
  supplierName: string;
  producer: string;
  wineName: string;
  vintage: string;
  packSize: number;
  bottleSize: string;
  fobBottle?: number | null;
  fobCase?: number | null;
  laidInPerBottle?: number | null;
  frontlineOverride?: number | null;
  bestPriceOverride?: number | null;
  availabilityStatus: AvailabilityStatus;
  conversionStatus: ConversionStatus;
  systemTags?: string[];
  copiedFromSupplierCatalogWineId?: string | null;
  quickbooksItemNumber?: string | null;
  sourceSystem?: string | null;
  sourceId?: string | null;
  priceLevels?: SupplierCatalogPriceLevelInput[];
  freeGoods?: SupplierCatalogFreeGoodInput[];
  priceChangeReason?: string;
};

export type PricingResult = {
  packSize: number;
  fobBottle: number;
  fobCase: number;
  laidInPerBottle: number;
  landedBottleCost: number;
  frontlineBottlePrice: number;
  bestPrice: number | null;
  grossProfitMargin: number;
  warnings: string[];
  diagnostics: Record<string, unknown>;
};

export function money(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export function normalizeSpaces(value: unknown) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).join(" ");
}

export function normalizeVintage(vintage: unknown) {
  const value = normalizeSpaces(vintage);
  return !value || ["nan", "none", "nv", "n/v"].includes(value.toLowerCase()) ? "NV" : value;
}

export function normalizePackFormat(packSize: unknown = 12, bottleSize: unknown = "750ml") {
  const raw = normalizeSpaces(`${packSize}/${bottleSize}`);
  const directMatch = raw.match(PACK_RE);
  if (directMatch) {
    const [, count, size, unit] = directMatch;
    return `${Math.trunc(Number(count) || 12)}/${size}${unit.toLowerCase() === "ml" ? "ml" : "L"}`;
  }

  const sizeText = normalizeSpaces(bottleSize || "750ml").replace(/\s/g, "");
  const sizeMatch = sizeText.match(/^([0-9.]+)(ml|mL|ML|l|L)$/);
  if (sizeMatch) {
    const [, size, unit] = sizeMatch;
    return `${Math.max(1, Math.trunc(Number(packSize) || 12))}/${size}${unit.toLowerCase() === "ml" ? "ml" : "L"}`;
  }

  return `${Math.max(1, Math.trunc(Number(packSize) || 12))}/750ml`;
}

export function buildDisplayName(input: {
  producer: string;
  wineName: string;
  vintage: unknown;
  packSize?: unknown;
  bottleSize?: unknown;
}) {
  let producer = normalizeSpaces(input.producer);
  let wineName = normalizeSpaces(input.wineName);
  const combined = `${producer} ${wineName}`.toLowerCase();

  if (combined.includes("champagne")) {
    producer = producer.replace(/^champagne\s+/i, "").trim();
    wineName = wineName.replace(/^champagne\s+/i, "").trim();
    producer = producer ? `Champagne ${producer}` : "Champagne";
  }

  return normalizeSpaces(
    [producer, wineName, normalizeVintage(input.vintage), normalizePackFormat(input.packSize, input.bottleSize)]
      .filter(Boolean)
      .join(" ")
  );
}

export function buildPlanningSku(displayName: string, removeVintage = false) {
  let value = normalizeSpaces(displayName).toLowerCase();
  if (removeVintage) {
    value = value.replace(/\b(19|20)\d{2}\b/g, " ");
  }
  value = value.replace(/\//g, " / ");
  value = value.replace(/[^\w\s/.]/g, " ");
  value = normalizeSpaces(value);
  return value.replace(/\s+\/\s+/g, "/");
}

export function normalizeWineIdentity(input: {
  producer: string;
  wineName: string;
  vintage: unknown;
  packSize?: unknown;
  bottleSize?: unknown;
}) {
  const displayName = buildDisplayName(input);
  return {
    displayName,
    planningSku: buildPlanningSku(displayName),
    planningSkuWithoutVintage: buildPlanningSku(displayName, true),
    normalizedVintage: normalizeVintage(input.vintage),
    packFormat: normalizePackFormat(input.packSize, input.bottleSize)
  };
}

export type SupplierCatalogWineNameMatch = {
  wine: SupplierCatalogWine;
  score: number;
};

export type ParsedSupplierCatalogWineName = {
  producer?: string;
  wineName: string;
  vintage?: string;
  packSize?: number;
  bottleSize?: string;
};

function normalizeSearchText(value: unknown) {
  return normalizeSpaces(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s/.]/g, " ");
}

function catalogWineSearchKey(value: unknown) {
  return normalizeSpaces(
    normalizeSearchText(value)
      .replace(PACK_SEARCH_GLOBAL_RE, " ")
      .replace(VINTAGE_SEARCH_GLOBAL_RE, " ")
      .replace(/\//g, " ")
  );
}

function searchTokens(value: string) {
  return catalogWineSearchKey(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
}

function scoreSearchKey(queryKey: string, candidateKey: string) {
  if (!queryKey || !candidateKey) return 0;
  if (queryKey === candidateKey) return 1;
  if (candidateKey.includes(queryKey)) {
    return 0.82 + Math.min(0.12, (queryKey.length / Math.max(candidateKey.length, 1)) * 0.12);
  }
  if (queryKey.includes(candidateKey)) {
    return 0.76 + Math.min(0.1, (candidateKey.length / Math.max(queryKey.length, 1)) * 0.1);
  }

  const queryTokens = searchTokens(queryKey);
  const candidateTokens = searchTokens(candidateKey);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  const candidateSet = new Set(candidateTokens);
  const overlap = queryTokens.filter((token) => candidateSet.has(token)).length;
  const coverage = overlap / queryTokens.length;
  const precision = overlap / candidateTokens.length;
  return coverage * 0.72 + precision * 0.18;
}

function supplierMatchBonus(
  wine: SupplierCatalogWine,
  input: { supplierId?: string | null; supplierName?: string | null }
) {
  if (input.supplierId && wine.supplier_id === input.supplierId) return 0.08;
  if (input.supplierName && normalizeSearchText(wine.supplier_name) === normalizeSearchText(input.supplierName)) return 0.06;
  return 0;
}

export function parseSupplierCatalogWineNameInput(
  value: string,
  template?: Pick<SupplierCatalogWine, "producer" | "wine_name" | "vintage" | "pack_size" | "bottle_size">
): ParsedSupplierCatalogWineName {
  let remaining = normalizeSpaces(value);
  const packMatch = remaining.match(PACK_SEARCH_RE);
  const parsedPackSize = packMatch ? Math.max(1, Math.trunc(Number(packMatch[1]) || 12)) : undefined;
  const parsedBottleSize = packMatch
    ? `${packMatch[2]}${packMatch[3].toLowerCase() === "ml" ? "ml" : "L"}`
    : undefined;
  if (packMatch) {
    remaining = normalizeSpaces(remaining.replace(PACK_SEARCH_RE, " "));
  }

  const vintageMatch = remaining.match(VINTAGE_SEARCH_RE);
  const parsedVintage = vintageMatch ? normalizeVintage(vintageMatch[1]) : undefined;
  if (vintageMatch) {
    remaining = normalizeSpaces(remaining.replace(VINTAGE_SEARCH_RE, " "));
  }

  let parsedProducer: string | undefined;
  if (template?.producer) {
    const producerWords = normalizeSpaces(template.producer).split(/\s+/).filter(Boolean);
    const remainingWords = remaining.split(/\s+/).filter(Boolean);
    const producerKey = normalizeSearchText(template.producer);
    const remainingProducerKey = normalizeSearchText(remainingWords.slice(0, producerWords.length).join(" "));
    if (producerWords.length > 0 && producerKey === remainingProducerKey) {
      parsedProducer = normalizeSpaces(template.producer);
      remaining = normalizeSpaces(remainingWords.slice(producerWords.length).join(" "));
    }
  }

  return {
    producer: parsedProducer,
    wineName: remaining || normalizeSpaces(template?.wine_name || value),
    vintage: parsedVintage,
    packSize: parsedPackSize,
    bottleSize: parsedBottleSize
  };
}

export function findSupplierCatalogWineNameMatch(
  input: { wineName: string; supplierId?: string | null; supplierName?: string | null },
  wines: SupplierCatalogWine[]
): SupplierCatalogWineNameMatch | null {
  const queryKey = catalogWineSearchKey(input.wineName);
  const queryTokens = searchTokens(queryKey);
  if (queryKey.length < 5 || queryTokens.length === 0) return null;

  let best: SupplierCatalogWineNameMatch | null = null;

  for (const wine of wines) {
    const candidateKeys = [
      `${wine.producer} ${wine.wine_name}`,
      wine.display_name,
      wine.planning_sku_without_vintage,
      wine.planning_sku
    ].map(catalogWineSearchKey);
    const baseScore = Math.max(...candidateKeys.map((candidateKey) => scoreSearchKey(queryKey, candidateKey)));
    const score = Math.min(1, baseScore + supplierMatchBonus(wine, input));
    if (!best || score > best.score || (score === best.score && sortCatalogMatchTie(wine, best.wine) < 0)) {
      best = { wine, score };
    }
  }

  const threshold = queryTokens.length === 1 ? 0.86 : 0.68;
  return best && best.score >= threshold ? best : null;
}

function sortCatalogMatchTie(a: SupplierCatalogWine, b: SupplierCatalogWine) {
  const vintageA = Number(a.vintage);
  const vintageB = Number(b.vintage);
  if (Number.isFinite(vintageA) && Number.isFinite(vintageB) && vintageA !== vintageB) {
    return vintageB - vintageA;
  }
  return (b.updated_at || "").localeCompare(a.updated_at || "");
}

export function calculateBestPrice(frontlineBottlePrice: number) {
  const frontline = money(frontlineBottlePrice);
  if (frontline >= 50) return null;
  if (frontline >= 20 && frontline <= 49) return money(frontline - 2);
  if (frontline < 20 && frontline > 0) return money(frontline - 1);
  return null;
}

export function calculateGpMargin(input: {
  bottlePrice?: number | null;
  landedBottleCost?: number | null;
  depletionAllowance?: number | null;
}) {
  const bottlePrice = money(input.bottlePrice);
  if (bottlePrice <= 0) return 0;
  const landedBottleCost = money(input.landedBottleCost);
  const depletionAllowance = money(input.depletionAllowance);
  const netCost = Math.max(0, landedBottleCost - depletionAllowance);
  return Math.round(((bottlePrice - netCost) / bottlePrice) * 10000) / 10000;
}

export function requiredDepletionAllowanceForTargetMargin(input: {
  bottlePrice?: number | null;
  landedBottleCost?: number | null;
  targetGpMargin?: number | null;
}) {
  const bottlePrice = money(input.bottlePrice);
  const landedBottleCost = money(input.landedBottleCost);
  const targetGpMargin = Math.max(0, Math.min(0.99, Number(input.targetGpMargin) || 0));
  if (bottlePrice <= 0 || landedBottleCost <= 0 || targetGpMargin <= 0) return 0;
  return money(Math.max(0, landedBottleCost - bottlePrice * (1 - targetGpMargin)));
}

export function calculatePricing(input: {
  packSize?: number | null;
  fobBottle?: number | null;
  fobCase?: number | null;
  laidInPerBottle?: number | null;
  frontlineBottlePrice?: number | null;
  bestPrice?: number | null;
}): PricingResult {
  const packSize = Math.max(1, Math.trunc(Number(input.packSize) || 12));
  let fobBottle = money(input.fobBottle);
  let fobCase = money(input.fobCase);
  const laidInPerBottle = money(input.laidInPerBottle);

  if (fobBottle <= 0 && fobCase > 0) {
    fobBottle = money(fobCase / packSize);
  }
  if (fobCase <= 0 && fobBottle > 0) {
    fobCase = money(fobBottle * packSize);
  }

  const landedBottleCost = money(fobBottle + laidInPerBottle);
  const frontlineBottlePrice = input.frontlineBottlePrice
    ? money(input.frontlineBottlePrice)
    : landedBottleCost
      ? Math.ceil(landedBottleCost / 0.68)
      : 0;
  const bestPrice = input.bestPrice !== null && input.bestPrice !== undefined ? money(input.bestPrice) : calculateBestPrice(frontlineBottlePrice);
  const grossProfitMargin = frontlineBottlePrice
    ? Math.round(((frontlineBottlePrice - landedBottleCost) / frontlineBottlePrice) * 10000) / 10000
    : 0;
  const warnings = frontlineBottlePrice && grossProfitMargin < GP_WARNING_THRESHOLD ? [GP_WARNING_PERSISTED] : [];

  return {
    packSize,
    fobBottle,
    fobCase,
    laidInPerBottle,
    landedBottleCost,
    frontlineBottlePrice,
    bestPrice,
    grossProfitMargin,
    warnings,
    diagnostics: {
      basis: "bottle",
      gp_warning_threshold: GP_WARNING_THRESHOLD,
      frontline_formula: "CEILING(landed_bottle_cost / 0.68)",
      best_price_rule: "frontline >= 50 none; 20-49 minus 2; under 20 minus 1",
      warnings
    }
  };
}

export function normalizeSystemTags(tags: string[] = []) {
  const valid = new Set<string>(SYSTEM_TAGS);
  return Array.from(new Set(tags.map(normalizeSpaces).filter((tag) => valid.has(tag))));
}

export function defaultPriceLevelsForPricing(pricing: PricingResult): SupplierCatalogPriceLevelInput[] {
  return [
    {
      name: "Frontline",
      bottlePrice: pricing.frontlineBottlePrice,
      depletionAllowance: 0,
      calculatedGpMargin: pricing.grossProfitMargin,
      isFrontline: true,
      isBest: false,
      displayOrder: 0,
      active: true
    },
    ...(pricing.bestPrice !== null
      ? [
          {
            name: "Best",
            bottlePrice: pricing.bestPrice,
            depletionAllowance: 0,
            calculatedGpMargin: calculateGpMargin({
              bottlePrice: pricing.bestPrice,
              landedBottleCost: pricing.landedBottleCost
            }),
            isFrontline: false,
            isBest: true,
            displayOrder: 1,
            active: true
          }
        ]
      : [])
  ];
}

export function normalizePriceLevels(
  levels: SupplierCatalogPriceLevelInput[] = [],
  landedBottleCost = 0
): SupplierCatalogPriceLevelInput[] {
  return levels
    .map((level, index) => {
      const bottlePrice = money(level.bottlePrice);
      const targetGpMargin =
        level.targetGpMargin === null || level.targetGpMargin === undefined ? null : Math.max(0, Math.min(0.99, Number(level.targetGpMargin) || 0));
      const depletionAllowance =
        level.depletionAllowance !== null && level.depletionAllowance !== undefined
          ? money(level.depletionAllowance)
          : targetGpMargin !== null
            ? requiredDepletionAllowanceForTargetMargin({ bottlePrice, landedBottleCost, targetGpMargin })
            : 0;

      return {
        id: level.id,
        name: normalizeSpaces(level.name) || `Level ${index + 1}`,
        bottlePrice,
        depletionAllowance,
        targetGpMargin,
        calculatedGpMargin:
          level.calculatedGpMargin !== null && level.calculatedGpMargin !== undefined
            ? Math.round((Number(level.calculatedGpMargin) || 0) * 10000) / 10000
            : calculateGpMargin({ bottlePrice, landedBottleCost, depletionAllowance }),
        isFrontline: Boolean(level.isFrontline),
        isBest: Boolean(level.isBest),
        displayOrder: Math.max(0, Math.trunc(Number(level.displayOrder ?? index) || 0)),
        active: level.active ?? true,
        sourceSystem: level.sourceSystem || null,
        sourceId: level.sourceId || null
      };
    })
    .filter((level) => money(level.bottlePrice) > 0 || Boolean(level.isFrontline))
    .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
}

export function normalizeFreeGoods(freeGoods: SupplierCatalogFreeGoodInput[] = []): SupplierCatalogFreeGoodInput[] {
  return freeGoods
    .map((freeGood) => ({
      id: freeGood.id,
      buyQuantity: Math.max(0, Number(freeGood.buyQuantity) || 0),
      freeQuantity: Math.max(0, Number(freeGood.freeQuantity) || 0),
      unit: freeGood.unit === "case" ? "case" as const : "bottle" as const,
      programName: normalizeSpaces(freeGood.programName || "") || null,
      startsOn: freeGood.startsOn || null,
      endsOn: freeGood.endsOn || null,
      notes: normalizeSpaces(freeGood.notes || "") || null,
      active: freeGood.active ?? true
    }))
    .filter((freeGood) => Number(freeGood.buyQuantity) > 0 || Number(freeGood.freeQuantity) > 0 || Boolean(freeGood.programName));
}

export function defaultLaidInForSupplier(suppliers: SupplierLogistics[], supplierId: string | null, supplierName: string) {
  const selected = suppliers.find((supplier) => supplier.id === supplierId) || suppliers.find((supplier) => supplier.name === supplierName);
  if (!selected) return 0;
  return money((selected as SupplierLogistics & { laid_in_per_bottle?: number | string | null }).laid_in_per_bottle ?? selected.trucking_cost_per_bottle);
}

export function buildSupplierCatalogWine(input: SupplierCatalogWineInput) {
  const identity = normalizeWineIdentity({
    producer: input.producer,
    wineName: input.wineName,
    vintage: input.vintage || "NV",
    packSize: input.packSize || 12,
    bottleSize: input.bottleSize || "750ml"
  });
  const pricing = calculatePricing({
    packSize: input.packSize,
    fobBottle: input.fobBottle,
    fobCase: input.fobCase,
    laidInPerBottle: input.laidInPerBottle,
    frontlineBottlePrice: input.frontlineOverride,
    bestPrice: input.bestPriceOverride
  });
  const priceLevels = normalizePriceLevels(
    input.priceLevels && input.priceLevels.length > 0 ? input.priceLevels : defaultPriceLevelsForPricing(pricing),
    pricing.landedBottleCost
  );
  const frontlineLevel = priceLevels.find((level) => level.isFrontline) || priceLevels[0] || null;
  const bestLevel = priceLevels.find((level) => level.isBest) || null;
  const frontlineBottlePrice = frontlineLevel ? money(frontlineLevel.bottlePrice) : pricing.frontlineBottlePrice;
  const bestPrice = bestLevel ? money(bestLevel.bottlePrice) : pricing.bestPrice;
  const grossProfitMargin = calculateGpMargin({
    bottlePrice: frontlineBottlePrice,
    landedBottleCost: pricing.landedBottleCost,
    depletionAllowance: frontlineLevel?.depletionAllowance
  });
  const warnings = frontlineBottlePrice && grossProfitMargin < GP_WARNING_THRESHOLD ? [GP_WARNING_PERSISTED] : [];
  const productLifecycleStatus = input.conversionStatus === "exact_existing_product" ? "supplier_available" : "pending_product_creation";

  const supplierWine = {
    supplier_id: input.supplierId || null,
    supplier_name: normalizeSpaces(input.supplierName),
    producer: normalizeSpaces(input.producer),
    wine_name: normalizeSpaces(input.wineName),
    vintage: identity.normalizedVintage,
    pack_size: pricing.packSize,
    bottle_size: normalizeSpaces(input.bottleSize || "750ml"),
    pricing_basis: money(input.fobBottle) > 0 ? "bottle" : "case",
    fob_bottle: pricing.fobBottle,
    fob_case: pricing.fobCase,
    laid_in_per_bottle: pricing.laidInPerBottle,
    landed_bottle_cost: pricing.landedBottleCost,
    frontline_bottle_price: frontlineBottlePrice,
    best_price: bestPrice,
    gross_profit_margin: grossProfitMargin,
    availability_status: input.availabilityStatus,
    conversion_status: input.conversionStatus,
    display_name: identity.displayName,
    planning_sku: identity.planningSku,
    planning_sku_without_vintage: identity.planningSkuWithoutVintage,
    diagnostics: {
      ...pricing.diagnostics,
      warnings,
      price_levels: priceLevels,
      free_goods: normalizeFreeGoods(input.freeGoods),
      quickbooks_item_name_preview: identity.displayName
    },
    quickbooks_item_number: normalizeSpaces(input.quickbooksItemNumber || "") || null,
    quickbooks_sync_status: "not_created",
    product_lifecycle_status: productLifecycleStatus,
    accounting_create_payload: {},
    system_tags: normalizeSystemTags(input.systemTags || []),
    copied_from_supplier_catalog_wine_id: input.copiedFromSupplierCatalogWineId || null,
    source_system: input.sourceSystem || null,
    source_id: input.sourceId || null
  } satisfies Omit<SupplierCatalogWine, "id" | "created_at" | "updated_at" | "quickbooks_item_id" | "quickbooks_item_name" | "price_levels" | "free_goods" | "workbench_items">;

  return {
    ...supplierWine,
    accounting_create_payload: {
      item_name: supplierWine.display_name,
      planning_sku: supplierWine.planning_sku,
      supplier_name: supplierWine.supplier_name,
      producer: supplierWine.producer,
      wine_name: supplierWine.wine_name,
      vintage: supplierWine.vintage,
      pack_size: supplierWine.pack_size,
      bottle_size: supplierWine.bottle_size,
      fob_bottle: supplierWine.fob_bottle,
      frontline_bottle_price: supplierWine.frontline_bottle_price,
      best_price: supplierWine.best_price
    },
    price_levels: priceLevels.map((level, index) => ({
      id: level.id || `draft-${index}`,
      supplier_catalog_wine_id: "",
      name: level.name,
      bottle_price: level.bottlePrice || 0,
      depletion_allowance: level.depletionAllowance || 0,
      target_gp_margin: level.targetGpMargin ?? null,
      calculated_gp_margin: level.calculatedGpMargin || 0,
      is_frontline: Boolean(level.isFrontline),
      is_best: Boolean(level.isBest),
      display_order: level.displayOrder || index,
      active: level.active ?? true,
      source_system: level.sourceSystem || null,
      source_id: level.sourceId || null,
      created_at: "",
      updated_at: ""
    })) satisfies SupplierCatalogPriceLevel[],
    free_goods: normalizeFreeGoods(input.freeGoods).map((freeGood, index) => ({
      id: freeGood.id || `draft-${index}`,
      supplier_catalog_wine_id: "",
      buy_quantity: freeGood.buyQuantity || 0,
      free_quantity: freeGood.freeQuantity || 0,
      unit: freeGood.unit || "bottle",
      program_name: freeGood.programName || null,
      starts_on: freeGood.startsOn || null,
      ends_on: freeGood.endsOn || null,
      notes: freeGood.notes || null,
      active: freeGood.active ?? true,
      created_at: "",
      updated_at: ""
    })) satisfies SupplierCatalogFreeGood[]
  };
}

export function detectPriceChange(previous: SupplierCatalogWine | null, current: SupplierCatalogWine, reason: string) {
  if (!previous) return null;
  const oldFob = money(previous.fob_bottle);
  const newFob = money(current.fob_bottle);
  const oldFrontline = money(previous.frontline_bottle_price);
  const newFrontline = money(current.frontline_bottle_price);

  if (oldFob === newFob && oldFrontline === newFrontline) return null;

  return {
    supplier_catalog_wine_id: previous.id,
    supplier: current.supplier_name,
    wine: current.display_name,
    vintage: current.vintage || "NV",
    old_fob: oldFob,
    new_fob: newFob,
    old_frontline: oldFrontline,
    new_frontline: newFrontline,
    old_best_price: previous.best_price,
    new_best_price: current.best_price,
    margin_before: Number(previous.gross_profit_margin || 0),
    margin_after: Number(current.gross_profit_margin || 0),
    effective_date: new Date().toISOString().slice(0, 10),
    reason: normalizeSpaces(reason) || "Manual catalog update",
    status: "draft",
    fob_increase: newFob > oldFob
  } satisfies Omit<PriceChangeEvent, "id" | "created_at">;
}

export function buildRequestId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `REQ-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function decisionToRequestStatus(decision: ApprovalDecision) {
  if (decision === "reject") return "rejected";
  if (decision === "hold") return "on_hold";
  return "approved";
}

export function buildOrderingWorkflowPayload(request: Pick<WineRequest, "request_id" | "supplier_name" | "wine_display_name" | "requested_quantity" | "needed_by_date" | "fulfillment_status">) {
  return {
    request_id: request.request_id,
    supplier_name: request.supplier_name,
    wine_display_name: request.wine_display_name,
    requested_quantity: request.requested_quantity,
    needed_by_date: request.needed_by_date,
    fulfillment_status: request.fulfillment_status,
    source: "supplier_catalog_request"
  };
}

export function buildAccountingCreatePayload(wine: SupplierCatalogWine) {
  return {
    item_name: wine.display_name,
    planning_sku: wine.planning_sku,
    supplier_name: wine.supplier_name,
    producer: wine.producer,
    wine_name: wine.wine_name,
    vintage: wine.vintage,
    pack_size: wine.pack_size,
    bottle_size: wine.bottle_size,
    fob_bottle: wine.fob_bottle,
    frontline_bottle_price: wine.frontline_bottle_price,
    best_price: wine.best_price
  };
}

export async function createWineInQuickBooks(_wine: SupplierCatalogWine): Promise<never> {
  throw new Error("QuickBooks item creation is intentionally a placeholder until accounting integration is enabled.");
}
