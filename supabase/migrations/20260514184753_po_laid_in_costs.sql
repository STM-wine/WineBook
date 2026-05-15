-- Preserve wine cost and laid-in cost separately on PO lines so app review and
-- XLSX exports use the same landed-cost math.

alter table public.purchase_order_lines
    add column if not exists trucking_cost_per_bottle numeric(12, 4) not null default 0,
    add column if not exists wine_cost numeric(12, 2) not null default 0,
    add column if not exists laid_in_cost numeric(12, 2) not null default 0,
    add column if not exists landed_cost numeric(12, 2) not null default 0;
