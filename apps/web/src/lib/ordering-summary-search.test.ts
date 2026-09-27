import { describe, expect, it } from 'vitest';
import type { Recommendation } from './types';
import { buildMetrics, buildSupplierGroups, filterRecommendations } from './order-data';
import { buildOrderingSearchIndex, defaultOrderingFilters, filterOrderingSummary, orderingSummaryResponse } from './ordering-summary-search';
const rows = [
  { product_name: 'Domaine Vacheron Sancerre Blanc', product_code: 'VC25001', planning_sku: 'vc-white', supplier_name: 'Supplier A', brand_manager: 'ROJO', recommended_qty_rounded: 12, approved_qty: 6, recommendation_status: 'approved', fob: 10, order_cost: 120, risk_level: 'High' },
  { product_name: 'Illahe Pinot Noir', product_code: 'IL2024', planning_sku: 'illahe-pinot', supplier_name: 'Supplier B', brand_manager: 'JANE', recommended_qty_rounded: 24, approved_qty: 0, recommendation_status: 'pending', fob: 20, order_cost: 480, reorder_status: 'LOW' },
  { product_name: 'Other Pinot', product_code: 'OP001', planning_sku: 'other', supplier_name: 'Supplier A', brand_manager: 'JANE', recommended_qty_rounded: 0, outstanding_approved_qty: -6, fob: 10, order_cost: 0 },
  { product_name: 'Unassigned wine', supplier_name: null, brand_manager: null, recommended_qty_rounded: 1, order_cost: 10 }
] as unknown as Recommendation[];
describe('global ordering summary search', () => {
  it.each([
    {}, {search:'Pinot'}, {search:'vacheronn'}, {search:'VC25001'}, {brandManager:'JANE'},
    {brandManager:'JANE',search:'Pinot'}, {supplier:'Supplier A',suggestedOnly:true}, {search:'doesnotexist'}
  ])('matches the existing row filters and totals for %j', (overrides) => {
    const filters = {...defaultOrderingFilters,...overrides};
    const matching = filterRecommendations(rows,filters);
    const result = filterOrderingSummary(buildOrderingSearchIndex(rows),filters);
    expect(result.metrics).toEqual(buildMetrics(matching));
    expect(result.groups).toEqual(buildSupplierGroups(matching).map(({rows,...group})=>group));
    expect(result.filterOptions.tdms).toEqual(['JANE','ROJO']);
  });
  it('searches a complete index beyond the first database page without returning row details', () => {
    const many = Array.from({length:1205},(_,i)=>({...rows[0],product_name:i === 1204 ? "ZygomorphicNebbioloExclusive" : `Wine ${i}`,product_code:`item-${i}`}));
    const result = orderingSummaryResponse({searchIndex:buildOrderingSearchIndex(many)}, {...defaultOrderingFilters,search:'ZygomorphicNebbioloExclusive'});
    expect(result.groups[0].skuCount).toBe(1);
    expect(result).not.toHaveProperty('searchIndex');
    expect(result.groups[0]).not.toHaveProperty('rows');
  });
});
