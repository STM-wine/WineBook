import type {
  PriceChangeEvent,
  SupplierCatalogFreeGood,
  SupplierCatalogPriceLevel,
  SupplierCatalogWine,
  SupplierLogistics,
  WineRequest
} from "@/lib/types";

export const AVAILABILITY_STATUSES = ["available", "limited", "sold_out", "unknown"] as const;
export const SYSTEM_TAGS = ["Core", "Limited Core", "Limited", "Special Order", "Allocated", "GRW Broker"] as const;
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

export const MINIMUM_GP_MARGIN = 0.28;
export const FRONTLINE_TARGET_MARGIN = 0.32;
export const BEST_TARGET_MARGIN = 0.30;
export const SOLVE_FOR_MODES = ["price", "da", "gp"] as const;
export const PRICE_APPROVAL_DECISIONS = ["approve_price", "pursue_da", "revise", "hold", "no_change"] as const;
const GP_WARNING_PERSISTED = "Gross profit margin is below 28%.";
const GP_WARNING_THRESHOLD = MINIMUM_GP_MARGIN;
const PACK_RE = /^\s*(\d+)\s*[/xX]\s*([0-9.]+)\s*(ml|mL|ML|l|L)\s*$/;

export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export type SystemTag = (typeof SYSTEM_TAGS)[number];
export type SolveForMode = (typeof SOLVE_FOR_MODES)[number];
export type PriceApprovalDecision = (typeof PRICE_APPROVAL_DECISIONS)[number];

export function systemTagLabel(tag: string) {
  return tag === "Limited Core" ? "Select" : tag;
}

export function hasOfficialQuickBooksProduct(
  wine: Pick<
    SupplierCatalogWine,
    "product_lifecycle_status" | "quickbooks_item_id" | "quickbooks_item_number"
  >
) {
  const isRealReference = (value: string | null | undefined) => {
    const normalized = (value || "").trim().toUpperCase();
    return Boolean(normalized && !["NEW", "NEW ITEM", "TBD", "PENDING"].includes(normalized));
  };

  return wine.product_lifecycle_status === "active_product" ||
    isRealReference(wine.quickbooks_item_id) ||
    isRealReference(wine.quickbooks_item_number);
}

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
  solveFor?: SolveForMode;
  approvalDecision?: PriceApprovalDecision | null;
  overrideReason?: string | null;
  approvalOwner?: string | null;
  decisionTimestamp?: string | null;
  suggestedPrice?: number | null;
  suggestedGpMargin?: number | null;
  daAlternative?: number | null;
  finalApprovedPrice?: number | null;
  finalApprovedDa?: number | null;
  finalGpMargin?: number | null;
  isManualOverride?: boolean;
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
  extensionMetadata?: Record<string, unknown> | null;
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
  quickbooksItemId?: string | null;
  quickbooksItemName?: string | null;
  quickbooksItemNumber?: string | null;
  sourceSystem?: string | null;
  sourceId?: string | null;
  priceLevels?: SupplierCatalogPriceLevelInput[];
  freeGoods?: SupplierCatalogFreeGoodInput[];
  priceChangeReason?: string;
  pricingBasis?: "bottle" | "case";
  pricingModel?: "standard" | "grw_broker";
  fobSourceDate?: string | null;
  laidInSourceDate?: string | null;
  priorPricingCostFingerprint?: string | null;
  pricingCalculatedAt?: string | null;
  frontlineOnly?: boolean;
  expectedLockVersion?: number | null;
  idempotencyKey?: string | null;
};

export function detachInheritedQuickBooksIdentity(input: {
  currentPlanningSku: string;
  templatePlanningSku?: string | null;
  quickbooksItemId?: string | null;
  quickbooksItemName?: string | null;
  quickbooksItemNumber?: string | null;
  templateQuickbooksItemId?: string | null;
  templateQuickbooksItemName?: string | null;
  templateQuickbooksItemNumber?: string | null;
}) {
  const current = {
    itemId: normalizeSpaces(input.quickbooksItemId) || null,
    itemName: normalizeSpaces(input.quickbooksItemName) || null,
    itemNumber: normalizeSpaces(input.quickbooksItemNumber) || null
  };
  if (!input.templatePlanningSku || input.currentPlanningSku === input.templatePlanningSku) {
    return current;
  }

  const inheritedReferences = new Set(
    [input.templateQuickbooksItemId, input.templateQuickbooksItemNumber]
      .map((value) => normalizeSpaces(value).toLowerCase())
      .filter(Boolean)
  );
  const inheritedName = normalizeSpaces(input.templateQuickbooksItemName).toLowerCase();
  const itemIdWasInherited = Boolean(current.itemId && inheritedReferences.has(current.itemId.toLowerCase()));
  const itemNumberWasInherited = Boolean(current.itemNumber && inheritedReferences.has(current.itemNumber.toLowerCase()));
  const itemNameWasInherited = Boolean(current.itemName && inheritedName && current.itemName.toLowerCase() === inheritedName);

  return {
    itemId: itemIdWasInherited ? null : current.itemId,
    itemName: itemIdWasInherited || itemNumberWasInherited || itemNameWasInherited ? null : current.itemName,
    itemNumber: itemNumberWasInherited ? null : current.itemNumber
  };
}

export function supplierCatalogWineToInput(wine: SupplierCatalogWine): SupplierCatalogWineInput {
  return {
    supplierId: wine.supplier_id,
    supplierName: wine.supplier_name,
    producer: wine.producer,
    wineName: wine.wine_name,
    vintage: wine.vintage,
    packSize: Math.max(1, Math.trunc(Number(wine.pack_size) || 1)),
    bottleSize: wine.bottle_size,
    fobBottle: Number(wine.fob_bottle) || 0,
    fobCase: Number(wine.fob_case) || 0,
    laidInPerBottle: Number(wine.laid_in_per_bottle) || 0,
    frontlineOverride: null,
    bestPriceOverride: null,
    availabilityStatus: AVAILABILITY_STATUSES.includes(wine.availability_status as AvailabilityStatus)
      ? (wine.availability_status as AvailabilityStatus)
      : "unknown",
    conversionStatus: CONVERSION_STATUSES.includes(wine.conversion_status as ConversionStatus)
      ? (wine.conversion_status as ConversionStatus)
      : "net_new_product",
    systemTags: wine.system_tags || [],
    copiedFromSupplierCatalogWineId: wine.copied_from_supplier_catalog_wine_id,
    quickbooksItemId: wine.quickbooks_item_id,
    quickbooksItemName: wine.quickbooks_item_name,
    quickbooksItemNumber: wine.quickbooks_item_number,
    sourceSystem: wine.source_system,
    sourceId: wine.source_id,
    pricingBasis: wine.pricing_basis === "case" ? "case" : "bottle",
    pricingModel: wine.pricing_model === "grw_broker" ? "grw_broker" : "standard",
    fobSourceDate: wine.fob_source_date,
    laidInSourceDate: wine.laid_in_source_date,
    priorPricingCostFingerprint: wine.pricing_cost_fingerprint,
    pricingCalculatedAt: wine.pricing_calculated_at,
    frontlineOnly: Boolean(wine.frontline_only),
    expectedLockVersion: Number(wine.lock_version || 0),
    priceLevels: (wine.price_levels || []).map((level) => ({
      id: level.id,
      name: level.name,
      bottlePrice: Number(level.bottle_price) || 0,
      depletionAllowance: Number(level.depletion_allowance) || 0,
      targetGpMargin: level.target_gp_margin === null ? null : Number(level.target_gp_margin),
      calculatedGpMargin: Number(level.calculated_gp_margin) || 0,
      isFrontline: level.is_frontline,
      isBest: level.is_best,
      displayOrder: Number(level.display_order) || 0,
      active: level.active,
      sourceSystem: level.source_system,
      sourceId: level.source_id,
      solveFor: SOLVE_FOR_MODES.includes(level.solve_for as SolveForMode) ? (level.solve_for as SolveForMode) : "gp",
      approvalDecision: PRICE_APPROVAL_DECISIONS.includes(level.approval_decision as PriceApprovalDecision)
        ? (level.approval_decision as PriceApprovalDecision)
        : null,
      overrideReason: level.override_reason,
      approvalOwner: level.approval_owner,
      decisionTimestamp: level.decision_timestamp,
      suggestedPrice: level.suggested_price === null ? null : Number(level.suggested_price),
      suggestedGpMargin: level.suggested_gp_margin === null ? null : Number(level.suggested_gp_margin),
      daAlternative: level.da_alternative === null ? null : Number(level.da_alternative),
      finalApprovedPrice: level.final_approved_price === null ? null : Number(level.final_approved_price),
      finalApprovedDa: level.final_approved_da === null ? null : Number(level.final_approved_da),
      finalGpMargin: level.final_gp_margin === null ? null : Number(level.final_gp_margin),
      isManualOverride: Boolean(level.is_manual_override)
    })),
    freeGoods: (wine.free_goods || []).map((freeGood) => ({
      id: freeGood.id,
      buyQuantity: Number(freeGood.buy_quantity) || 0,
      freeQuantity: Number(freeGood.free_quantity) || 0,
      unit: freeGood.unit === "bottle" ? "bottle" : "case",
      programName: freeGood.program_name,
      startsOn: freeGood.starts_on,
      endsOn: freeGood.ends_on,
      notes: freeGood.notes,
      active: freeGood.active,
      extensionMetadata: freeGood.extension_metadata
    }))
  };
}

export type PricingResult = {
  packSize: number;
  fobBottle: number;
  fobCase: number;
  laidInPerBottle: number;
  landedBottleCost: number;
  frontlineBottlePrice: number;
  bestPrice: number | null;
  grossProfitMargin: number;
  bestGrossProfitMargin: number | null;
  suggestionsReady: boolean;
  warnings: string[];
  diagnostics: Record<string, unknown>;
};

export function money(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export function normalizeFobCosts(input: {
  packSize: number;
  fobBottle?: number | null;
  fobCase?: number | null;
  pricingBasis?: "bottle" | "case" | null;
}) {
  const parsedPack = Number(input.packSize);
  if (!Number.isFinite(parsedPack) || parsedPack <= 0 || !Number.isInteger(parsedPack)) {
    throw new Error("Pack size is required and must be a positive whole number.");
  }
  const fobBottle = money(input.fobBottle);
  const fobCase = money(input.fobCase);
  if (fobBottle < 0 || fobCase < 0) throw new Error("FOB cost cannot be negative.");
  const pricingBasis = input.pricingBasis || (fobCase > 0 && fobBottle <= 0 ? "case" : "bottle");
  if (pricingBasis === "case") {
    return { packSize: parsedPack, fobBottle: money(fobCase / parsedPack), fobCase, pricingBasis };
  }
  return { packSize: parsedPack, fobBottle, fobCase: money(fobBottle * parsedPack), pricingBasis };
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

export function calculateBestPrice(landedBottleCost: number) {
  const landed = money(landedBottleCost);
  return landed > 0 ? roundSuggestedPriceUp(landed / (1 - BEST_TARGET_MARGIN)) : null;
}

export function roundSuggestedPriceUp(rawPrice: number) {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 0;
  const increment = rawPrice < 20 ? 0.25 : 1;
  return money(Math.ceil((rawPrice - Number.EPSILON) / increment) * increment);
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
  const targetGpMargin = Number(input.targetGpMargin) || 0;
  if (!Number.isFinite(targetGpMargin) || targetGpMargin < 0 || targetGpMargin >= 1) {
    throw new Error("Target GP must be at least 0% and below 100%.");
  }
  if (bottlePrice <= 0 || landedBottleCost <= 0 || targetGpMargin <= 0) return 0;
  return money(Math.max(0, landedBottleCost - bottlePrice * (1 - targetGpMargin)));
}

export function requiredBottlePriceForTargetMargin(input: {
  landedBottleCost?: number | null;
  depletionAllowance?: number | null;
  targetGpMargin?: number | null;
}) {
  const targetGpMargin = Number(input.targetGpMargin) || 0;
  if (!Number.isFinite(targetGpMargin) || targetGpMargin < 0 || targetGpMargin >= 1) {
    throw new Error("Target GP must be at least 0% and below 100%.");
  }
  const landedBottleCost = money(input.landedBottleCost);
  const depletionAllowance = money(input.depletionAllowance);
  const netCost = Math.max(0, landedBottleCost - depletionAllowance);
  if (netCost <= 0 || targetGpMargin <= 0) return 0;
  return money(netCost / (1 - targetGpMargin));
}

export function balancePriceLevel(input: {
  bottlePrice?: number | null;
  depletionAllowance?: number | null;
  targetGpMargin?: number | null;
  landedBottleCost?: number | null;
  fallbackBottlePrice?: number | null;
  solveFor?: SolveForMode;
}) {
  const hasBottlePrice = input.bottlePrice !== null && input.bottlePrice !== undefined;
  const hasTargetGpMargin = input.targetGpMargin !== null && input.targetGpMargin !== undefined;
  const targetGpMargin = hasTargetGpMargin ? Number(input.targetGpMargin) : null;
  if (targetGpMargin !== null && (!Number.isFinite(targetGpMargin) || targetGpMargin < 0 || targetGpMargin >= 1)) {
    throw new Error("Target GP must be at least 0% and below 100%.");
  }
  const solveFor = input.solveFor || "gp";
  const landedBottleCost = money(input.landedBottleCost);
  let bottlePrice = hasBottlePrice ? money(input.bottlePrice) : money(input.fallbackBottlePrice);
  let depletionAllowance = money(input.depletionAllowance);
  let noDaRequired = false;

  if (solveFor === "price") {
    if (targetGpMargin === null) throw new Error("Target GP is required when solving for Price.");
    bottlePrice = requiredBottlePriceForTargetMargin({
      landedBottleCost,
      depletionAllowance,
      targetGpMargin
    });
  } else if (solveFor === "da") {
    if (targetGpMargin === null || !hasBottlePrice) throw new Error("Target GP and selling price are required when solving for DA.");
    const rawDa = landedBottleCost - bottlePrice * (1 - targetGpMargin);
    noDaRequired = rawDa <= 0;
    depletionAllowance = money(Math.max(0, rawDa));
  }

  const calculatedGpMargin = calculateGpMargin({
    bottlePrice,
    landedBottleCost,
    depletionAllowance
  });

  return {
    bottlePrice,
    depletionAllowance,
    targetGpMargin,
    calculatedGpMargin,
    calculatedField: solveFor,
    solveFor,
    noDaRequired,
    daExceedsLandedCost: depletionAllowance > landedBottleCost,
    belowMinimumGp: bottlePrice > 0 && calculatedGpMargin < MINIMUM_GP_MARGIN
  };
}

export function calculatePricing(input: {
  packSize?: number | null;
  fobBottle?: number | null;
  fobCase?: number | null;
  laidInPerBottle?: number | null;
  frontlineBottlePrice?: number | null;
  bestPrice?: number | null;
  bestDepletionAllowance?: number | null;
  pricingBasis?: "bottle" | "case" | null;
  grwBrokerModel?: boolean;
  frontlineOnly?: boolean;
}): PricingResult {
  const normalized = normalizeFobCosts({
    packSize: Number(input.packSize),
    fobBottle: input.fobBottle,
    fobCase: input.fobCase,
    pricingBasis: input.pricingBasis
  });
  const { packSize, fobBottle, fobCase } = normalized;
  const laidInPerBottle = money(input.laidInPerBottle);
  if (laidInPerBottle < 0) throw new Error("Laid-in cost cannot be negative.");

  const landedBottleCost = money(fobBottle + laidInPerBottle);
  const hasFob = normalized.pricingBasis === "case"
    ? input.fobCase !== null && input.fobCase !== undefined && money(input.fobCase) > 0
    : input.fobBottle !== null && input.fobBottle !== undefined && money(input.fobBottle) > 0;
  const hasLaidIn = input.laidInPerBottle !== null && input.laidInPerBottle !== undefined;
  const suggestionsReady = hasFob && hasLaidIn;
  const suggestedBest = suggestionsReady ? roundSuggestedPriceUp(landedBottleCost / (1 - BEST_TARGET_MARGIN)) : 0;
  let suggestedFrontline = suggestionsReady ? roundSuggestedPriceUp(landedBottleCost / (1 - FRONTLINE_TARGET_MARGIN)) : 0;
  if (suggestedBest > 0 && suggestedFrontline <= suggestedBest) {
    suggestedFrontline = money(suggestedBest + (suggestedBest >= 20 || suggestedFrontline >= 20 ? 1 : 0.25));
  }
  const existingFrontline = input.frontlineBottlePrice !== null && input.frontlineBottlePrice !== undefined
    ? money(input.frontlineBottlePrice)
    : null;
  const existingBest = input.bestPrice !== null && input.bestPrice !== undefined ? money(input.bestPrice) : null;
  let frontlineBottlePrice = existingFrontline ?? suggestedFrontline;
  let bestPrice = input.frontlineOnly ? null : existingBest ?? suggestedBest;
  if (input.grwBrokerModel) {
    frontlineBottlePrice = existingFrontline || 0;
    bestPrice = existingBest;
  }
  const bestGpMargin = bestPrice && bestPrice > 0 ? calculateGpMargin({
    bottlePrice: bestPrice,
    landedBottleCost
  }) : null;
  const bestTargetConflict = !input.grwBrokerModel && bestGpMargin !== null && bestGpMargin < BEST_TARGET_MARGIN;
  const grossProfitMargin = frontlineBottlePrice
    ? Math.round(((frontlineBottlePrice - landedBottleCost) / frontlineBottlePrice) * 10000) / 10000
    : 0;
  const warnings: string[] = [];
  if (!input.grwBrokerModel && frontlineBottlePrice && grossProfitMargin < GP_WARNING_THRESHOLD) warnings.push(GP_WARNING_PERSISTED);
  if (money(input.bestDepletionAllowance) > landedBottleCost) warnings.push("Best depletion allowance exceeds landed cost.");
  if (bestTargetConflict) warnings.push("Best ladder price is below the 30% target GP.");

  return {
    packSize,
    fobBottle,
    fobCase,
    laidInPerBottle,
    landedBottleCost,
    frontlineBottlePrice,
    bestPrice,
    grossProfitMargin,
    bestGrossProfitMargin: bestGpMargin,
    suggestionsReady,
    warnings,
    diagnostics: {
      basis: normalized.pricingBasis,
      frontline_target_margin: FRONTLINE_TARGET_MARGIN,
      best_target_margin: BEST_TARGET_MARGIN,
      gp_warning_threshold: GP_WARNING_THRESHOLD,
      frontline_formula: "CEILING(landed_bottle_cost / 0.68)",
      best_price_rule: "CEILING(landed_bottle_cost / 0.70), independently rounded upward",
      best_gp_margin: bestGpMargin,
      best_target_conflict: bestTargetConflict,
      informational_only: Boolean(input.grwBrokerModel),
      suggestions_ready: suggestionsReady,
      warnings
    }
  };
}

export function normalizeSystemTags(tags: string[] = []) {
  const valid = new Set<string>(SYSTEM_TAGS);
  return Array.from(new Set(tags
    .map(normalizeSpaces)
    .map((tag) => tag === "Select" ? "Limited Core" : tag)
    .filter((tag) => valid.has(tag))));
}

export function findDuplicateActivePriceLevels(levels: SupplierCatalogPriceLevelInput[] = []) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const level of levels.filter((row) => row.active !== false)) {
    const key = normalizeSpaces(level.name).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!key) continue;
    if (seen.has(key)) duplicates.add(normalizeSpaces(level.name));
    seen.add(key);
  }
  return [...duplicates];
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
      active: true,
      solveFor: "gp" as const,
      suggestedPrice: pricing.frontlineBottlePrice,
      suggestedGpMargin: pricing.grossProfitMargin,
      isManualOverride: false
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
            active: true,
            solveFor: "gp" as const,
            suggestedPrice: pricing.bestPrice,
            suggestedGpMargin: pricing.bestGrossProfitMargin,
            isManualOverride: false
          }
        ]
      : [])
  ];
}

export function completeRequiredPriceLevels(
  levels: SupplierCatalogPriceLevelInput[] | undefined,
  pricing: PricingResult,
  frontlineOnly = false
) {
  const current = [...(levels || [])];
  const defaults = defaultPriceLevelsForPricing(pricing);
  const frontlineDefault = defaults.find((level) => level.isFrontline);
  const bestDefault = defaults.find((level) => level.isBest);

  if (!current.some((level) => level.active !== false && level.isFrontline) && frontlineDefault) {
    current.unshift(frontlineDefault);
  }

  if (frontlineOnly) {
    return current.map((level) => level.isBest ? { ...level, active: false } : level);
  }

  if (!current.some((level) => level.active !== false && level.isBest) && bestDefault) {
    current.push(bestDefault);
  }

  return current;
}

export function normalizePriceLevels(
  levels: SupplierCatalogPriceLevelInput[] = [],
  landedBottleCost = 0
): SupplierCatalogPriceLevelInput[] {
  return levels
    .map((level, index) => {
      const targetGpMargin =
        level.targetGpMargin === null || level.targetGpMargin === undefined ? null : Math.max(0, Math.min(0.99, Number(level.targetGpMargin) || 0));
      const balanced = balancePriceLevel({
        bottlePrice: level.bottlePrice,
        depletionAllowance: level.depletionAllowance,
        targetGpMargin,
        landedBottleCost,
        solveFor: level.solveFor || "gp"
      });

      return {
        id: level.id,
        name: normalizeSpaces(level.name) || `Level ${index + 1}`,
        bottlePrice: balanced.bottlePrice,
        depletionAllowance: balanced.depletionAllowance,
        targetGpMargin,
        calculatedGpMargin: balanced.calculatedGpMargin,
        isFrontline: Boolean(level.isFrontline),
        isBest: Boolean(level.isBest),
        displayOrder: Math.max(0, Math.trunc(Number(level.displayOrder ?? index) || 0)),
        active: level.active ?? true,
        sourceSystem: level.sourceSystem || null,
        sourceId: level.sourceId || null,
        solveFor: level.solveFor || "gp",
        approvalDecision: level.approvalDecision || null,
        overrideReason: normalizeSpaces(level.overrideReason || "") || null,
        approvalOwner: normalizeSpaces(level.approvalOwner || "") || null,
        decisionTimestamp: level.decisionTimestamp || null,
        suggestedPrice: level.suggestedPrice ?? balanced.bottlePrice,
        suggestedGpMargin: level.suggestedGpMargin ?? balanced.calculatedGpMargin,
        daAlternative: level.daAlternative ?? requiredDepletionAllowanceForTargetMargin({
          bottlePrice: balanced.bottlePrice,
          landedBottleCost,
          targetGpMargin: MINIMUM_GP_MARGIN
        }),
        finalApprovedPrice: level.finalApprovedPrice ?? (level.approvalDecision === "approve_price" ? balanced.bottlePrice : null),
        finalApprovedDa: level.finalApprovedDa ?? (level.approvalDecision === "approve_price" ? balanced.depletionAllowance : null),
        finalGpMargin: level.finalGpMargin ?? (level.approvalDecision === "approve_price" ? balanced.calculatedGpMargin : null),
        isManualOverride: Boolean(level.isManualOverride)
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
      active: freeGood.active ?? true,
      extensionMetadata: freeGood.extensionMetadata || {}
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
    bestPrice: input.bestPriceOverride,
    bestDepletionAllowance: input.priceLevels?.find((level) => level.isBest)?.depletionAllowance,
    pricingBasis: input.pricingBasis,
    grwBrokerModel: input.pricingModel === "grw_broker",
    frontlineOnly: input.frontlineOnly
  });
  const priceLevels = normalizePriceLevels(
    completeRequiredPriceLevels(input.priceLevels, pricing, Boolean(input.frontlineOnly)),
    pricing.landedBottleCost
  );
  const frontlineLevel = priceLevels.find((level) => level.active !== false && level.isFrontline) ||
    priceLevels.find((level) => level.active !== false) || null;
  const bestLevel = priceLevels.find((level) => level.active !== false && level.isBest) || null;
  const frontlineBottlePrice = frontlineLevel ? money(frontlineLevel.bottlePrice) : pricing.frontlineBottlePrice;
  const bestPrice = bestLevel ? money(bestLevel.bottlePrice) : pricing.bestPrice;
  const grossProfitMargin = calculateGpMargin({
    bottlePrice: frontlineBottlePrice,
    landedBottleCost: pricing.landedBottleCost
  });
  const informationalOnly = input.pricingModel === "grw_broker";
  const warnings = !informationalOnly && frontlineBottlePrice && grossProfitMargin < GP_WARNING_THRESHOLD ? [GP_WARNING_PERSISTED] : [];
  const priceLevelWarnings = informationalOnly ? [] : priceLevels
    .filter((level) => level.active !== false && money(level.bottlePrice) > 0 && Number(level.calculatedGpMargin || 0) < GP_WARNING_THRESHOLD)
    .map((level) => `${level.name} gross profit margin is below 28%.`);
  const productLifecycleStatus = input.conversionStatus === "exact_existing_product" ? "supplier_available" : "pending_product_creation";
  const pricingCostFingerprint = [pricing.packSize, pricing.fobBottle.toFixed(2), pricing.laidInPerBottle.toFixed(2)].join("|");
  const costFreshnessWarnings = [
    pricing.fobBottle <= 0 ? "FOB cost is missing." : "",
    pricing.laidInPerBottle === 0 ? "Laid-in cost is zero; confirm that no freight applies." : "",
    input.priorPricingCostFingerprint && input.priorPricingCostFingerprint !== pricingCostFingerprint
      ? "Cost changed after the saved pricing was calculated. Review the proposed prices before saving."
      : ""
  ].filter(Boolean);

  const supplierWine = {
    supplier_id: input.supplierId || null,
    supplier_name: normalizeSpaces(input.supplierName),
    producer: normalizeSpaces(input.producer),
    wine_name: normalizeSpaces(input.wineName),
    vintage: identity.normalizedVintage,
    pack_size: pricing.packSize,
    bottle_size: normalizeSpaces(input.bottleSize || "750ml"),
    pricing_basis: input.pricingBasis || (money(input.fobBottle) > 0 ? "bottle" : "case"),
    pricing_model: input.pricingModel || "standard",
    fob_source_date: input.fobSourceDate || null,
    laid_in_source_date: input.laidInSourceDate || null,
    pricing_calculated_at: input.pricingCalculatedAt || null,
    pricing_cost_fingerprint: pricingCostFingerprint,
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
      warnings: Array.from(new Set([
        ...warnings,
        ...priceLevelWarnings,
        ...costFreshnessWarnings,
        ...priceLevels.filter((level) => money(level.depletionAllowance) > pricing.landedBottleCost)
          .map((level) => `${level.name} depletion allowance exceeds landed cost.`)
      ])),
      price_levels: priceLevels,
      free_goods: normalizeFreeGoods(input.freeGoods),
      quickbooks_item_name_preview: identity.displayName
    },
    quickbooks_item_id: normalizeSpaces(input.quickbooksItemId || input.quickbooksItemNumber || "") || null,
    quickbooks_item_name: normalizeSpaces(input.quickbooksItemName || "") || null,
    quickbooks_item_number: normalizeSpaces(input.quickbooksItemNumber || "") || null,
    quickbooks_sync_status: input.quickbooksItemNumber || input.quickbooksItemId ? "linked" : "not_created",
    product_lifecycle_status: productLifecycleStatus,
    frontline_only: Boolean(input.frontlineOnly),
    accounting_create_payload: {},
    system_tags: normalizeSystemTags(input.systemTags || []),
    copied_from_supplier_catalog_wine_id: input.copiedFromSupplierCatalogWineId || null,
    source_system: input.sourceSystem || null,
    source_id: input.sourceId || null
  } satisfies Omit<SupplierCatalogWine, "id" | "created_at" | "updated_at" | "price_levels" | "free_goods" | "workbench_items">;

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
      solve_for: level.solveFor || "gp",
      calculated_gp_margin: level.calculatedGpMargin || 0,
      is_frontline: Boolean(level.isFrontline),
      is_best: Boolean(level.isBest),
      display_order: level.displayOrder || index,
      active: level.active ?? true,
      source_system: level.sourceSystem || null,
      source_id: level.sourceId || null,
      approval_decision: level.approvalDecision || null,
      suggested_price: level.suggestedPrice ?? null,
      suggested_gp_margin: level.suggestedGpMargin ?? null,
      da_alternative: level.daAlternative ?? null,
      final_approved_price: level.finalApprovedPrice ?? null,
      final_approved_da: level.finalApprovedDa ?? null,
      final_gp_margin: level.finalGpMargin ?? null,
      is_manual_override: Boolean(level.isManualOverride),
      override_reason: level.overrideReason || null,
      approval_owner: level.approvalOwner || null,
      decision_timestamp: level.decisionTimestamp || null,
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
      extension_metadata: freeGood.extensionMetadata || {},
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
