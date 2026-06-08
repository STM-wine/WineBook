import type { PriceChangeEvent, SupplierCatalogWine, SupplierLogistics, WineRequest } from "@/lib/types";

export const AVAILABILITY_STATUSES = ["available", "limited", "sold_out", "unknown"] as const;
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

export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

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

export function calculateBestPrice(frontlineBottlePrice: number) {
  const frontline = money(frontlineBottlePrice);
  if (frontline >= 50) return null;
  if (frontline >= 20 && frontline <= 49) return money(frontline - 2);
  if (frontline < 20 && frontline > 0) return money(frontline - 1);
  return null;
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
    frontline_bottle_price: pricing.frontlineBottlePrice,
    best_price: pricing.bestPrice,
    gross_profit_margin: pricing.grossProfitMargin,
    availability_status: input.availabilityStatus,
    conversion_status: input.conversionStatus,
    display_name: identity.displayName,
    planning_sku: identity.planningSku,
    planning_sku_without_vintage: identity.planningSkuWithoutVintage,
    diagnostics: {
      ...pricing.diagnostics,
      quickbooks_item_name_preview: identity.displayName
    },
    quickbooks_sync_status: "not_created",
    product_lifecycle_status: productLifecycleStatus,
    accounting_create_payload: {}
  } satisfies Omit<SupplierCatalogWine, "id" | "created_at" | "updated_at" | "quickbooks_item_id" | "quickbooks_item_name">;

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
    }
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
