-- Sales-window reads need only these small columns, not the full invoice/line
-- records (including raw QuickBooks JSON). Cover the existing joins and filters
-- so cold reads do not scan those wide tables. Calculation semantics are unchanged.
create index if not exists idx_qb_invoice_sales_window
    on public.quickbooks_invoices (txn_date, txn_id)
    where is_void is distinct from true and is_pending is distinct from true;

create index if not exists idx_qb_invoice_line_sales_window
    on public.quickbooks_invoice_lines (txn_id)
    include (item_list_id, item_full_name, quantity);

create index if not exists idx_qb_credit_sales_window
    on public.quickbooks_credit_memos (txn_date, txn_id);

create index if not exists idx_qb_credit_line_sales_window
    on public.quickbooks_credit_memo_lines (txn_id)
    include (item_list_id, item_full_name, quantity);
