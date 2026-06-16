-- Normalize Vinosmith account-detail rescue data. The list accounts endpoint
-- does not include nested contacts or sales reps; /accounts/{account_id} does.

create table if not exists public.vinosmith_account_contacts (
    contact_id text primary key,
    account_id text not null references public.vinosmith_accounts(account_id) on delete cascade,
    first_name text,
    last_name text,
    full_name text,
    title text,
    email text,
    phone text,
    mobile_phone text,
    business_phone text,
    personal_email text,
    fax text,
    invoices boolean,
    buyer boolean,
    primary_contact boolean,
    notes text,
    birth_date date,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.vinosmith_account_sales_reps (
    account_id text not null references public.vinosmith_accounts(account_id) on delete cascade,
    user_id text not null,
    first_name text,
    last_name text,
    full_name text,
    email text,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    primary key (account_id, user_id)
);

create index if not exists idx_vinosmith_account_contacts_account
    on public.vinosmith_account_contacts(account_id);
create index if not exists idx_vinosmith_account_contacts_email
    on public.vinosmith_account_contacts(email);
create index if not exists idx_vinosmith_account_sales_reps_user
    on public.vinosmith_account_sales_reps(user_id);

alter table public.vinosmith_account_contacts enable row level security;
alter table public.vinosmith_account_sales_reps enable row level security;

revoke all on table
    public.vinosmith_account_contacts,
    public.vinosmith_account_sales_reps
from anon, authenticated;

grant select, insert, update, delete on table
    public.vinosmith_account_contacts,
    public.vinosmith_account_sales_reps
to service_role;
