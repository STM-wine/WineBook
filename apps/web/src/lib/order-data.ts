import type { DashboardMetrics, Recommendation, SupplierGroup } from "./types";

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

export function isApproved(row: Recommendation): boolean {
  return row.recommendation_status === "approved" || row.recommendation_status === "edited";
}

export function displayWineName(row: Recommendation): string {
  const flags = [row.is_core ? "⭐" : "", row.is_btg ? "🍷" : ""].filter(Boolean);
  const suffix = flags.length ? ` ${flags.join(" ")}` : "";
  return `${row.product_name || row.planning_sku || "Unnamed wine"}${suffix}`;
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim() || "").filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
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

    const haystack = [
      row.product_name,
      row.planning_sku,
      row.product_code,
      row.supplier_name,
      row.brand_manager
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
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
