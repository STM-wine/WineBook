// Reclassify only explicit non-wine adjustments. Never recalculate frozen wine costs.
// Default is read-only; --apply writes a timestamped backup before any changes.
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvironment, ROOT } from './read-model-runtime.mjs';
await loadEnvironment();
const db = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const apply = process.argv.includes('--apply');
const names = ['Warehouse Storage Rent', 'Customer Deposit', 'CREDIT MEMO'];
const round = n => Math.round(n * 100) / 100;
const label = (s, fallback) => String(s || '').trim() || fallback;
const repName = r => r?.ResolvedFullName || r?.SalesRepEntityFullName || r?.resolvedFullName || r?.FullName || r?.fullName || r?.Name || r?.name;
const groups = new Map();
const key = (date, business, scope, scopeKey, parent = '') => JSON.stringify([date, business, scope, scopeKey, parent]);
async function all(query) { const result = []; for(let start=0;;start+=1000) { const r=await query().range(start,start+999); if(r.error)throw r.error;result.push(...r.data);if(r.data.length<1000)return result; } }
for(const kind of ['invoice','credit_memo']) {
  const table = kind === 'invoice' ? 'quickbooks_invoices' : 'quickbooks_credit_memos';
  const headerFields = kind === 'invoice' ? 'sales_rep_ref' : 'raw_data';
  console.log(`Reading ${kind} non-wine adjustments`);
  const lines = await all(() => db.from(kind === 'invoice' ? 'quickbooks_invoice_lines' : 'quickbooks_credit_memo_lines')
    .select(`id,amount,item_full_name,${table}!inner(txn_date,customer_full_name,${headerFields})`)
    .in('item_full_name', names).gte(`${table}.txn_date`, '2025-01-01'));
  for(const line of lines) {
    const header=line[table]; const date=header.txn_date;
    const rep=label(repName(kind === 'invoice' ? header.sales_rep_ref : header.raw_data?.sales_rep_ref), 'Unassigned Rep').toLowerCase();
    const account=label(header.customer_full_name,'Unknown Account').toLowerCase();
    const amount=(kind==='invoice'?1:-1)*Math.abs(Number(line.amount||0));
    if(!amount)continue;
    for(const business of ['all','stem']) for(const [scope,scopeKey,parent] of [['company','all',''],['rep',rep,''],['account',account,''],['rep_account',account,rep]]) {
      const k=key(date,business,scope,scopeKey,parent);
      const g=groups.get(k)||{lines:0,grossSales:0,grossProfit:0,invoice:0,credit:0,invoiceLines:0,creditLines:0};
      g.lines++;g.grossSales=round(g.grossSales+amount);g[kind==='invoice'?'invoice':'credit']=round(g[kind==='invoice'?'invoice':'credit']+amount);g[kind==='invoice'?'invoiceLines':'creditLines']++;groups.set(k,g);
    }
  }
}
console.log(`Validated ${groups.size} source groups`);
const dates=[...new Set([...groups.keys()].map(k=>JSON.parse(k)[0]))];
const changes=[];
for(let i=0;i<dates.length;i+=5) {
 const rows=await all(()=>db.from('gross_profit_daily_rollups').select('*').in('period_date',dates.slice(i,i+5)).in('business_line',['all','stem']).eq('formula_version','gross-profit-center-v1-current-item-cost-billback').order('period_date').order('business_line').order('scope_type').order('scope_key').order('parent_scope_type').order('parent_scope_key'));
 for(const row of rows) {
  const g=groups.get(key(row.period_date,row.business_line,row.scope_type,row.scope_key,row.parent_scope_key));if(!g)continue;
  if(row.confidence_buckets?.non_wine_adjustment)continue;
  // Historical proof: these entries had no cost/GP; reject rather than guess if the evidence differs.
  const missing=row.cost_sources?.missing_current_item_cost;
  if(!missing || missing.lines<g.lines || Math.abs(missing.grossProfit||0)>.02)throw new Error(`Historical cost provenance mismatch: ${JSON.stringify({id:row.id,date:row.period_date,scope:row.scope_type,business:row.business_line,missing,expected:g})}`);
  const buckets=structuredClone(row.confidence_buckets);
  for(const [bucket,amount,count] of [['missing_vinosmith_line',g.invoice,g.invoiceLines],['credit_workflow_missing_vinosmith_line',g.credit,g.creditLines]]) {
    if(!count)continue;
    if(!buckets[bucket]||buckets[bucket].lines<count)throw new Error(`Historical classification mismatch: ${row.id}`);
    buckets[bucket].lines-=count;buckets[bucket].grossSales=round(buckets[bucket].grossSales-amount);
    if(!buckets[bucket].lines && Math.abs(buckets[bucket].grossSales)<.02 && Math.abs(buckets[bucket].grossProfit)<.02)delete buckets[bucket];
  }
  buckets.non_wine_adjustment={lines:g.lines,grossSales:g.grossSales,grossProfit:0};
  const denominator=Number(row.net_sales)-g.grossSales;
  changes.push({before:row,patch:{confidence_buckets:buckets,gross_profit_percent:denominator===0?null:Number(row.gross_profit)/denominator}});
 }
}
const directory=resolve(ROOT,'tmp',`wine-gp-exclusions-${new Date().toISOString().replaceAll(':','-')}`);
await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'changes.json'),JSON.stringify(changes));
console.log(JSON.stringify({apply,rows:changes.length,backup:directory,companyByYear:changes.filter(c=>c.before.business_line==='all'&&c.before.scope_type==='company').reduce((a,c)=>{const y=c.before.period_date.slice(0,4);a[y]=round((a[y]||0)+c.patch.confidence_buckets.non_wine_adjustment.grossSales);return a;},{})}));
if(apply) for(const change of changes) {
 const r=await db.from('gross_profit_daily_rollups').update(change.patch).eq('id',change.before.id).eq('calculated_at',change.before.calculated_at).select('id');
 if(r.error)throw r.error;if(r.data.length!==1)throw new Error('Historical rollup changed during repair; stopped.');
}
