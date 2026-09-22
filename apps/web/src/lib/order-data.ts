import type {
  DashboardMetrics,
  Recommendation,
  SupplierCatalogFreeGood,
  SupplierCatalogWine,
  SupplierCatalogWorkbenchItem,
  SupplierLogistics,
  SupplierGroup
} from "./types";
import { replenishmentPolicy, type ReplenishmentPolicy } from "./replenishment-policy";

export type SupplierGroupSortMode = "default" | "value" | "az" | "za";
export const DEFAULT_SUPPLIER_TARGET_WEEKS = 5;

export function asNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatCurrencyCents(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(value);
}

export function formatDecimal(value: number, digits = 1): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

export function rowRecommendedQty(row: Recommendation): number {
  const approved = asNumber(row.approved_qty);
  if (approved > 0) return approved;
  return asNumber(row.recommended_qty_rounded);
}

export function rowSuggestedValue(row: Recommendation): number {
  const landed = asNumber(row.landed_cost);
  if (landed > 0) return landed;
  const orderCost = asNumber(row.order_cost);
  const freight = asNumber(row.trucking_cost_per_bottle) * asNumber(row.recommended_qty_rounded);
  return orderCost + freight;
}

export function rowApprovedEstimate(row: Recommendation): number {
  const qty = asNumber(row.approved_qty) || rowRecommendedQty(row);
  const fob = asNumber(row.fob);
  const trucking = asNumber(row.trucking_cost_per_bottle);
  return qty * (fob + trucking);
}

function roundUpToPack(qty: number, packSize: number): number {
  const pack = Math.max(1, Math.round(packSize || 1));
  return Math.ceil(Math.max(0, qty) / pack) * pack;
}

function recommendationForTargetWeeks(row: Recommendation, targetWeeks: number): number {
  const velocity = asNumber(row.weekly_velocity);
  if (velocity <= 0) return 0;

  const currentSupply = asNumber(row.true_available) + asNumber(row.on_order);
  const rawQty = targetWeeks * velocity - currentSupply;
  return roundUpToPack(rawQty, asNumber(row.pack_size) || 1);
}

export function isOlderVintageSuppressed(
  row: Pick<Recommendation, "diagnostics">
): boolean {
  return row.diagnostics?.older_vintage_suppressed === true;
}

export function suppressOlderVintageRecommendation(row: Recommendation): Recommendation {
  if (!isOlderVintageSuppressed(row)) return row;
  return {
    ...row,
    recommended_qty_rounded: 0,
    order_cost: 0,
    landed_cost: 0
  };
}

export function applySupplierTargetWeeks(
  rows: Recommendation[],
  supplierTargetWeeks: Record<string, number>,
  defaultTargetWeeks = DEFAULT_SUPPLIER_TARGET_WEEKS
): Recommendation[] {
  return rows.map((row) => {
    // The source builder is authoritative about vintage eligibility. Target-week
    // overrides are presentation-time calculations and must never resurrect an
    // older vintage that the builder intentionally suppressed.
    if (isOlderVintageSuppressed(row)) return suppressOlderVintageRecommendation(row);

    const supplier = row.supplier_name?.trim() || "Unknown Supplier";
    const targetWeeks = supplierTargetWeeks[supplier] ?? defaultTargetWeeks;
    const policy = rowReplenishmentPolicy(row);
    const automatic = policy !== "Allocated" && policy !== "Special Order" && !(policy === "Limited" && row.recommendations_suppressed === true);
    if (!automatic) return row;
    if (!targetWeeks || targetWeeks <= 0 || row.order_path === "di") return row;
    if (row.supplier_catalog_workbench_item_id && asNumber(row.weekly_velocity) <= 0) return row;

    const qty = recommendationForTargetWeeks(row, targetWeeks);
    const fob = asNumber(row.fob);
    const trucking = asNumber(row.trucking_cost_per_bottle);
    const orderCost = qty * fob;
    const landedCost = qty * (fob + trucking);

    return {
      ...row,
      recommended_qty_rounded: qty,
      order_cost: orderCost,
      landed_cost: landedCost
    };
  });
}

export function applyVinosmithAvailability(
  rows: Recommendation[],
  availabilityByProductCode: ReadonlyMap<string, number>
): Recommendation[] {
  return rows.map((row) => {
    const productCode = row.product_code?.trim().toUpperCase();
    if (!productCode) return row;

    const trueAvailable = availabilityByProductCode.get(productCode) ?? 0;
    const weeklyVelocity = asNumber(row.weekly_velocity);
    const onOrder = asNumber(row.on_order);
    return {
      ...row,
      true_available: trueAvailable,
      weeks_on_hand: weeklyVelocity > 0 ? roundNumber(trueAvailable / weeklyVelocity, 2) : null,
      weeks_on_hand_with_on_order: weeklyVelocity > 0 ? roundNumber((trueAvailable + onOrder) / weeklyVelocity, 2) : null
    };
  });
}

function roundNumber(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function applySupplierTdmAssignments(rows: Recommendation[], suppliers: SupplierLogistics[]): Recommendation[] {
  const tdmBySupplier = new Map(
    suppliers.map((supplier) => [
      supplier.name.trim().toLowerCase(),
      supplier.tdm?.trim() || null
    ])
  );

  if (tdmBySupplier.size === 0) return rows;

  return rows.map((row) => {
    const supplierKey = (row.supplier_name?.trim() || "Unknown Supplier").toLowerCase();
    if (!tdmBySupplier.has(supplierKey)) return row;
    return {
      ...row,
      brand_manager: tdmBySupplier.get(supplierKey) || null
    };
  });
}

export function isApproved(row: Recommendation): boolean {
  return row.recommendation_status === "approved" || row.recommendation_status === "edited";
}

export function displayWineName(row: Recommendation): string {
  return row.product_name || row.planning_sku || "Unnamed wine";
}

export function rowReplenishmentPolicy(row: Recommendation): ReplenishmentPolicy {
  if (row.replenishment_policy) return replenishmentPolicy(row.replenishment_policy);
  return row.is_core || row.is_btg ? "Core" : "Limited";
}

export function formatVelocityTrend(
  row: Pick<Recommendation, "velocity_trend_pct" | "velocity_trend_label">
) {
  if (row.velocity_trend_pct === null || row.velocity_trend_pct === undefined || row.velocity_trend_pct === "") {
    return row.velocity_trend_label || "—";
  }
  const value = Number(row.velocity_trend_pct);
  if (!Number.isFinite(value)) return row.velocity_trend_label || "—";
  return `${value > 0 ? "+" : ""}${formatDecimal(value, 0)}%`;
}

export function isManualCatalogRow(row: Pick<Recommendation, "supplier_catalog_wine_id">): boolean {
  return Boolean(row.supplier_catalog_wine_id);
}

export function hasQuickBooksItemNumber(wine: Pick<SupplierCatalogWine, "quickbooks_item_number">): boolean {
  return Boolean(wine.quickbooks_item_number?.trim());
}

export function manualCatalogNewItemWarning(wine: Pick<SupplierCatalogWine, "quickbooks_item_number">): string | null {
  return hasQuickBooksItemNumber(wine) ? null : "New Item: QuickBooks Item Number required before final entry.";
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

export function activeFreeGoodsForRow(row: Pick<Recommendation, "free_goods">, dateKey = todayDateKey()): SupplierCatalogFreeGood[] {
  return (row.free_goods || []).filter((program) => {
    if (program.active === false) return false;
    if (program.starts_on && program.starts_on > dateKey) return false;
    if (program.ends_on && program.ends_on < dateKey) return false;
    return true;
  });
}

export function freeGoodProgramLabel(program: SupplierCatalogFreeGood): string {
  const name = program.program_name?.trim();
  const unit = program.unit === "case" ? "case" : "bottle";
  const buyQty = asNumber(program.buy_quantity);
  const freeQty = asNumber(program.free_quantity);
  const terms = buyQty > 0 || freeQty > 0
    ? `Buy ${formatDecimal(buyQty, buyQty % 1 === 0 ? 0 : 1)} get ${formatDecimal(freeQty, freeQty % 1 === 0 ? 0 : 1)} ${unit}${freeQty === 1 ? "" : "s"}`
    : "Free goods program";

  return name ? `${name}: ${terms}` : terms;
}

export function freeGoodsSummary(programs: SupplierCatalogFreeGood[]): string {
  if (programs.length === 0) return "";
  return programs.map(freeGoodProgramLabel).join("; ");
}

function workbenchItemForRun(wine: SupplierCatalogWine, reportRunId: string): SupplierCatalogWorkbenchItem | null {
  return (
    wine.workbench_items?.find((item) => item.report_run_id === reportRunId && item.active !== false) || null
  );
}

export function supplierCatalogWineToRecommendation(wine: SupplierCatalogWine, reportRunId: string): Recommendation {
  const workbenchItem = workbenchItemForRun(wine, reportRunId);
  const warning = manualCatalogNewItemWarning(wine);
  const recommendedQty = Math.max(0, Math.round(asNumber(workbenchItem?.recommended_qty) || asNumber(wine.pack_size) || 1));
  const approvedQty = Math.max(0, Math.round(asNumber(workbenchItem?.approved_qty)));
  const fob = asNumber(wine.fob_bottle);
  const trucking = asNumber(wine.laid_in_per_bottle);
  const orderCost = fob * recommendedQty;
  const landedCost = (fob + trucking) * recommendedQty;
  const catalogPolicy = replenishmentPolicy(
    wine.system_tags?.find((tag) => ["Core", "Limited Core", "Limited", "Allocated", "Special Order"].includes(tag)) ||
    (wine.system_tags?.includes("BTG") ? "Core" : "Limited")
  );

  return {
    id: workbenchItem?.id || `manual-catalog:${wine.id}`,
    report_run_id: reportRunId,
    supplier_catalog_wine_id: wine.id,
    supplier_catalog_workbench_item_id: workbenchItem?.id || null,
    planning_sku: wine.planning_sku,
    product_name: wine.display_name,
    product_code: wine.quickbooks_item_number || null,
    supplier_name: wine.supplier_name,
    brand_manager: null,
    is_btg: false,
    is_core: catalogPolicy === "Core",
    replenishment_policy: catalogPolicy,
    recommendations_suppressed: false,
    last_30_day_sales: 0,
    last_60_day_sales: 0,
    last_90_day_sales: 0,
    last_365_day_sales: 0,
    last_12_month_sales: 0,
    next_30_day_forecast: 0,
    next_60_day_forecast: 0,
    next_90_day_forecast: 0,
    weekly_velocity: 0,
    velocity_trend_pct: 0,
    velocity_trend_label: "Manual",
    weeks_on_hand_with_on_order: 0,
    weeks_on_hand: 0,
    true_available: 0,
    on_order: 0,
    recommended_qty_rounded: recommendedQty,
    approved_qty: approvedQty,
    recommendation_status: workbenchItem?.recommendation_status || "rejected",
    reorder_status: "LOW",
    risk_level: warning ? "Medium" : "Low",
    pickup_location: null,
    order_cost: orderCost,
    fob,
    pack_size: wine.pack_size,
    trucking_cost_per_bottle: trucking,
    landed_cost: landedCost,
    order_path: workbenchItem?.order_path || "stateside",
    is_new_item: Boolean(warning),
    new_item_warning: warning,
    free_goods: wine.free_goods || []
  };
}

export function replaceSupplierCatalogWineInWorkbench(
  rows: Recommendation[],
  wine: SupplierCatalogWine,
  reportRunId: string
): Recommendation[] {
  const catalogRow = supplierCatalogWineToRecommendation(wine, reportRunId);

  return rows.map((row) => {
    if (row.supplier_catalog_wine_id !== wine.id) return row;

    const recommendedQty = Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)));
    const fob = asNumber(catalogRow.fob);
    const trucking = asNumber(catalogRow.trucking_cost_per_bottle);

    return {
      ...catalogRow,
      id: row.id,
      report_run_id: row.report_run_id,
      supplier_catalog_workbench_item_id: row.supplier_catalog_workbench_item_id,
      recommended_qty_rounded: row.recommended_qty_rounded,
      approved_qty: row.approved_qty,
      recommendation_status: row.recommendation_status,
      order_path: row.order_path,
      order_cost: fob * recommendedQty,
      landed_cost: (fob + trucking) * recommendedQty
    };
  });
}

export function removeSupplierCatalogWineFromWorkbench(
  rows: Recommendation[],
  supplierCatalogWineId: string
): Recommendation[] {
  return rows.filter((row) => row.supplier_catalog_wine_id !== supplierCatalogWineId);
}

export function mergeSupplierCatalogRows(recommendations: Recommendation[], catalogWines: SupplierCatalogWine[], reportRunId: string): Recommendation[] {
  const manualRows = catalogWines
    .filter((wine) =>
      wine.product_lifecycle_status !== "inactive" || Boolean(workbenchItemForRun(wine, reportRunId))
    )
    .filter((wine) => !recommendations.some((row) => recommendationMatchesCatalogWine(row, wine)))
    .map((wine) => supplierCatalogWineToRecommendation(wine, reportRunId));

  return [...recommendations, ...manualRows];
}

export function recommendationMatchesCatalogWine(
  row: Recommendation,
  wine: SupplierCatalogWine
): boolean {
  if (row.supplier_catalog_wine_id && row.supplier_catalog_wine_id === wine.id) return true;

  const rowSupplier = normalizeIdentityText(row.supplier_name);
  const wineSupplier = normalizeIdentityText(wine.supplier_name);
  if (!rowSupplier || !wineSupplier || rowSupplier !== wineSupplier) return false;

  const rowItemNumber = normalizeIdentityText(row.product_code);
  const wineItemNumber = normalizeIdentityText(wine.quickbooks_item_number);
  if (rowItemNumber && wineItemNumber && rowItemNumber === wineItemNumber) return true;

  const rowSku = normalizeIdentityText(row.planning_sku);
  const wineSku = normalizeIdentityText(wine.planning_sku);
  if (rowSku && wineSku && rowSku === wineSku) return true;

  const rowName = normalizeIdentityText(row.product_name);
  const matchingCatalogName = [wine.display_name, wine.quickbooks_item_name]
    .find((name) => normalizeIdentityText(name) === rowName);
  if (!rowName || !matchingCatalogName) return false;

  const rowEmbeddedPack = packSizeFromDisplayName(row.product_name);
  const wineEmbeddedPack = packSizeFromDisplayName(matchingCatalogName);
  if (rowEmbeddedPack && wineEmbeddedPack) return rowEmbeddedPack === wineEmbeddedPack;

  const rowPack = Math.round(asNumber(row.pack_size));
  const winePack = Math.round(asNumber(wine.pack_size));
  return rowPack <= 0 || winePack <= 0 || rowPack === winePack;
}

function packSizeFromDisplayName(value: string | null | undefined): number | null {
  const match = (value || "").match(/(?:^|\D)(\d{1,3})\s*\/\s*\d+(?:\.\d+)?\s*(?:ml|l)\b/i);
  if (!match) return null;
  const packSize = Number(match[1]);
  return Number.isInteger(packSize) && packSize > 0 && packSize <= 120 ? packSize : null;
}

function normalizeIdentityText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function enrichRecommendationsWithSupplierCatalogPrograms(rows: Recommendation[], catalogWines: SupplierCatalogWine[]): Recommendation[] {
  const byId = new Map<string, SupplierCatalogWine>();
  const bySku = new Map<string, SupplierCatalogWine>();
  const byItemNumber = new Map<string, SupplierCatalogWine>();

  catalogWines.forEach((wine) => {
    byId.set(wine.id, wine);
    if (wine.planning_sku) bySku.set(wine.planning_sku, wine);
    if (wine.quickbooks_item_number?.trim()) byItemNumber.set(wine.quickbooks_item_number.trim(), wine);
  });

  return rows.map((row) => {
    const catalogWine =
      (row.supplier_catalog_wine_id ? byId.get(row.supplier_catalog_wine_id) : null) ||
      (row.planning_sku ? bySku.get(row.planning_sku) : null) ||
      (row.product_code ? byItemNumber.get(row.product_code) : null);

    if (!catalogWine?.free_goods?.length) return row;

    return {
      ...row,
      supplier_catalog_wine_id: row.supplier_catalog_wine_id || catalogWine.id,
      free_goods: catalogWine.free_goods
    };
  });
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim() || "").filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function fuzzyTokenMatches(searchToken: string, candidateToken: string): boolean {
  if (!searchToken || !candidateToken) return false;
  if (candidateToken.includes(searchToken) || searchToken.includes(candidateToken)) return true;
  if (searchToken.length <= 2) return false;

  const maxDistance = searchToken.length <= 4 ? 1 : searchToken.length <= 7 ? 2 : 3;
  return levenshteinDistance(searchToken, candidateToken) <= maxDistance;
}

function fuzzyTextMatches(search: string, values: Array<string | null | undefined>): boolean {
  const searchText = normalizeSearchText(search);
  if (!searchText) return true;

  const haystackText = normalizeSearchText(values.filter(Boolean).join(" "));
  if (!haystackText) return false;
  if (haystackText.includes(searchText)) return true;

  const searchTokens = searchText.split(/\s+/).filter(Boolean);
  const haystackTokens = haystackText.split(/\s+/).filter(Boolean);

  return searchTokens.every((searchToken) =>
    haystackTokens.some((candidateToken) => fuzzyTokenMatches(searchToken, candidateToken))
  );
}

export function filterRecommendations(
  rows: Recommendation[],
  filters: {
    supplier: string;
    brandManager: string;
    search: string;
    suggestedOnly: boolean;
    replenishmentPolicy?: "All" | ReplenishmentPolicy;
  }
): Recommendation[] {
  const search = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.supplier !== "All" && (row.supplier_name?.trim() || "Unknown Supplier") !== filters.supplier) {
      return false;
    }
    if (filters.brandManager !== "All" && (row.brand_manager?.trim() || "") !== filters.brandManager) {
      return false;
    }
    if (filters.replenishmentPolicy && filters.replenishmentPolicy !== "All" && rowReplenishmentPolicy(row) !== filters.replenishmentPolicy) {
      return false;
    }
    if (filters.suggestedOnly && asNumber(row.recommended_qty_rounded) <= 0) {
      return false;
    }
    if (!search) return true;

    return fuzzyTextMatches(search, [
      row.product_name,
      row.planning_sku,
      row.product_code,
      row.supplier_name,
      row.brand_manager
    ]);
  });
}

export function buildMetrics(rows: Recommendation[]): DashboardMetrics {
  const suppliers = new Set<string>();
  let urgent = 0;
  let low = 0;
  let recommendedBottles = 0;
  let approvedBottles = 0;
  let poValue = 0;

  rows.forEach((row) => {
    const supplier = row.supplier_name?.trim();
    const recommended = asNumber(row.recommended_qty_rounded);
    if (supplier && recommended > 0) suppliers.add(supplier);
    if (row.risk_level === "High" || row.reorder_status === "URGENT") urgent += 1;
    if (row.risk_level === "Medium" || row.reorder_status === "LOW") low += 1;
    recommendedBottles += recommended;
    if (isApproved(row)) {
      const approved = rowRecommendedQty(row);
      approvedBottles += approved;
      poValue += rowApprovedEstimate(row);
    }
  });

  return {
    urgent,
    low,
    recommendedBottles,
    approvedBottles,
    poValue,
    supplierCount: suppliers.size
  };
}

export function buildSupplierGroups(rows: Recommendation[]): SupplierGroup[] {
  const grouped = new Map<string, Recommendation[]>();
  rows.forEach((row) => {
    const supplier = row.supplier_name?.trim() || "Unknown Supplier";
    const group = grouped.get(supplier) || [];
    group.push(row);
    grouped.set(supplier, group);
  });

  return Array.from(grouped.entries())
    .map(([supplier, groupRows]) => {
      const sorted = [...groupRows].sort((a, b) => {
        const nameCompare = (a.product_name || "").localeCompare(b.product_name || "");
        return nameCompare || asNumber(b.recommended_qty_rounded) - asNumber(a.recommended_qty_rounded);
      });
      const recommendedBottles = sorted.reduce((sum, row) => sum + asNumber(row.recommended_qty_rounded), 0);
      const approvedRows = sorted.filter(isApproved);
      const approvedBottles = approvedRows.reduce((sum, row) => sum + rowRecommendedQty(row), 0);
      const suggestedValue = sorted.reduce((sum, row) => sum + rowSuggestedValue(row), 0);
      const approvedValue = approvedRows.reduce((sum, row) => sum + rowApprovedEstimate(row), 0);
      const freeGoodProgramCount = sorted.reduce((sum, row) => sum + activeFreeGoodsForRow(row).length, 0);
      return {
        supplier,
        rows: sorted,
        skuCount: sorted.length,
        urgentCount: sorted.filter((row) => row.risk_level === "High" || row.reorder_status === "URGENT").length,
        freeGoodProgramCount,
        recommendedBottles,
        approvedBottles,
        suggestedValue,
        approvedValue
      };
    })
    .sort((a, b) => b.suggestedValue - a.suggestedValue || a.supplier.localeCompare(b.supplier));
}

export function sortSupplierGroups(groups: SupplierGroup[], sortMode: SupplierGroupSortMode): SupplierGroup[] {
  const sorted = [...groups];

  if (sortMode === "az") {
    return sorted.sort((a, b) => a.supplier.localeCompare(b.supplier));
  }
  if (sortMode === "za") {
    return sorted.sort((a, b) => b.supplier.localeCompare(a.supplier));
  }

  if (sortMode === "value") {
    return sorted.sort((a, b) =>
      b.suggestedValue - a.suggestedValue ||
      b.recommendedBottles - a.recommendedBottles ||
      a.supplier.localeCompare(b.supplier)
    );
  }

  return sorted.sort((a, b) =>
    b.recommendedBottles - a.recommendedBottles ||
    b.suggestedValue - a.suggestedValue ||
    a.supplier.localeCompare(b.supplier)
  );
}
