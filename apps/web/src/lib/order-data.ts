import type { DashboardMetrics, Recommendation, SupplierCatalogWine, SupplierCatalogWorkbenchItem, SupplierGroup } from "./types";

export type SupplierGroupSortMode = "default" | "az" | "za";

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
    maximumFractionDigits: 0
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

export function applySupplierTargetWeeks(
  rows: Recommendation[],
  supplierTargetWeeks: Record<string, number>
): Recommendation[] {
  if (Object.keys(supplierTargetWeeks).length === 0) return rows;

  return rows.map((row) => {
    const supplier = row.supplier_name?.trim() || "Unknown Supplier";
    const targetWeeks = supplierTargetWeeks[supplier];
    if (!targetWeeks || targetWeeks <= 0 || row.order_path === "di") return row;

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

export function isApproved(row: Recommendation): boolean {
  return row.recommendation_status === "approved" || row.recommendation_status === "edited";
}

export function displayWineName(row: Recommendation): string {
  const flags = [row.is_core ? "⭐" : "", row.is_btg ? "🍷" : ""].filter(Boolean);
  const suffix = flags.length ? ` ${flags.join(" ")}` : "";
  return `${row.product_name || row.planning_sku || "Unnamed wine"}${suffix}`;
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
    is_btg: Boolean(wine.system_tags?.includes("BTG")),
    is_core: Boolean(wine.system_tags?.includes("Core")),
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
    new_item_warning: warning
  };
}

export function mergeSupplierCatalogRows(recommendations: Recommendation[], catalogWines: SupplierCatalogWine[], reportRunId: string): Recommendation[] {
  const recommendationSkus = new Set(recommendations.map((row) => row.planning_sku).filter(Boolean));
  const manualRows = catalogWines
    .filter((wine) => wine.product_lifecycle_status !== "inactive")
    .filter((wine) => !recommendationSkus.has(wine.planning_sku))
    .map((wine) => supplierCatalogWineToRecommendation(wine, reportRunId));

  return [...recommendations, ...manualRows];
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
      return {
        supplier,
        rows: sorted,
        skuCount: sorted.length,
        urgentCount: sorted.filter((row) => row.risk_level === "High" || row.reorder_status === "URGENT").length,
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

  return sorted.sort((a, b) => b.suggestedValue - a.suggestedValue || a.supplier.localeCompare(b.supplier));
}
