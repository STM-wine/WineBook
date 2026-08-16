create index if not exists idx_quickbooks_invoice_lines_txn_sequence
    on public.quickbooks_invoice_lines(txn_id, line_sequence, id);

create index if not exists idx_quickbooks_credit_memo_lines_txn_sequence
    on public.quickbooks_credit_memo_lines(txn_id, line_sequence, id);

create index if not exists idx_vinosmith_order_headers_invoice_number
    on public.vinosmith_order_headers(invoice_number, supplier_order_id)
    where invoice_number is not null;

create index if not exists idx_vinosmith_prices_wine_label_price
    on public.vinosmith_prices(wine_id, label, price_cents);
