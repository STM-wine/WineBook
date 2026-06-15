-- Normalize Vinosmith account and user rescue data into private cache tables.

create table if not exists public.vinosmith_accounts (
    account_id text primary key,
    name text,
    code text,
    status text,
    kind text,
    primary_contact_id text,
    invoice_title text,
    warehouse_code text,
    tasting_hours text,
    delivery_restrictions text,
    abc_num text,
    tax_id_num text,
    resale_num text,
    license_expiration date,
    shipping_street1 text,
    shipping_street2 text,
    shipping_city text,
    shipping_state text,
    shipping_zip text,
    shipping_lat numeric(12, 8),
    shipping_lng numeric(12, 8),
    billing_street1 text,
    billing_street2 text,
    billing_city text,
    billing_state text,
    billing_zip text,
    billing_lat numeric(12, 8),
    billing_lng numeric(12, 8),
    website_url text,
    phone_number text,
    source_created_at timestamptz,
    source_updated_at timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.vinosmith_users (
    user_id text primary key,
    first_name text,
    last_name text,
    full_name text,
    email text,
    active boolean,
    role text,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create index if not exists idx_vinosmith_accounts_name
    on public.vinosmith_accounts(name);
create index if not exists idx_vinosmith_accounts_code
    on public.vinosmith_accounts(code);
create index if not exists idx_vinosmith_accounts_status
    on public.vinosmith_accounts(status);
create index if not exists idx_vinosmith_users_email
    on public.vinosmith_users(email);
create index if not exists idx_vinosmith_users_role
    on public.vinosmith_users(role);

alter table public.vinosmith_accounts enable row level security;
alter table public.vinosmith_users enable row level security;

revoke all on table
    public.vinosmith_accounts,
    public.vinosmith_users
from anon, authenticated;

grant select, insert, update, delete on table
    public.vinosmith_accounts,
    public.vinosmith_users
to service_role;
