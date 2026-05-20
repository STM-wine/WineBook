-- Keep the PO line cost columns present and ask PostgREST to reload its schema
-- cache. Supabase's Data API can briefly report newly-added columns as missing
-- after DDL, which caused PO draft creation to look failed even when the draft
-- header was created.

alter table public.purchase_order_lines
    add column if not exists trucking_cost_per_bottle numeric(12, 4) not null default 0,
    add column if not exists wine_cost numeric(12, 2) not null default 0,
    add column if not exists laid_in_cost numeric(12, 2) not null default 0,
    add column if not exists landed_cost numeric(12, 2) not null default 0;

notify pgrst, 'reload schema';
