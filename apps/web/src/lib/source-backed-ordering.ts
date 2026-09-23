import type { OrderingLogicSettings } from "./ordering-logic";
import {
  recommendationIsAutomatic,
  recommendationsAreSuppressed,
  replenishmentPolicy,
  replenishmentPolicyFamilyKey,
  type ReplenishmentPolicy
} from "./replenishment-policy";

export const ORDERING_SOURCE = "quickbooks_vinosmith_stem";
export const ORDERING_BUILDER_VERSION = 7;

export type SourceQuickBooksItem = {
  list_id: string;
  name: string | null;
  full_name: string | null;
  sales_desc?: string | null;
  purchase_desc?: string | null;
  is_active: boolean | null;
  item_type: string | null;
  quantity_on_hand: number | string | null;
  quantity_on_order: number | string | null;
  purchase_cost: number | string | null;
  average_cost: number | string | null;
  custom_fields: Record<string, unknown> | null;
  raw_data: Record<string, unknown> | null;
  last_seen_at?: string | null;
};

export type SourceVinosmithWine = {
  wine_id: string;
  code: string | null;
  name: string | null;
  vintage?: string | number | null;
  importer_name: string | null;
};

export type SourceSupplier = {
  id: string;
  name: string;
  eta_days: number | string | null;
  pick_up_location: string | null;
  freight_forwarder: string | null;
  order_frequency: string | null;
  tdm: string | null;
  trucking_cost_per_bottle: number | string | null;
  active: boolean | null;
};

export type SourceOrderingMarker = {
  item_code: string;
  quickbooks_item_list_id: string | null;
  is_btg: boolean | null;
  is_core: boolean | null;
  replenishment_policy?: string | null;
  policy_family_key?: string | null;
  policy_family_name?: string | null;
  family_default_policy?: string | null;
  recommendations_suppressed?: boolean | null;
  suppression_reason?: string | null;
  suppressed_until?: string | null;
  suppression_changed_at?: string | null;
  suppression_changed_by?: string | null;
  note_source?: string | null;
};

export type SourceVendorMapping = {
  quickbooks_vendor_list_id: string;
  supplier_id: string | null;
  vendor_classification: string | null;
};

export type SourceQuickBooksVendor = {
  list_id: string;
  name: string | null;
  full_name: string | null;
};

export type SourceSalesWindows = {
  last30: number;
  last60: number;
  last90: number;
  prior30: number;
  next30Ly: number;
  next60Ly: number;
  next90Ly: number;
};

export type SourceBackedRecommendationRow = {
  planning_sku: string;
  product_name: string;
  product_code: string;
  supplier_name: string;
  brand_manager: string | null;
  is_btg: boolean;
  is_core: boolean;
  replenishment_policy: ReplenishmentPolicy;
  policy_family_key: string | null;
  recommendations_suppressed: boolean;
  suppression_reason: string | null;
  suppressed_until: string | null;
  suppression_changed_at: string | null;
  suppression_changed_by: string | null;
  last_30_day_sales: number;
  last_60_day_sales: number;
  last_90_day_sales: number;
  prior_30_day_sales: number;
  next_30_day_forecast: number;
  next_60_day_forecast: number;
  next_90_day_forecast: number;
  next_60_days_ly_sales: number;
  weekly_velocity: number;
  velocity_trend_pct: number | null;
  velocity_trend_label: string;
  weeks_on_hand: number | null;
  weeks_on_hand_with_on_order: number | null;
  target_days: number;
  target_qty: number;
  base_recommended_qty_raw: number;
  purchasing_environment_multiplier: number;
  purchasing_environment_mode: string | null;
  purchasing_environment_month: number;
  recommended_qty_raw: number;
  recommended_qty_rounded: number;
  approved_qty: number;
  recommendation_status: "rejected" | "approved" | "edited" | "deferred";
  order_path: "stateside" | "di";
  order_cost: number;
  reorder_status: "URGENT" | "LOW" | "OK" | "NO SALES";
  risk_level: "High" | "Medium" | "Low" | "No Sales" | "Unknown";
  order_timing_risk: string | null;
  true_available: number;
  on_order: number;
  fob: number;
  pack_size: number;
  pickup_location: string | null;
  trucking_cost_per_bottle: number;
  landed_cost: number;
  diagnostics: Record<string, unknown>;
};

export type SourceBackedOrderingDiagnostics = {
  ordering_source: typeof ORDERING_SOURCE;
  uses_rb6: false;
  uses_rads: false;
  builder_version: number;
  reference_date: string;
  quickbooks_as_of: string | null;
  quickbooks_freshness_hours: number | null;
  quickbooks_fresh: boolean;
  vinosmith_available_as_of: string;
  vinosmith_available_fingerprint: string;
  active_quickbooks_product_rows: number;
  ready_rows: number;
  review_rows: number;
  missing_vinosmith_code: number;
  missing_vinosmith_available: number;
  missing_supplier_mapping: number;
  unmapped_preferred_vendor: number;
  missing_pack_size: number;
  missing_fob: number;
  core_btg_rows: number;
  suggested_bottles: number;
};

export type SourceBackedOrderingData = {
  rows: SourceBackedRecommendationRow[];
  diagnostics: SourceBackedOrderingDiagnostics;
};

export type BuyerStateRow = {
  product_code: string | null;
  recommendation_status: string | null;
  approved_qty: number | string | null;
  order_path?: string | null;
};

export function carryForwardBuyerState(
  rows: SourceBackedRecommendationRow[],
  previousRows: BuyerStateRow[],
  enteredProductCodes: ReadonlySet<string>
) {
  const stateByCode = new Map(
    previousRows
      .filter((row) => row.recommendation_status === "approved" || row.recommendation_status === "edited")
      .map((row) => [normalizeOrderingItemCode(row.product_code), row] as const)
      .filter(([code]) => code && !enteredProductCodes.has(code))
  );
  let carried = 0;
  const nextRows = rows.map((row) => {
    const previous = stateByCode.get(normalizeOrderingItemCode(row.product_code));
    if (!previous) return row;
    carried += 1;
    return {
      ...row,
      recommendation_status: previous.recommendation_status as "approved" | "edited",
      approved_qty: Math.max(0, Math.round(numberValue(previous.approved_qty))),
      order_path: previous.order_path === "di" ? "di" as const : "stateside" as const,
      diagnostics: { ...row.diagnostics, buyer_state_carried_forward: true }
    };
  });
  return { rows: nextRows, carried };
}

export function normalizeOrderingItemCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export function isLikelyOrderingItemCode(value: string) {
  return /^[A-Z]{2,}\d{5,6}$/i.test(value.trim());
}

export function buildSourceBackedOrderingRows(input: {
  quickBooksItems: SourceQuickBooksItem[];
  vinosmithWines: SourceVinosmithWine[];
  vinosmithAvailableByCode: ReadonlyMap<string, number>;
  vinosmithAvailableAsOf: string;
  quickBooksAsOf: string | null;
  suppliers: SourceSupplier[];
  quickBooksVendors: SourceQuickBooksVendor[];
  vendorMappings: SourceVendorMapping[];
  markers: SourceOrderingMarker[];
  salesByCode: ReadonlyMap<string, SourceSalesWindows>;
  settings: OrderingLogicSettings;
  referenceDate: string;
}): SourceBackedOrderingData {
  const winesByCode = firstByNormalizedCode(input.vinosmithWines, (wine) => wine.code);
  const suppliersById = new Map(input.suppliers.map((supplier) => [supplier.id, supplier]));
  const suppliersByName = new Map(input.suppliers.map((supplier) => [normalizeName(supplier.name), supplier]));
  const vendorsById = new Map(input.quickBooksVendors.map((vendor) => [vendor.list_id, vendor]));
  const mappingsByVendorId = new Map(input.vendorMappings.map((mapping) => [mapping.quickbooks_vendor_list_id, mapping]));
  const markersByCode = new Map(input.markers.map((marker) => [normalizeOrderingItemCode(marker.item_code), marker]));
  const familyDefaults = new Map<string, ReplenishmentPolicy>();
  for (const marker of input.markers) {
    if (!marker.policy_family_key || familyDefaults.has(marker.policy_family_key)) continue;
    familyDefaults.set(marker.policy_family_key, replenishmentPolicy(marker.family_default_policy || marker.replenishment_policy));
  }

  const activeItems = input.quickBooksItems.filter((item) => {
    const code = normalizeOrderingItemCode(quickBooksItemCode(item));
    return item.is_active !== false && item.item_type?.toLowerCase() === "inventory" && isLikelyOrderingItemCode(code);
  });
  const latestActiveVintageByFamily = new Map<string, number>();
  for (const item of activeItems) {
    const productCode = normalizeOrderingItemCode(quickBooksItemCode(item));
    const identity = orderingVintageIdentity(item, winesByCode.get(productCode) || null);
    if (!identity.familyKey || identity.vintage === null) continue;
    const current = latestActiveVintageByFamily.get(identity.familyKey);
    if (current === undefined || identity.vintage > current) {
      latestActiveVintageByFamily.set(identity.familyKey, identity.vintage);
    }
  }

  const rows = activeItems.map((item) => {
    const productCode = normalizeOrderingItemCode(quickBooksItemCode(item));
    const wine = winesByCode.get(productCode) || null;
    const hasAvailable = input.vinosmithAvailableByCode.has(productCode);
    const trueAvailable = numberValue(input.vinosmithAvailableByCode.get(productCode));
    const preferredVendorId = preferredVendorListId(item);
    const preferredVendor = preferredVendorId ? vendorsById.get(preferredVendorId) || null : null;
    const preferredVendorName = preferredVendor?.name?.trim() || preferredVendor?.full_name?.trim() || preferredVendorNameFromItem(item);
    const mapping = preferredVendorId ? mappingsByVendorId.get(preferredVendorId) || null : null;
    const mappedSupplier = mapping?.vendor_classification === "inventory_wine" && mapping.supplier_id
      ? suppliersById.get(mapping.supplier_id) || null
      : null;
    const vinosmithSupplier = wine?.importer_name ? suppliersByName.get(normalizeName(wine.importer_name)) || null : null;
    const supplier = mappedSupplier || (!preferredVendorId ? vinosmithSupplier : null);
    const supplierSource = mappedSupplier
      ? "quickbooks_preferred_vendor"
      : preferredVendorId
        ? "unmapped_quickbooks_preferred_vendor"
        : vinosmithSupplier
          ? "vinosmith_importer_fallback"
          : "missing";
    const exactMarker = markersByCode.get(productCode) || null;
    const policyFamilyKey = wine?.name ? replenishmentPolicyFamilyKey(wine.name, wine.vintage) : "";
    const legacyPolicy = exactMarker?.is_core === true || exactMarker?.is_btg === true ? "Core" : null;
    const exactPolicy = exactMarker?.replenishment_policy || legacyPolicy;
    const familyPolicy = exactMarker?.family_default_policy || (policyFamilyKey ? familyDefaults.get(policyFamilyKey) : null);
    const hasManualPolicyOverride = exactMarker?.note_source === "manual";
    const policy = replenishmentPolicy(
      hasManualPolicyOverride ? exactPolicy : familyPolicy || exactPolicy
    );
    // Suppression is deliberately exact-item only. A replacement vintage gets a
    // different item code, inherits the family policy, and resumes automatically.
    const recommendationsSuppressed = recommendationsAreSuppressed(
      exactMarker?.recommendations_suppressed,
      exactMarker?.suppression_reason,
      exactMarker?.suppressed_until,
      input.referenceDate
    );
    const vintageIdentity = orderingVintageIdentity(item, wine);
    const latestActiveVintage = vintageIdentity.familyKey
      ? latestActiveVintageByFamily.get(vintageIdentity.familyKey) ?? null
      : null;
    const isLatestActiveVintage = vintageIdentity.vintage === null || latestActiveVintage === null
      ? true
      : vintageIdentity.vintage === latestActiveVintage;
    const olderVintageSuppressed = !isLatestActiveVintage;
    const automaticRecommendation = recommendationIsAutomatic(policy, recommendationsSuppressed) && isLatestActiveVintage;
    const sales = input.salesByCode.get(productCode) || emptySalesWindows();
    const pack = quickBooksPackSize(item, input.settings.default_pack_size);
    const purchaseCost = nullableNumber(item.purchase_cost);
    const averageCost = nullableNumber(item.average_cost);
    const fob = Math.max(0, purchaseCost ?? averageCost ?? 0);
    const fobSource = purchaseCost !== null ? "quickbooks_purchase_cost" : averageCost !== null ? "quickbooks_average_cost" : "missing";
    const onOrder = Math.max(0, numberValue(item.quantity_on_order));
    const weeklyVelocity = sales.last30 / 4.345;
    const isBtg = false;
    const isCore = policy === "Core";
    const calculation = calculateSourceRecommendation({
      weeklyVelocity,
      trueAvailable,
      onOrder,
      isBtg,
      isCore,
      automaticRecommendation,
      packSize: pack.packSize,
      settings: input.settings,
      referenceDate: input.referenceDate
    });
    const trucking = Math.max(0, numberValue(supplier?.trucking_cost_per_bottle));
    const blockers = [
      !wine ? "missing_exact_vinosmith_code" : null,
      !hasAvailable ? "missing_vinosmith_available" : null,
      !supplier ? "missing_supplier_mapping" : null,
      preferredVendorId && !mappedSupplier ? "unmapped_quickbooks_preferred_vendor" : null,
      !pack.fromCustomField ? "missing_quickbooks_pack_size" : null,
      fob <= 0 ? "missing_quickbooks_fob" : null
    ].filter((value): value is string => Boolean(value));
    const velocityTrendPct = sales.prior30 > 0 ? ((sales.last30 - sales.prior30) / sales.prior30) * 100 : null;

    return {
      planning_sku: productCode,
      product_name: item.sales_desc?.trim() || item.purchase_desc?.trim() || item.full_name?.trim() || item.name?.trim() || wine?.name?.trim() || productCode,
      product_code: productCode,
      supplier_name: supplier?.name || (preferredVendorName ? `Unmapped QB Vendor: ${preferredVendorName}` : wine?.importer_name || "Unknown Supplier"),
      brand_manager: supplier?.tdm?.trim() || null,
      is_btg: isBtg,
      is_core: isCore,
      replenishment_policy: policy,
      policy_family_key: policyFamilyKey || exactMarker?.policy_family_key || null,
      recommendations_suppressed: recommendationsSuppressed,
      suppression_reason: exactMarker?.suppression_reason || null,
      suppressed_until: exactMarker?.suppressed_until || null,
      suppression_changed_at: exactMarker?.suppression_changed_at || null,
      suppression_changed_by: exactMarker?.suppression_changed_by || null,
      last_30_day_sales: sales.last30,
      last_60_day_sales: sales.last60,
      last_90_day_sales: sales.last90,
      prior_30_day_sales: sales.prior30,
      next_30_day_forecast: sales.next30Ly,
      next_60_day_forecast: sales.next60Ly,
      next_90_day_forecast: sales.next90Ly,
      next_60_days_ly_sales: sales.next60Ly,
      weekly_velocity: weeklyVelocity,
      velocity_trend_pct: velocityTrendPct,
      velocity_trend_label: velocityTrendLabel(velocityTrendPct, sales.last30, sales.prior30),
      weeks_on_hand: weeklyVelocity > 0 ? round(trueAvailable / weeklyVelocity, 2) : null,
      weeks_on_hand_with_on_order: weeklyVelocity > 0 ? round((trueAvailable + onOrder) / weeklyVelocity, 2) : null,
      ...calculation,
      approved_qty: 0,
      recommendation_status: "rejected" as const,
      order_path: "stateside" as const,
      order_cost: round(calculation.recommended_qty_rounded * fob, 2),
      reorder_status: reorderStatus(weeklyVelocity, trueAvailable, calculation.target_days, input.settings.urgent_weeks_threshold),
      risk_level: riskLevel(weeklyVelocity, trueAvailable + onOrder, calculation.target_qty, input.settings),
      order_timing_risk: null,
      true_available: trueAvailable,
      on_order: onOrder,
      fob,
      pack_size: pack.packSize,
      pickup_location: supplier?.pick_up_location || null,
      trucking_cost_per_bottle: trucking,
      landed_cost: round(calculation.recommended_qty_rounded * (fob + trucking), 2),
      diagnostics: {
        ordering_source: ORDERING_SOURCE,
        quickbooks_item_list_id: item.list_id,
        exact_item_code: productCode,
        quickbooks_item_as_of: item.last_seen_at || input.quickBooksAsOf,
        quickbooks_on_hand: numberValue(item.quantity_on_hand),
        vinosmith_wine_id: wine?.wine_id || null,
        vinosmith_available_as_of: input.vinosmithAvailableAsOf,
        vinosmith_available_present: hasAvailable,
        supplier_id: supplier?.id || null,
        supplier_source: supplierSource,
        supplier_eta_days: supplier?.eta_days ?? null,
        supplier_freight_forwarder: supplier?.freight_forwarder || null,
        supplier_order_frequency: supplier?.order_frequency || null,
        quickbooks_preferred_vendor_list_id: preferredVendorId,
        quickbooks_preferred_vendor_name: preferredVendorName,
        pack_size_source: pack.source,
        fob_source: fobSource,
        replenishment_policy: policy,
        policy_source: hasManualPolicyOverride
          ? "item_manual_override"
          : familyPolicy
            ? "family_inherited"
            : exactMarker
              ? "item"
              : "default_limited",
        automatic_recommendation: automaticRecommendation,
        recommendations_suppressed: recommendationsSuppressed,
        vintage: vintageIdentity.vintage,
        latest_active_vintage: latestActiveVintage,
        is_latest_active_vintage: isLatestActiveVintage,
        older_vintage_suppressed: olderVintageSuppressed,
        blockers
      }
    } satisfies SourceBackedRecommendationRow;
  });

  const blockersFor = (name: string) => rows.filter((row) => (row.diagnostics.blockers as string[]).includes(name)).length;
  const quickBooksFreshnessHours = ageHours(input.quickBooksAsOf);
  return {
    rows,
    diagnostics: {
      ordering_source: ORDERING_SOURCE,
      uses_rb6: false,
      uses_rads: false,
      builder_version: ORDERING_BUILDER_VERSION,
      reference_date: input.referenceDate,
      quickbooks_as_of: input.quickBooksAsOf,
      quickbooks_freshness_hours: quickBooksFreshnessHours,
      quickbooks_fresh: quickBooksFreshnessHours !== null && quickBooksFreshnessHours <= 72,
      vinosmith_available_as_of: input.vinosmithAvailableAsOf,
      vinosmith_available_fingerprint: availabilityFingerprint(input.vinosmithAvailableByCode),
      active_quickbooks_product_rows: activeItems.length,
      ready_rows: rows.filter((row) => (row.diagnostics.blockers as string[]).length === 0).length,
      review_rows: rows.filter((row) => (row.diagnostics.blockers as string[]).length > 0).length,
      missing_vinosmith_code: blockersFor("missing_exact_vinosmith_code"),
      missing_vinosmith_available: blockersFor("missing_vinosmith_available"),
      missing_supplier_mapping: blockersFor("missing_supplier_mapping"),
      unmapped_preferred_vendor: blockersFor("unmapped_quickbooks_preferred_vendor"),
      missing_pack_size: blockersFor("missing_quickbooks_pack_size"),
      missing_fob: blockersFor("missing_quickbooks_fob"),
      core_btg_rows: rows.filter((row) => row.is_core || row.is_btg).length,
      suggested_bottles: rows.reduce((sum, row) => sum + row.recommended_qty_rounded, 0)
    }
  };
}

function orderingVintageIdentity(item: SourceQuickBooksItem, wine: SourceVinosmithWine | null) {
  const name = wine?.name?.trim()
    || item.sales_desc?.trim()
    || item.purchase_desc?.trim()
    || item.full_name?.trim()
    || item.name?.trim()
    || "";
  const vintageText = String(
    wine?.vintage
      || customFieldText(item.custom_fields, ["Vintage", "vintage"])
      || name.match(/\b(?:19|20)\d{2}\b/)?.[0]
      || ""
  ).trim();
  const vintage = /^(?:19|20)\d{2}$/.test(vintageText) ? Number(vintageText) : null;
  const policyFamilyKey = replenishmentPolicyFamilyKey(name, vintageText);
  const format = name.match(/\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:ml|l)\s*$/i)?.[0]
    ?.toLowerCase()
    .replace(/\s+/g, "") || "";
  return {
    vintage,
    familyKey: policyFamilyKey ? `${policyFamilyKey}|${format}` : ""
  };
}

export function calculateSourceRecommendation(input: {
  weeklyVelocity: number;
  trueAvailable: number;
  onOrder: number;
  isBtg: boolean;
  isCore: boolean;
  automaticRecommendation?: boolean;
  packSize: number;
  settings: OrderingLogicSettings;
  referenceDate: string;
}) {
  const targetDays = input.isBtg ? input.settings.btg_target_days : input.isCore ? input.settings.core_target_days : input.settings.standard_target_days;
  const month = Number(input.referenceDate.slice(5, 7)) || 1;
  const monthSettings = input.settings.monthly_multipliers[String(month)];
  const multiplier = input.settings.monthly_mode_enabled ? monthSettings?.multiplier || 1 : 1;
  const targetQty = Math.max(0, input.weeklyVelocity) * (targetDays / 7);
  const baseRaw = Math.max(0, targetQty - (input.trueAvailable + Math.max(0, input.onOrder)));
  const raw = input.automaticRecommendation === false ? 0 : baseRaw * multiplier;
  const packSize = Math.max(1, Math.round(input.packSize));
  const preserveOnePack = (input.isBtg && input.settings.btg_round_sub_case_to_one_pack) || (input.isCore && input.settings.core_round_sub_case_to_one_pack);
  const rounded = raw <= 0 || (!preserveOnePack && raw < input.settings.standard_minimum_packs * packSize)
    ? 0
    : Math.ceil(raw / packSize) * packSize;
  return {
    target_days: targetDays,
    target_qty: targetQty,
    base_recommended_qty_raw: baseRaw,
    purchasing_environment_multiplier: multiplier,
    purchasing_environment_mode: input.settings.monthly_mode_enabled ? monthSettings?.mode || null : null,
    purchasing_environment_month: month,
    recommended_qty_raw: raw,
    recommended_qty_rounded: rounded
  };
}

export function quickBooksPackSize(item: SourceQuickBooksItem, defaultPackSize: number) {
  const custom = customFieldText(item.custom_fields, ["PACK SIZE", "Pack Size", "pack_size", "packSize", "PackSize", "pack"]);
  const customSize = integerPackSize(custom);
  if (customSize !== null) return { packSize: customSize, source: "quickbooks_pack_size", fromCustomField: true };
  const nameSize = integerPackSize(item.name || item.full_name || "");
  if (nameSize !== null) return { packSize: nameSize, source: "quickbooks_item_name_fallback", fromCustomField: false };
  return { packSize: Math.max(1, Math.round(defaultPackSize)), source: "ordering_logic_default", fromCustomField: false };
}

function quickBooksItemCode(item: SourceQuickBooksItem) {
  return customFieldText(item.custom_fields, ["item_number", "itemNumber", "ItemNumber", "sku", "SKU", "product_code", "productCode", "ProductCode"])
    || item.name || item.full_name || item.list_id;
}

function preferredVendorListId(item: SourceQuickBooksItem) {
  const raw = item.raw_data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw.preferred_vendor_ref ?? raw.pref_vendor_ref ?? raw.PrefVendorRef;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return nonEmptyText(record.ListID ?? record.list_id ?? record.value);
}

function preferredVendorNameFromItem(item: SourceQuickBooksItem) {
  const raw = item.raw_data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw.preferred_vendor_ref ?? raw.pref_vendor_ref ?? raw.PrefVendorRef;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return nonEmptyText(record.FullName ?? record.full_name ?? record.name);
}

function customFieldText(fields: Record<string, unknown> | null, keys: string[]) {
  if (!fields || Array.isArray(fields)) return "";
  const normalized = new Map(Object.entries(fields).map(([key, value]) => [normalizeFieldKey(key), value]));
  for (const key of keys) {
    const value = fields[key] ?? normalized.get(normalizeFieldKey(key));
    const text = customFieldValue(value);
    if (text) return text;
  }
  return "";
}

function customFieldValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return customFieldValue(record.value ?? record.Value ?? record.text ?? record.Text ?? record.DataExtValue);
}

function integerPackSize(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/(?:^|[^0-9])(\d{1,3})(?=\s*(?:\/|x|pk|pack|case|cs|btl|bottle|$))/i) || text.match(/^(\d{1,3})$/);
  const parsed = match ? Number(match[1]) : Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function firstByNormalizedCode<Row>(rows: Row[], codeFor: (row: Row) => unknown) {
  const map = new Map<string, Row>();
  for (const row of rows) {
    const code = normalizeOrderingItemCode(codeFor(row));
    if (code && !map.has(code)) map.set(code, row);
  }
  return map;
}

function reorderStatus(velocity: number, available: number, targetDays: number, urgentWeeks: number): SourceBackedRecommendationRow["reorder_status"] {
  if (velocity <= 0) return "NO SALES";
  const weeks = available / velocity;
  if (weeks < urgentWeeks) return "URGENT";
  return weeks < targetDays / 7 ? "LOW" : "OK";
}

function riskLevel(velocity: number, supply: number, targetQty: number, settings: OrderingLogicSettings): SourceBackedRecommendationRow["risk_level"] {
  if (velocity <= 0) return "No Sales";
  if (targetQty <= 0) return "Unknown";
  const ratio = supply / targetQty;
  if (ratio < settings.high_risk_coverage_threshold) return "High";
  if (ratio < settings.medium_risk_coverage_threshold) return "Medium";
  return "Low";
}

function velocityTrendLabel(pct: number | null, current: number, prior: number) {
  if (pct === null) return current > 0 && prior <= 0 ? "New" : "Flat";
  if (pct >= 10) return "Up";
  if (pct <= -10) return "Down";
  return "Flat";
}

function emptySalesWindows(): SourceSalesWindows {
  return { last30: 0, last60: 0, last90: 0, prior30: 0, next30Ly: 0, next60Ly: 0, next90Ly: 0 };
}

function normalizeName(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeFieldKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: unknown) {
  return nullableNumber(value) ?? 0;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ageHours(value: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 3_600_000) : null;
}

function availabilityFingerprint(values: ReadonlyMap<string, number>) {
  const canonical = Array.from(values.entries())
    .map(([code, available]) => `${normalizeOrderingItemCode(code)}:${numberValue(available)}`)
    .sort()
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${values.size}-${(hash >>> 0).toString(16)}`;
}
