alter table public.reorder_recommendations
    add column if not exists base_recommended_qty_raw numeric not null default 0,
    add column if not exists purchasing_environment_multiplier numeric not null default 1,
    add column if not exists purchasing_environment_mode text,
    add column if not exists purchasing_environment_month integer
        check (
            purchasing_environment_month is null
            or purchasing_environment_month between 1 and 12
        );
