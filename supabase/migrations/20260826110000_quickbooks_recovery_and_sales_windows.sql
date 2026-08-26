create table if not exists public.quickbooks_sales_reps (
    list_id text primary key,
    initial text,
    full_name text,
    entity_list_id text,
    entity_full_name text,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_source_sync_checkpoints_recovery_claim
    on public.source_sync_checkpoints(source_system, resource_name, status, requested_start_date desc, checkpoint_key desc);

alter table public.quickbooks_sales_reps enable row level security;
revoke all on table public.quickbooks_sales_reps from anon, authenticated;
grant select, insert, update, delete on table public.quickbooks_sales_reps to service_role;

insert into public.source_sync_checkpoints (
    source_system,
    resource_name,
    checkpoint_key,
    status,
    cursor_data,
    diagnostics,
    updated_at
)
values (
    'quickbooks_desktop',
    'quickbooks_sales_reps',
    'all',
    'pending',
    '{}'::jsonb,
    '{"recovery": true, "refreshReason": "persist_sales_reps"}'::jsonb,
    now()
)
on conflict (source_system, resource_name, checkpoint_key) do update
set
    status = 'pending',
    cursor_data = '{}'::jsonb,
    diagnostics = '{"recovery": true, "refreshReason": "persist_sales_reps"}'::jsonb,
    last_synced_at = null,
    updated_at = now()
where public.source_sync_checkpoints.status = 'completed';

insert into public.source_sync_checkpoints (
    source_system,
    resource_name,
    checkpoint_key,
    status,
    cursor_data,
    diagnostics,
    last_synced_at,
    updated_at
)
select
    'quickbooks_desktop',
    'quickbooks_recovery_seed',
    'v1',
    'completed',
    '{}'::jsonb,
    jsonb_build_object('backfillStart', '2018-08-14', 'backfillEnd', current_date::text, 'seedVersion', 'v1'),
    now(),
    now()
where exists (
    select 1
    from public.source_sync_checkpoints
    where source_system = 'quickbooks_desktop'
        and resource_name = 'quickbooks_invoices'
)
on conflict (source_system, resource_name, checkpoint_key) do nothing;

create or replace function public.quickbooks_item_sales_windows(
    p_reference_date date
)
returns table (
    item_list_id text,
    item_full_name text,
    last_30_quantity numeric,
    last_60_quantity numeric,
    last_90_quantity numeric,
    prior_30_quantity numeric,
    last_year_next_30_quantity numeric,
    last_year_next_60_quantity numeric,
    last_year_next_90_quantity numeric
)
language sql
stable
security definer
set search_path = public
as $$
with sales_lines as (
    select
        line.item_list_id,
        line.item_full_name,
        invoice.txn_date,
        coalesce(line.quantity, 0) as quantity
    from public.quickbooks_invoice_lines line
    join public.quickbooks_invoices invoice on invoice.txn_id = line.txn_id
    where invoice.txn_date >= p_reference_date - 365
        and invoice.txn_date <= p_reference_date
        and invoice.is_void is distinct from true
        and invoice.is_pending is distinct from true

    union all

    select
        line.item_list_id,
        line.item_full_name,
        credit_memo.txn_date,
        -coalesce(line.quantity, 0) as quantity
    from public.quickbooks_credit_memo_lines line
    join public.quickbooks_credit_memos credit_memo on credit_memo.txn_id = line.txn_id
    where credit_memo.txn_date >= p_reference_date - 365
        and credit_memo.txn_date <= p_reference_date
)
select
    item_list_id,
    item_full_name,
    sum(case when txn_date >= p_reference_date - 30 then quantity else 0 end) as last_30_quantity,
    sum(case when txn_date >= p_reference_date - 60 then quantity else 0 end) as last_60_quantity,
    sum(case when txn_date >= p_reference_date - 90 then quantity else 0 end) as last_90_quantity,
    sum(case when txn_date >= p_reference_date - 60 and txn_date < p_reference_date - 30 then quantity else 0 end) as prior_30_quantity,
    sum(case when txn_date >= p_reference_date - 365 and txn_date <= p_reference_date - 335 then quantity else 0 end) as last_year_next_30_quantity,
    sum(case when txn_date >= p_reference_date - 365 and txn_date <= p_reference_date - 305 then quantity else 0 end) as last_year_next_60_quantity,
    sum(case when txn_date >= p_reference_date - 365 and txn_date <= p_reference_date - 275 then quantity else 0 end) as last_year_next_90_quantity
from sales_lines
group by item_list_id, item_full_name;
$$;

revoke all on function public.quickbooks_item_sales_windows(date) from public;
grant execute on function public.quickbooks_item_sales_windows(date) to service_role;
