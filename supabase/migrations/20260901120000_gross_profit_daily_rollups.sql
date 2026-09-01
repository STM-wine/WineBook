create table if not exists public.gross_profit_rollup_runs (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'running' check (status in ('running', 'completed', 'failed')),
    requested_from date not null,
    requested_to date not null,
    processed_from date,
    processed_to date,
    formula_version text not null,
    stable_lag_days integer not null,
    chunk_count integer not null default 0,
    day_count integer not null default 0,
    row_count integer not null default 0,
    error_message text,
    started_at timestamptz not null default now(),
    completed_at timestamptz
);

create table if not exists public.gross_profit_daily_rollups (
    id uuid primary key default gen_random_uuid(),
    period_date date not null,
    business_line text not null default 'all' check (business_line in ('all', 'stem', 'grw')),
    scope_type text not null check (scope_type in ('company', 'rep', 'account', 'rep_account')),
    scope_key text not null,
    scope_label text not null,
    parent_scope_type text not null default '',
    parent_scope_key text not null default '',
    parent_scope_label text not null default '',
    invoice_sales numeric not null default 0,
    credit_memos numeric not null default 0,
    net_sales numeric not null default 0,
    invoice_count integer not null default 0,
    credit_memo_count integer not null default 0,
    sample_cost numeric not null default 0,
    gross_profit numeric not null default 0,
    gross_profit_percent numeric,
    confidence_buckets jsonb not null default '{}'::jsonb,
    cost_sources jsonb not null default '{}'::jsonb,
    price_match_methods jsonb not null default '{}'::jsonb,
    formula_version text not null,
    source_line_count integer not null default 0,
    run_id uuid references public.gross_profit_rollup_runs(id) on delete set null,
    calculated_at timestamptz not null default now(),
    unique (period_date, business_line, scope_type, scope_key, parent_scope_type, parent_scope_key)
);

create index if not exists idx_gross_profit_daily_rollups_range_scope
    on public.gross_profit_daily_rollups(period_date, business_line, scope_type, scope_key);

create index if not exists idx_gross_profit_daily_rollups_parent
    on public.gross_profit_daily_rollups(parent_scope_type, parent_scope_key, period_date)
    where parent_scope_type <> '';

create index if not exists idx_gross_profit_rollup_runs_started
    on public.gross_profit_rollup_runs(started_at desc);

alter table public.gross_profit_rollup_runs enable row level security;
alter table public.gross_profit_daily_rollups enable row level security;
