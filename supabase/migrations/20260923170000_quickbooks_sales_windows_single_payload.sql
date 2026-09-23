-- PostgREST caps set-returning RPC responses at 1,000 rows. The ordering app
-- previously paged quickbooks_item_sales_windows with an exact count, which
-- rebuilt the same 365-day aggregate for every page and could hit the database
-- statement timeout. Return the unchanged result set as one JSON value so the
-- aggregate executes once and the row cap cannot truncate it.

create or replace function public.quickbooks_item_sales_windows_payload(p_reference_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select coalesce(
    jsonb_agg(to_jsonb(sales_window) order by sales_window.item_list_id, sales_window.item_full_name),
    '[]'::jsonb
)
from public.quickbooks_item_sales_windows(p_reference_date) sales_window;
$$;

revoke all on function public.quickbooks_item_sales_windows_payload(date) from public;
grant execute on function public.quickbooks_item_sales_windows_payload(date) to service_role;

notify pgrst, 'reload schema';
