import { beforeEach, expect, it, vi } from 'vitest';
import { fetchCompanyDashboardData } from './company-dashboard-data';
import { completedReadModel, readSourceVersion } from './read-model-jobs';
import { fetchQuickBooksSalesDashboardData } from './supabase/quickbooks-sales-dashboard';
vi.mock('./read-model-jobs',()=>({completedReadModel:vi.fn(),readSourceVersion:vi.fn(),CalculationPending:class extends Error{}}));
vi.mock('./supabase/quickbooks-sales-dashboard',()=>({fetchQuickBooksSalesDashboardData:vi.fn()}));
const row=(label:string)=>({key:label,label,invoiceSales:100,creditMemos:0,netSales:100,invoiceCount:1,creditMemoCount:0,creditMemoRate:0});
const summary={grossSales:100,credits:0,netSales:100,invoiceCount:1,creditMemoCount:0,averageInvoice:100,sampleCost:0,grossProfit:30,grossProfitPercent:30,grossProfitUnavailableReason:null};
const company={summary,byRepRows:[row('Rep A')],byAccountRows:[row('Account A')],businessLineSummaries:[],unavailableReason:null};
const query={select:()=>query,gte:()=>query,lte:()=>query,order:()=>query,limit:()=>query,maybeSingle:async()=>({data:{txn_date:'2026-09-26'},error:null})};
const db={from:()=>query} as never;
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(readSourceVersion).mockResolvedValue(1);
  vi.mocked(completedReadModel).mockResolvedValue({calculatedAt:'2026-09-26T20:00:00Z',periodState:'provisional',scopes:{all:{company,reps:{'Rep A':company}}}});
  vi.mocked(fetchQuickBooksSalesDashboardData).mockResolvedValue({invoiceSales:100,creditMemos:0,netSales:100,invoiceCount:1,creditMemoCount:0,byRep:[row('Rep A')],byAccount:[row('Account A')]} as never);
});
it.each([{rep:true,account:false},{rep:false,account:true},{rep:false,account:false},{rep:true,account:true}])('returns only requested breakdowns %j with unchanged totals and comparisons',async(flags)=>{
  for(const includeGrossProfit of [true,false]){
    const result=await fetchCompanyDashboardData(db,'mtd',{dateFrom:'2026-09-01',dateTo:'2026-09-26',includeGrossProfit,includeRepBreakdown:flags.rep,includeAccountBreakdown:flags.account});
    expect(result.byRep).toHaveLength(flags.rep?1:0);
    expect(result.byAccount).toHaveLength(flags.account?1:0);
    expect(result.repBreakdownLoaded).toBe(flags.rep);
    expect(result.accountBreakdownLoaded).toBe(flags.account);
    expect(result.breakdownsLoaded).toBe(flags.rep&&flags.account);
    expect(result.summary.netSales).toBe(100);
    expect(result.comparison?.summary.netSales).toBe(100);
    for(const row of [...result.byRep,...result.byAccount])expect(row.lastYearNetSales).toBe(100);
  }
});
it('supports account-only rep drilldowns and legacy callers',async()=>{
  const scoped=await fetchCompanyDashboardData(db,'mtd',{rep:'Rep A',includeRepBreakdown:false,includeAccountBreakdown:true});
  expect(scoped.selectedRep).toBe('Rep A');expect(scoped.byRep).toEqual([]);expect(scoped.byAccount).toHaveLength(1);
  const legacy=await fetchCompanyDashboardData(db);expect(legacy.breakdownsLoaded).toBe(true);
  const summaryOnly=await fetchCompanyDashboardData(db,'mtd',{includeBreakdowns:false});expect(summaryOnly.byRep).toEqual([]);expect(summaryOnly.byAccount).toEqual([]);
});
