-- Normalize Vinosmith wine pre-arrivals so this rescued resource is durable
-- beyond Render's local tmp output.

create table if not exists public.vinosmith_prearrivals (
    prearrival_key text primary key,
    wine_id text references public.vinosmith_wines(wine_id),
    wine_code text,
    wine_name text,
    quantity numeric(18, 4),
    expected_date date,
    notes text,
    external_identifier text,
    external_identifier_1 text,
    source_created_at timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create index if not exists idx_vinosmith_prearrivals_wine
    on public.vinosmith_prearrivals(wine_id);
create index if not exists idx_vinosmith_prearrivals_expected_date
    on public.vinosmith_prearrivals(expected_date);

alter table public.vinosmith_prearrivals enable row level security;

revoke all on table public.vinosmith_prearrivals from anon, authenticated;

grant select, insert, update, delete on table public.vinosmith_prearrivals to service_role;
