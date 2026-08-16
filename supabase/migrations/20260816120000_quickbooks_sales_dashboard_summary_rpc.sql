create index if not exists idx_quickbooks_invoices_dashboard_range
    on public.quickbooks_invoices(txn_date desc, txn_id desc);

create index if not exists idx_quickbooks_credit_memos_dashboard_range
    on public.quickbooks_credit_memos(txn_date desc, txn_id desc);

create index if not exists idx_quickbooks_invoice_lines_txn_sequence
    on public.quickbooks_invoice_lines(txn_id, line_sequence);

create index if not exists idx_quickbooks_credit_memo_lines_txn_sequence
    on public.quickbooks_credit_memo_lines(txn_id, line_sequence);

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
    where invoice.txn_date >= params.date_from
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
    where credit_memo.txn_date >= params.date_from
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
    where invoice.txn_date >= params.date_from
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
    where credit_memo.txn_date >= params.date_from
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
