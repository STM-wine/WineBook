-- Make 30/60/90-day windows exact calendar-day counts, including the
-- reference date, while continuing to net credit memos against invoices.

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
      and invoice.is_pending is distinct from true

    union all

    select line.item_list_id, line.item_full_name, credit_memo.txn_date, -coalesce(line.quantity, 0) as quantity
    from public.quickbooks_credit_memo_lines line
    join public.quickbooks_credit_memos credit_memo on credit_memo.txn_id = line.txn_id
    where credit_memo.txn_date > p_reference_date - 365
      and credit_memo.txn_date <= p_reference_date
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
group by item_list_id, item_full_name;
$$;

revoke all on function public.quickbooks_item_sales_windows(date) from public;
grant execute on function public.quickbooks_item_sales_windows(date) to service_role;

notify pgrst, 'reload schema';
