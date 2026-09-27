import type { DashboardMetrics, Recommendation, SupplierGroup } from './types';
import { activeFreeGoodsForRow, asNumber, fuzzyTextMatches, rowApprovedEstimate, rowOutstandingApprovedQty, rowSuggestedValue, uniqueSorted } from './order-data';

export type OrderingSummaryFilters = { supplier: string; brandManager: string; search: string; suggestedOnly: boolean };
export const defaultOrderingFilters: OrderingSummaryFilters = { supplier: 'All', brandManager: 'All', search: '', suggestedOnly: false };
export type OrderingSearchRow = {
  supplier: string; hasSupplier: boolean; tdm: string; text: string[]; urgent: number; low: number;
  recommended: number; approved: number; suggestedValue: number; approvedValue: number; freeGoods: number;
};
export function buildOrderingSearchIndex(rows: Recommendation[]): OrderingSearchRow[] {
  return rows.map((row) => {
    const approved = rowOutstandingApprovedQty(row);
    return { supplier: row.supplier_name?.trim() || 'Unknown Supplier', hasSupplier: Boolean(row.supplier_name?.trim()), tdm: row.brand_manager?.trim() || '',
      text: [row.product_name || '', row.planning_sku || '', row.product_code || '', row.supplier_name || '', row.brand_manager || ''],
      urgent: Number(row.risk_level === 'High' || row.reorder_status === 'URGENT'),
      low: Number(row.risk_level === 'Medium' || row.reorder_status === 'LOW'),
      recommended: asNumber(row.recommended_qty_rounded), approved,
      suggestedValue: rowSuggestedValue(row), approvedValue: approved !== 0 ? rowApprovedEstimate(row) : 0,
      freeGoods: activeFreeGoodsForRow(row).length };
  });
}
export function filterOrderingSummary(index: OrderingSearchRow[], filters: OrderingSummaryFilters) {
  const groups = new Map<string, Omit<SupplierGroup, 'rows'>>();
  const metrics: DashboardMetrics = { urgent: 0, low: 0, recommendedBottles: 0, approvedBottles: 0, poValue: 0, supplierCount: 0 };
  const suggestedSuppliers = new Set<string>();
  for (const row of index) {
    if (filters.supplier !== 'All' && row.supplier !== filters.supplier) continue;
    if (filters.brandManager !== 'All' && row.tdm !== filters.brandManager) continue;
    if (filters.suggestedOnly && row.recommended <= 0) continue;
    if (!fuzzyTextMatches(filters.search, row.text)) continue;
    const group = groups.get(row.supplier) || { supplier: row.supplier, skuCount: 0, urgentCount: 0, freeGoodProgramCount: 0, recommendedBottles: 0, approvedBottles: 0, suggestedValue: 0, approvedValue: 0 };
    group.skuCount++; group.urgentCount += row.urgent; group.freeGoodProgramCount += row.freeGoods;
    group.recommendedBottles += row.recommended; group.approvedBottles += row.approved;
    group.suggestedValue += row.suggestedValue; group.approvedValue += row.approvedValue;
    groups.set(row.supplier, group);
    metrics.urgent += row.urgent; metrics.low += row.low; metrics.recommendedBottles += row.recommended;
    metrics.approvedBottles += row.approved; metrics.poValue += row.approvedValue;
    if (row.recommended > 0 && row.hasSupplier) suggestedSuppliers.add(row.supplier);
  }
  metrics.supplierCount = suggestedSuppliers.size;
  return { groups: [...groups.values()].sort((a,b) => b.suggestedValue-a.suggestedValue || a.supplier.localeCompare(b.supplier)), metrics,
    filterOptions: { suppliers: uniqueSorted(index.map((r)=>r.supplier)), tdms: uniqueSorted(index.map((r)=>r.tdm)) } };
}
// Keep the search index in the server snapshot, never in an overview response.
export function orderingSummaryResponse<T extends { searchIndex?: OrderingSearchRow[] }>(result: T, filters: OrderingSummaryFilters) {
  const { searchIndex, ...summary } = result;
  return { ...summary, ...filterOrderingSummary(searchIndex || [], filters), filters };
}
