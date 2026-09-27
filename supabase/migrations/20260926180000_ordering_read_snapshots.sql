alter table public.read_model_versions drop constraint read_model_versions_kind_check;
alter table public.read_model_versions add constraint read_model_versions_kind_check check(kind in ('products','margins','ordering'));
insert into public.read_model_versions(kind) values('ordering');
create table public.ordering_workspace_suppliers (
  snapshot_id uuid not null references public.read_model_jobs(id) on delete cascade,
  supplier text not null,
  data jsonb not null,
  primary key(snapshot_id, supplier)
);
alter table public.ordering_workspace_suppliers enable row level security;
revoke all on public.ordering_workspace_suppliers from public, anon, authenticated;
grant select, insert, update, delete on public.ordering_workspace_suppliers to service_role;
do $$ declare t text; begin
 foreach t in array array['quickbooks_items','quickbooks_invoices','quickbooks_invoice_lines','quickbooks_credit_memos','quickbooks_credit_memo_lines',
  'quickbooks_purchase_orders','quickbooks_purchase_order_lines','source_sync_runs','vinosmith_wines','suppliers','quickbooks_vendor_mappings',
  'ordering_item_markers','supplier_catalog_wines','supplier_catalog_price_levels','supplier_catalog_free_goods','supplier_catalog_workbench_items',
  'reorder_recommendations','approval_commitments','report_runs','configuration_versions'] loop
  if to_regclass('public.' || t) is not null then
    execute format('create trigger ordering_read_invalidate after insert or update or delete or truncate on public.%I for each statement execute function public.invalidate_read_models(''ordering'')',t);
  end if;
 end loop;
end $$;
-- Lease/epoch validation and the supplier inserts are one transaction with publication.
create function public.publish_ordering_read_model(p_id uuid, p_token uuid, p_result jsonb, p_suppliers jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
 if not exists(select 1 from public.read_model_jobs where id=p_id and kind='ordering') then raise exception 'Ordering job required'; end if;
 if not public.publish_read_model(p_id,p_token,p_result,null) then return false; end if;
 insert into public.ordering_workspace_suppliers(snapshot_id,supplier,data)
 select p_id, s->>'supplier', s->'data' from jsonb_array_elements(p_suppliers) s;
 return true;
end $$;
revoke all on function public.publish_ordering_read_model(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.publish_ordering_read_model(uuid,uuid,jsonb,jsonb) to service_role;
