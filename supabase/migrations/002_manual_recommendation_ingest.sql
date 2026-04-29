-- Transitional fields for persisting recommendations before the product catalog
-- is fully normalized. This lets manual upload runs save useful history by
-- planning_sku now, while still keeping product_id available for the future.

alter table public.reorder_recommendations
    alter column product_id drop not null;

alter table public.reorder_recommendations
    add column if not exists planning_sku text,
    add column if not exists product_name text,
    add column if not exists product_code text,
    add column if not exists supplier_name text;

alter table public.reorder_recommendations
    drop constraint if exists reorder_recommendations_report_run_id_product_id_key;

create unique index if not exists idx_recommendations_run_planning_sku
    on public.reorder_recommendations(report_run_id, planning_sku)
    where planning_sku is not null;

