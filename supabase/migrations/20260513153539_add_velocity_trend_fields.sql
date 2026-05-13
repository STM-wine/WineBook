alter table public.reorder_recommendations
    add column if not exists prior_30_day_sales numeric,
    add column if not exists velocity_trend_label text;
