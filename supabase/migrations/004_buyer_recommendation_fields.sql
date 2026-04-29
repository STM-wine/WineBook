-- Buyer-facing recommendation fields from the ownership review.
-- Recommendations default to rejected until a buyer explicitly approves them.

alter table public.reorder_recommendations
    add column if not exists recommendation_status text not null default 'rejected'
        check (recommendation_status in ('rejected', 'approved', 'edited', 'deferred')),
    add column if not exists approved_qty integer not null default 0,
    add column if not exists is_btg boolean not null default false,
    add column if not exists is_core boolean not null default false,
    add column if not exists last_60_day_sales numeric not null default 0,
    add column if not exists last_90_day_sales numeric not null default 0,
    add column if not exists next_30_day_forecast numeric not null default 0,
    add column if not exists next_60_day_forecast numeric not null default 0,
    add column if not exists next_90_day_forecast numeric not null default 0,
    add column if not exists velocity_trend_pct numeric,
    add column if not exists risk_level text
        check (risk_level in ('High', 'Medium', 'Low', 'No Sales', 'Unknown')),
    add column if not exists true_available numeric not null default 0,
    add column if not exists on_order numeric not null default 0,
    add column if not exists fob numeric(12, 2),
    add column if not exists pack_size numeric,
    add column if not exists pickup_location text,
    add column if not exists trucking_cost_per_bottle numeric(12, 4),
    add column if not exists landed_cost numeric(12, 2);

create index if not exists idx_recommendations_status
    on public.reorder_recommendations(report_run_id, recommendation_status);

create index if not exists idx_recommendations_pickup_location
    on public.reorder_recommendations(report_run_id, pickup_location);
