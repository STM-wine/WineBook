-- Keep QuickBooks deletions as auditable mirror state. QuickBooks itself remains read only.
alter table public.quickbooks_invoices
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_source text;

alter table public.quickbooks_credit_memos
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_source text;

create table if not exists public.quickbooks_deleted_transactions (
  txn_type text not null,
  txn_id text not null,
  time_deleted timestamptz,
  source text not null check (source in ('quickbooks_event', 'verified_missing')),
  resolved_at timestamptz,
  raw_response_id uuid references public.source_api_responses(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (txn_type, txn_id)
);

alter table public.quickbooks_deleted_transactions enable row level security;
revoke all on public.quickbooks_deleted_transactions from public, anon, authenticated;
grant select, insert, update, delete on public.quickbooks_deleted_transactions to service_role;

create or replace function public.apply_quickbooks_deletions(p_events jsonb, p_response_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_event jsonb;
  v_type text;
  v_id text;
  v_source text;
  v_deleted timestamptz;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'QuickBooks deletion events must be an array';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    v_type := v_event->>'txn_type';
    v_id := nullif(btrim(v_event->>'txn_id'), '');
    v_source := v_event->>'source';
    if v_type is null or v_type not in ('Invoice', 'CreditMemo', 'ReceivePayment', 'PurchaseOrder', 'Bill', 'VendorCredit')
       or v_id is null or v_source not in ('quickbooks_event', 'verified_missing') then
      raise exception 'Invalid QuickBooks deletion event';
    end if;
    v_deleted := nullif(v_event->>'time_deleted', '')::timestamptz;

    insert into public.quickbooks_deleted_transactions
      (txn_type, txn_id, time_deleted, source, raw_response_id)
    values (v_type, v_id, v_deleted, v_source, p_response_id)
    on conflict (txn_type, txn_id) do update set
      time_deleted = coalesce(excluded.time_deleted, quickbooks_deleted_transactions.time_deleted),
      source = case when excluded.source = 'quickbooks_event' then excluded.source
                    else quickbooks_deleted_transactions.source end,
      raw_response_id = case when excluded.source = 'quickbooks_event' then excluded.raw_response_id
                             else quickbooks_deleted_transactions.raw_response_id end,
      resolved_at = null,
      last_seen_at = now();

    if v_type = 'Invoice' then
      update public.quickbooks_invoices
         set deleted_at = coalesce(deleted_at, v_deleted, now()),
             deletion_source = case when v_source = 'quickbooks_event' then v_source else coalesce(deletion_source, v_source) end
       where txn_id = v_id and (deleted_at is null or (v_source = 'quickbooks_event' and deletion_source is distinct from v_source));
    elsif v_type = 'CreditMemo' then
      update public.quickbooks_credit_memos
         set deleted_at = coalesce(deleted_at, v_deleted, now()),
             deletion_source = case when v_source = 'quickbooks_event' then v_source else coalesce(deletion_source, v_source) end
       where txn_id = v_id and (deleted_at is null or (v_source = 'quickbooks_event' and deletion_source is distinct from v_source));
    end if;
  end loop;
end $$;

revoke all on function public.apply_quickbooks_deletions(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.apply_quickbooks_deletions(jsonb, uuid) to service_role;

-- A later live QuickBooks response can correct a mistaken missing-ID observation.
-- Confirmed QuickBooks deletion events are never cleared by this function.
create or replace function public.resolve_quickbooks_verified_missing(p_type text, p_ids text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_type not in ('Invoice', 'CreditMemo') then
    raise exception 'Unsupported QuickBooks transaction type';
  end if;
  update public.quickbooks_deleted_transactions
     set resolved_at = now(), last_seen_at = now()
   where txn_type = p_type and txn_id = any(p_ids)
     and source = 'verified_missing' and resolved_at is null;
  if p_type = 'Invoice' then
    update public.quickbooks_invoices i set deleted_at = null, deletion_source = null
     where i.txn_id = any(p_ids) and i.deletion_source = 'verified_missing'
       and exists (select 1 from public.quickbooks_deleted_transactions d
                    where d.txn_type = p_type and d.txn_id = i.txn_id and d.resolved_at is not null);
  else
    update public.quickbooks_credit_memos c set deleted_at = null, deletion_source = null
     where c.txn_id = any(p_ids) and c.deletion_source = 'verified_missing'
       and exists (select 1 from public.quickbooks_deleted_transactions d
                    where d.txn_type = p_type and d.txn_id = c.txn_id and d.resolved_at is not null);
  end if;
end $$;

revoke all on function public.resolve_quickbooks_verified_missing(text, text[]) from public, anon, authenticated;
grant execute on function public.resolve_quickbooks_verified_missing(text, text[]) to service_role;

-- A later invoice page must not resurrect a transaction already deleted in QuickBooks.
create or replace function public.guard_quickbooks_deleted_transaction()
returns trigger language plpgsql set search_path = public as $$
declare v_deleted public.quickbooks_deleted_transactions%rowtype;
begin
  select * into v_deleted from public.quickbooks_deleted_transactions
   where txn_type = TG_ARGV[0] and txn_id = new.txn_id and resolved_at is null;
  if found then
    new.deleted_at := coalesce(v_deleted.time_deleted, v_deleted.first_seen_at);
    new.deletion_source := v_deleted.source;
  end if;
  return new;
end $$;

drop trigger if exists guard_quickbooks_deleted_invoice on public.quickbooks_invoices;
create trigger guard_quickbooks_deleted_invoice
before insert or update on public.quickbooks_invoices
for each row execute function public.guard_quickbooks_deleted_transaction('Invoice');

drop trigger if exists guard_quickbooks_deleted_credit_memo on public.quickbooks_credit_memos;
create trigger guard_quickbooks_deleted_credit_memo
before insert or update on public.quickbooks_credit_memos
for each row execute function public.guard_quickbooks_deleted_transaction('CreditMemo');

notify pgrst, 'reload schema';

-- Keep both sales totals and drilldown rows on active QuickBooks transactions.
create or replace function public.quickbooks_sales_dashboard_summary(
    p_date_from date,
    p_date_to date,
    p_rep text default null,
    p_document_type text default 'all',
    p_account text default null,
    p_document text default null,
    p_item text default null,
    p_include_items boolean default false
)
returns table (
    group_type text,
    label text,
    month_key text,
    document_type text,
    sales_amount numeric,
    document_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
with params as (
    select
        p_date_from as date_from,
        p_date_to as date_to,
        nullif(trim(p_rep), '') as rep,
        coalesce(nullif(trim(p_document_type), ''), 'all') as document_type,
        lower(nullif(trim(p_account), '')) as account_filter,
        lower(nullif(trim(p_document), '')) as document_filter,
        lower(nullif(trim(p_item), '')) as item_filter,
        p_include_items as include_items
),
base_sales as (
    select
        invoice.txn_id,
        'invoice'::text as document_type,
        invoice.ref_number,
        invoice.txn_date,
        coalesce(nullif(trim(invoice.customer_full_name), ''), 'Unknown Account') as account,
        coalesce(
            nullif(trim(invoice.sales_rep_ref ->> 'ResolvedFullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'SalesRepEntityFullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'resolvedFullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'FullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'fullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'Name'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'name'), ''),
            'Unassigned Rep'
        ) as rep,
        greatest(coalesce(invoice.subtotal, invoice.total_amount, 0), 0) as amount,
        invoice.txn_date as sales_date
    from public.quickbooks_invoices invoice
    cross join params
    where invoice.deleted_at is null
        and invoice.txn_date >= params.date_from
        and invoice.txn_date <= params.date_to
        and (params.document_type = 'all' or params.document_type = 'invoice')
        and (params.account_filter is null or lower(coalesce(invoice.customer_full_name, '')) like '%' || params.account_filter || '%')
        and (params.document_filter is null or lower(coalesce(invoice.ref_number, '')) like '%' || params.document_filter || '%')
        and (
            params.item_filter is null
            or exists (
                select 1
                from public.quickbooks_invoice_lines line
                where line.txn_id = invoice.txn_id
                    and lower(coalesce(line.item_full_name, '') || ' ' || coalesce(line.description, '')) like '%' || params.item_filter || '%'
            )
        )

    union all

    select
        credit_memo.txn_id,
        'credit_memo'::text as document_type,
        credit_memo.ref_number,
        credit_memo.txn_date,
        coalesce(nullif(trim(credit_memo.customer_full_name), ''), 'Unknown Account') as account,
        coalesce(
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'ResolvedFullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'SalesRepEntityFullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'resolvedFullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'FullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'fullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'Name'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'name'), ''),
            'Unassigned Rep'
        ) as rep,
        -abs(coalesce(credit_memo.subtotal, credit_memo.total_amount, 0)) as amount,
        credit_memo.txn_date as sales_date
    from public.quickbooks_credit_memos credit_memo
    cross join params
    where credit_memo.deleted_at is null
        and credit_memo.txn_date >= params.date_from
        and credit_memo.txn_date <= params.date_to
        and (params.document_type = 'all' or params.document_type = 'credit_memo')
        and (params.account_filter is null or lower(coalesce(credit_memo.customer_full_name, '')) like '%' || params.account_filter || '%')
        and (params.document_filter is null or lower(coalesce(credit_memo.ref_number, '')) like '%' || params.document_filter || '%')
        and (
            params.item_filter is null
            or exists (
                select 1
                from public.quickbooks_credit_memo_lines line
                where line.txn_id = credit_memo.txn_id
                    and lower(coalesce(line.item_full_name, '') || ' ' || coalesce(line.description, '')) like '%' || params.item_filter || '%'
            )
        )
),
filtered_sales as (
    select base_sales.*
    from base_sales
    cross join params
    where (params.rep is null or base_sales.rep = params.rep)
),
summary_rows as (
    select 'overall'::text as group_type, 'All'::text as label, max(sales_date)::text as month_key, document_type, sum(abs(amount)) as sales_amount, count(*)::bigint as document_count
    from filtered_sales
    group by document_type

    union all

    select 'rep'::text as group_type, rep as label, null::text as month_key, document_type, sum(abs(amount)) as sales_amount, count(*)::bigint as document_count
    from filtered_sales
    group by rep, document_type

    union all

    select 'account'::text as group_type, account as label, null::text as month_key, document_type, sum(abs(amount)) as sales_amount, count(*)::bigint as document_count
    from filtered_sales
    group by account, document_type

    union all

    select 'monthly_rep'::text as group_type, rep as label, to_char(sales_date, 'YYYY-MM') as month_key, 'all'::text as document_type, sum(amount) as sales_amount, count(*)::bigint as document_count
    from filtered_sales
    group by rep, to_char(sales_date, 'YYYY-MM')
),
invoice_item_rows as (
    select
        coalesce(nullif(trim(coalesce(line.item_full_name, line.description)), ''), 'Unspecified Item') as label,
        'invoice'::text as document_type,
        abs(coalesce(line.amount, 0)) as sales_amount
    from filtered_sales sale
    join public.quickbooks_invoice_lines line on line.txn_id = sale.txn_id
    cross join params
    where sale.document_type = 'invoice'
        and (params.include_items or params.item_filter is not null)
        and (
            params.item_filter is null
            or lower(coalesce(line.item_full_name, '') || ' ' || coalesce(line.description, '')) like '%' || params.item_filter || '%'
        )

    union all

    select
        'Unspecified Item'::text as label,
        'invoice'::text as document_type,
        abs(sale.amount) as sales_amount
    from filtered_sales sale
    cross join params
    where sale.document_type = 'invoice'
        and (params.include_items or params.item_filter is not null)
        and params.item_filter is null
        and not exists (select 1 from public.quickbooks_invoice_lines line where line.txn_id = sale.txn_id)
),
credit_item_rows as (
    select
        coalesce(nullif(trim(coalesce(line.item_full_name, line.description)), ''), 'Unspecified Item') as label,
        'credit_memo'::text as document_type,
        abs(coalesce(line.amount, 0)) as sales_amount
    from filtered_sales sale
    join public.quickbooks_credit_memo_lines line on line.txn_id = sale.txn_id
    cross join params
    where sale.document_type = 'credit_memo'
        and (params.include_items or params.item_filter is not null)
        and (
            params.item_filter is null
            or lower(coalesce(line.item_full_name, '') || ' ' || coalesce(line.description, '')) like '%' || params.item_filter || '%'
        )

    union all

    select
        'Unspecified Item'::text as label,
        'credit_memo'::text as document_type,
        abs(sale.amount) as sales_amount
    from filtered_sales sale
    cross join params
    where sale.document_type = 'credit_memo'
        and (params.include_items or params.item_filter is not null)
        and params.item_filter is null
        and not exists (select 1 from public.quickbooks_credit_memo_lines line where line.txn_id = sale.txn_id)
),
item_summary_rows as (
    select 'item'::text as group_type, label, null::text as month_key, document_type, sum(sales_amount) as sales_amount, count(*)::bigint as document_count
    from (
        select * from invoice_item_rows
        union all
        select * from credit_item_rows
    ) item_rows
    group by label, document_type
)
select * from summary_rows
union all
select * from item_summary_rows;
$$;

create or replace function public.quickbooks_sales_dashboard_transactions(
    p_date_from date,
    p_date_to date,
    p_rep text default null,
    p_document_type text default 'all',
    p_account text default null,
    p_document text default null,
    p_item text default null,
    p_limit integer default 300
)
returns table (
    txn_id text,
    document_type text,
    ref_number text,
    txn_date date,
    account text,
    rep text,
    amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
with params as (
    select
        p_date_from as date_from,
        p_date_to as date_to,
        nullif(trim(p_rep), '') as rep,
        coalesce(nullif(trim(p_document_type), ''), 'all') as document_type,
        lower(nullif(trim(p_account), '')) as account_filter,
        lower(nullif(trim(p_document), '')) as document_filter,
        lower(nullif(trim(p_item), '')) as item_filter,
        greatest(1, least(coalesce(p_limit, 300), 1000)) as row_limit
),
base_sales as (
    select
        invoice.txn_id,
        'invoice'::text as document_type,
        invoice.ref_number,
        invoice.txn_date,
        coalesce(nullif(trim(invoice.customer_full_name), ''), 'Unknown Account') as account,
        coalesce(
            nullif(trim(invoice.sales_rep_ref ->> 'ResolvedFullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'SalesRepEntityFullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'resolvedFullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'FullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'fullName'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'Name'), ''),
            nullif(trim(invoice.sales_rep_ref ->> 'name'), ''),
            'Unassigned Rep'
        ) as rep,
        greatest(coalesce(invoice.subtotal, invoice.total_amount, 0), 0) as amount
    from public.quickbooks_invoices invoice
    cross join params
    where invoice.deleted_at is null
        and invoice.txn_date >= params.date_from
        and invoice.txn_date <= params.date_to
        and (params.document_type = 'all' or params.document_type = 'invoice')
        and (params.account_filter is null or lower(coalesce(invoice.customer_full_name, '')) like '%' || params.account_filter || '%')
        and (params.document_filter is null or lower(coalesce(invoice.ref_number, '')) like '%' || params.document_filter || '%')
        and (
            params.item_filter is null
            or exists (
                select 1
                from public.quickbooks_invoice_lines line
                where line.txn_id = invoice.txn_id
                    and lower(coalesce(line.item_full_name, '') || ' ' || coalesce(line.description, '')) like '%' || params.item_filter || '%'
            )
        )

    union all

    select
        credit_memo.txn_id,
        'credit_memo'::text as document_type,
        credit_memo.ref_number,
        credit_memo.txn_date,
        coalesce(nullif(trim(credit_memo.customer_full_name), ''), 'Unknown Account') as account,
        coalesce(
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'ResolvedFullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'SalesRepEntityFullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'resolvedFullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'FullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'fullName'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'Name'), ''),
            nullif(trim(credit_memo.raw_data -> 'sales_rep_ref' ->> 'name'), ''),
            'Unassigned Rep'
        ) as rep,
        -abs(coalesce(credit_memo.subtotal, credit_memo.total_amount, 0)) as amount
    from public.quickbooks_credit_memos credit_memo
    cross join params
    where credit_memo.deleted_at is null
        and credit_memo.txn_date >= params.date_from
        and credit_memo.txn_date <= params.date_to
        and (params.document_type = 'all' or params.document_type = 'credit_memo')
        and (params.account_filter is null or lower(coalesce(credit_memo.customer_full_name, '')) like '%' || params.account_filter || '%')
        and (params.document_filter is null or lower(coalesce(credit_memo.ref_number, '')) like '%' || params.document_filter || '%')
        and (
            params.item_filter is null
            or exists (
                select 1
                from public.quickbooks_credit_memo_lines line
                where line.txn_id = credit_memo.txn_id
                    and lower(coalesce(line.item_full_name, '') || ' ' || coalesce(line.description, '')) like '%' || params.item_filter || '%'
            )
        )
)
select base_sales.txn_id, base_sales.document_type, base_sales.ref_number, base_sales.txn_date, base_sales.account, base_sales.rep, base_sales.amount
from base_sales
cross join params
where (params.rep is null or base_sales.rep = params.rep)
order by base_sales.txn_date desc nulls last, base_sales.txn_id desc
limit (select row_limit from params);
$$;

revoke all on function public.quickbooks_sales_dashboard_summary(date, date, text, text, text, text, text, boolean) from public;
revoke all on function public.quickbooks_sales_dashboard_transactions(date, date, text, text, text, text, text, integer) from public;
grant execute on function public.quickbooks_sales_dashboard_summary(date, date, text, text, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.quickbooks_sales_dashboard_transactions(date, date, text, text, text, text, text, integer) to authenticated, service_role;


-- Ordering sales windows use the same active transaction set.
create or replace function public.quickbooks_item_sales_windows(p_reference_date date)
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
    select line.item_list_id, line.item_full_name, invoice.txn_date, coalesce(line.quantity, 0) as quantity
    from public.quickbooks_invoice_lines line
    join public.quickbooks_invoices invoice on invoice.txn_id = line.txn_id
    where invoice.txn_date > p_reference_date - 365
      and invoice.txn_date <= p_reference_date
      and invoice.is_void is distinct from true
      and invoice.deleted_at is null
      and invoice.is_pending is distinct from true

    union all

    select line.item_list_id, line.item_full_name, credit_memo.txn_date, -coalesce(line.quantity, 0) as quantity
    from public.quickbooks_credit_memo_lines line
    join public.quickbooks_credit_memos credit_memo on credit_memo.txn_id = line.txn_id
    where credit_memo.txn_date > p_reference_date - 365
      and credit_memo.txn_date <= p_reference_date
      and credit_memo.deleted_at is null
)
select
    item_list_id,
    item_full_name,
    sum(case when txn_date > p_reference_date - 30 then quantity else 0 end),
    sum(case when txn_date > p_reference_date - 60 then quantity else 0 end),
    sum(case when txn_date > p_reference_date - 90 then quantity else 0 end),
    sum(case when txn_date > p_reference_date - 60 and txn_date <= p_reference_date - 30 then quantity else 0 end),
    sum(case when txn_date > p_reference_date - 365 and txn_date <= p_reference_date - 335 then quantity else 0 end),
    sum(case when txn_date > p_reference_date - 365 and txn_date <= p_reference_date - 305 then quantity else 0 end),
    sum(case when txn_date > p_reference_date - 365 and txn_date <= p_reference_date - 275 then quantity else 0 end)
from sales_lines
group by item_list_id, item_full_name
order by item_list_id, item_full_name;
$$;

revoke all on function public.quickbooks_item_sales_windows(date) from public;
grant execute on function public.quickbooks_item_sales_windows(date) to service_role;

notify pgrst, 'reload schema';
