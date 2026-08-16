alter table public.vinosmith_order_lines
    add column if not exists price_id text,
    add column if not exists price_label text;

create index if not exists idx_vinosmith_order_lines_price_id
    on public.vinosmith_order_lines(price_id);
