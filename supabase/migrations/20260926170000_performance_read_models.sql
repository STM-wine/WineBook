-- Expand-only: worker and web may be rolled out separately. No guarded ordering writes change.
create table public.read_model_versions (
  kind text primary key check (kind in ('products', 'margins')),
  version bigint not null default 1,
  changed_at timestamptz not null default now()
);
insert into public.read_model_versions(kind) values ('products'), ('margins');
create table public.read_model_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null references public.read_model_versions(kind),
  cache_key text not null,
  source_version bigint not null,
  business_date date not null,
  formula_version text not null,
  request jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','obsolete')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  error text,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (kind, cache_key, source_version, business_date, formula_version)
);
create index read_model_jobs_claim on public.read_model_jobs(status, created_at);
create table public.product_workspace_records (
  snapshot_id uuid not null references public.read_model_jobs(id) on delete cascade,
  id text not null,
  record jsonb not null,
  primary key(snapshot_id, id)
);
create index product_workspace_name on public.product_workspace_records(snapshot_id, lower(record->>'productName'), id);
create index product_workspace_code on public.product_workspace_records(snapshot_id, lower(record->>'itemCode'), id);
create index product_workspace_supplier on public.product_workspace_records(snapshot_id, (record->>'supplierName'));

alter table public.read_model_versions enable row level security;
alter table public.read_model_jobs enable row level security;
alter table public.product_workspace_records enable row level security;
revoke all on public.read_model_versions, public.read_model_jobs, public.product_workspace_records from public, anon, authenticated;
grant select, insert, update, delete on public.read_model_versions, public.read_model_jobs, public.product_workspace_records to service_role;

create function public.invalidate_read_models() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- One bump per source statement, including deletes. Failed transactions roll it back.
  update public.read_model_versions set version = version + 1, changed_at = clock_timestamp()
  where kind = any(TG_ARGV);
  return null;
end $$;

-- Source changes invalidate current and historical results: historical GP uses current item cost.
do $$
declare t text;
begin
  foreach t in array array['quickbooks_items','vinosmith_wines','vinosmith_prices','suppliers',
    'supplier_catalog_wines','supplier_catalog_price_levels','ordering_item_markers'] loop
    execute format('create trigger read_model_invalidate after insert or update or delete or truncate on public.%I for each statement execute function public.invalidate_read_models(''products'',''margins'')', t);
  end loop;
  foreach t in array array['quickbooks_invoices','quickbooks_invoice_lines','quickbooks_credit_memos',
    'quickbooks_credit_memo_lines','vinosmith_order_headers','vinosmith_order_lines','source_sync_runs'] loop
    execute format('create trigger read_model_invalidate after insert or update or delete or truncate on public.%I for each statement execute function public.invalidate_read_models(''margins'')', t);
  end loop;
end $$;

create function public.request_read_model(p_kind text, p_key text, p_formula text, p_request jsonb)
returns public.read_model_jobs language plpgsql security definer set search_path = public as $$
declare v bigint; j public.read_model_jobs;
begin
  select version into strict v from public.read_model_versions where kind = p_kind;
  insert into public.read_model_jobs(kind, cache_key, source_version, business_date, formula_version, request)
    values(p_kind, p_key, v, (now() at time zone 'America/Phoenix')::date, p_formula, p_request)
    on conflict (kind, cache_key, source_version, business_date, formula_version) do nothing;
  select * into strict j from public.read_model_jobs where kind = p_kind and cache_key = p_key
    and source_version = v and business_date = (now() at time zone 'America/Phoenix')::date and formula_version = p_formula;
  -- Back off retries after failure; requests deduplicate across all web/worker processes.
  if j.status = 'failed' and j.lease_until < now() then
    update public.read_model_jobs set status = 'queued', error = null where id = j.id returning * into j;
  end if;
  return j;
end $$;

create function public.claim_read_model() returns public.read_model_jobs
language plpgsql security definer set search_path = public as $$
declare j public.read_model_jobs;
begin
  select * into j from public.read_model_jobs where status = 'queued' or (status = 'running' and lease_until < now())
    order by created_at for update skip locked limit 1;
  if j.id is null then return null; end if;
  update public.read_model_jobs set status = 'running', lease_token = gen_random_uuid(),
    lease_until = now() + interval '15 minutes', attempts = attempts + 1 where id = j.id returning * into j;
  return j;
end $$;

create function public.publish_read_model(p_id uuid, p_token uuid, p_result jsonb, p_rows jsonb default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare j public.read_model_jobs; v bigint;
begin
  select * into strict j from public.read_model_jobs where id = p_id for update;
  if j.status <> 'running' or j.lease_token is distinct from p_token or j.lease_until < now() then return false; end if;
  -- Serializes publication with invalidation. Never label mixed-source work as current.
  select version into strict v from public.read_model_versions where kind = j.kind for share;
  if v <> j.source_version or j.business_date <> (now() at time zone 'America/Phoenix')::date then
    update public.read_model_jobs set status = 'obsolete', result = null where id = p_id;
    return false;
  end if;
  if j.kind = 'products' then
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Complete product rows required'; end if;
    insert into public.product_workspace_records(snapshot_id, id, record)
      select p_id, r->>'id', r from jsonb_array_elements(p_rows) r;
  end if;
  update public.read_model_jobs set status = 'completed', result = p_result, completed_at = clock_timestamp(),
    lease_until = null, error = null where id = p_id;
  return true;
end $$;

-- Every operation uses the same filter predicate; counts and exports cannot drift from the page.
create function public.product_workspace_matches(r jsonb, f jsonb) returns boolean
language sql immutable set search_path = public as $$
select
  (coalesce((f->>'includeInactive')::boolean, false) or r->>'active' is distinct from 'false'
    or r->>'statusKey' = 'qb_inactive_vs_active')
  and (coalesce(f->>'supplier', 'All') = 'All' or coalesce(r->>'supplierName', 'Unknown') = f->>'supplier')
  and (coalesce(f->>'health', 'All') = 'All' or r->>'sourceHealth' = f->>'health')
  and (coalesce(f->>'status', 'All') = 'All' or r->>'statusKey' = f->>'status'
    or (f->>'status' = 'gaps' and r->>'statusKey' in ('qb_active_vs_inactive','qb_active_vs_missing','qb_inactive_vs_active','vs_active_qb_missing'))
    or (f->>'status' = 'vs_status_unknown' and r->>'statusKey' in ('qb_active_vs_unknown','qb_inactive_vs_unknown')))
  and (coalesce(f->>'search', '') = '' or strpos(lower(concat_ws(' ', r->>'itemCode', r->>'productName', r->>'brand',
    r->>'vintage', r->>'pack', r->>'supplierName', r#>>'{quickbooks,fullName}')), lower(f->>'search')) > 0)
$$;

create function public.read_product_workspace(p_snapshot uuid, p_filters jsonb, p_offset integer default 0,
  p_limit integer default 75, p_sort text default 'productName', p_direction text default 'asc',
  p_mode text default 'page', p_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; sort_expr text; direction text; j public.read_model_jobs; v bigint;
begin
  select * into strict j from public.read_model_jobs where id = p_snapshot and kind = 'products' and status = 'completed';
  select version into v from public.read_model_versions where kind = 'products';
  if p_offset < 0 or p_limit < 1 or p_limit > 1000 then raise exception 'Invalid page bounds'; end if;
  if p_mode = 'detail' then
    select record into strict result from public.product_workspace_records where snapshot_id = p_snapshot and id = p_id;
  elsif p_mode = 'counts' then
    select jsonb_build_object('visible', count(*),
      'lifecycleMismatches', count(*) filter(where record->>'statusKey' in ('qb_active_vs_inactive','qb_active_vs_missing','qb_inactive_vs_active','vs_active_qb_missing')),
      'vsStatusUnknown', count(*) filter(where record->>'statusKey' in ('qb_active_vs_unknown','qb_inactive_vs_unknown')),
      'qbActiveVsUnknown', count(*) filter(where record->>'statusKey' = 'qb_active_vs_unknown'),
      'needsReview', count(*) filter(where record->>'sourceHealth' = 'needs_review'),
      'gpRed', count(*) filter(where (record->>'lowestGpPercent')::numeric < case when record->>'revenueCenter' = 'GRW Broker' then 8 else 26.5 end),
      'gpYellow', count(*) filter(where record->>'revenueCenter' <> 'GRW Broker' and (record->>'lowestGpPercent')::numeric >= 26.5 and (record->>'lowestGpPercent')::numeric < 28))
    into result from public.product_workspace_records where snapshot_id = p_snapshot and public.product_workspace_matches(record, p_filters);
    result := result || jsonb_build_object('suppliers', (select coalesce(jsonb_agg(s order by s), '[]'::jsonb) from
      (select distinct coalesce(record->>'supplierName', 'Unknown') s from public.product_workspace_records where snapshot_id = p_snapshot) x));
  elsif p_mode in ('page','export') then
    if p_sort in ('fob','laidIn','landedCost','frontline','bestPrice','lowestGpPercent') then
      sort_expr := format('(record->>%L)::numeric', p_sort);
    elsif p_sort in ('replenishmentPolicy','recommendationsSuppressed') then
      sort_expr := format('record#>>%L', '{orderingMarker,' || p_sort || '}');
    elsif p_sort = 'active' then
      sort_expr := 'lower(record->>''statusLabel'')';
    elsif p_sort in ('itemCode','productName','vintage','pack','supplierName','revenueCenter','active','sourceHealth') then
      sort_expr := format('lower(record->>%L)', p_sort);
    else raise exception 'Invalid sort'; end if;
    direction := case when p_direction = 'desc' then 'desc' else 'asc' end;
    execute format('select coalesce(jsonb_agg(r), ''[]''::jsonb) from (select %s r from public.product_workspace_records
      where snapshot_id = $1 and public.product_workspace_matches(record, $2)
      order by %s %s nulls last, id asc offset $3 limit $4) page',
      case when p_mode = 'export' then 'record' else
        '(record - array[''priceLevels'',''gpExplanation'',''vinosmith'',''supplierCatalog'',''quickbooks'']) || jsonb_build_object(''quickbooks'', jsonb_build_object(''listId'', record#>>''{quickbooks,listId}''))' end,
      sort_expr, direction)
      into result using p_snapshot, p_filters, p_offset, p_limit;
  else raise exception 'Invalid read mode'; end if;
  return jsonb_build_object('data', result, 'snapshotId', j.id, 'generatedAt', j.completed_at,
    'sourceVersion', j.source_version, 'formulaVersion', j.formula_version, 'businessDate', j.business_date,
    'isStale', j.source_version <> v or j.business_date <> (now() at time zone 'America/Phoenix')::date);
end $$;

-- Only authenticated application routes use the service client after validating the caller.
revoke all on function public.invalidate_read_models(), public.request_read_model(text,text,text,jsonb),
 public.claim_read_model(), public.publish_read_model(uuid,uuid,jsonb,jsonb), public.product_workspace_matches(jsonb,jsonb),
 public.read_product_workspace(uuid,jsonb,integer,integer,text,text,text,text) from public, anon, authenticated;
grant execute on function public.request_read_model(text,text,text,jsonb), public.claim_read_model(),
 public.publish_read_model(uuid,uuid,jsonb,jsonb), public.product_workspace_matches(jsonb,jsonb),
 public.read_product_workspace(uuid,jsonb,integer,integer,text,text,text,text) to service_role;
