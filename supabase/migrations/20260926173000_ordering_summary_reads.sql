-- Read-only aggregates; mutations still use the existing versioned transactional RPCs.
create view public.purchase_order_draft_summaries as
select d.id, d.report_run_id, d.ordering_source, d.supplier_name, d.order_path,
  d.status, d.po_number, d.notes, d.revision_no, d.content_hash, d.last_exported_at,
  d.last_exported_by, d.created_by, d.reviewed_by, d.created_at, d.updated_at,
  jsonb_build_object('lineCount', a.line_count, 'approvedQty', a.qty,
    'wineCost', a.wine_cost, 'laidInCost', a.laid_in_cost, 'estimatedCost', a.wine_cost + a.laid_in_cost) as summary,
  a.search_text
from public.purchase_order_drafts d
left join lateral (select trucking_cost_per_bottle from public.suppliers s
  where lower(trim(s.name)) = lower(trim(d.supplier_name)) order by s.name desc, s.id desc limit 1) s on true
cross join lateral (
  select count(*) as line_count, coalesce(sum(coalesce(l.approved_qty, 0)),0) as qty,
    coalesce(sum(coalesce(nullif(coalesce(nullif(l.wine_cost,0),l.line_cost),0),coalesce(l.fob,0)*coalesce(l.approved_qty,0))),0) as wine_cost,
    coalesce(sum(coalesce(nullif(l.laid_in_cost,0),coalesce(nullif(l.trucking_cost_per_bottle,0),s.trucking_cost_per_bottle,0)*coalesce(l.approved_qty,0))),0) as laid_in_cost,
    coalesce(string_agg(concat_ws(' ', l.product_name,l.product_code,l.planning_sku),' '),'') as search_text
  from public.purchase_order_lines l where l.purchase_order_draft_id = d.id
) a;
revoke all on public.purchase_order_draft_summaries from public, anon, authenticated;
grant select on public.purchase_order_draft_summaries to service_role;
