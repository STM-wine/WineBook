-- Supplier Hub catalog workflow.
--
-- Supplier catalog wines are supplier-available records, not official Stem
-- products. Official accounting products remain in public.products and are
-- linked here later through QuickBooks/accounting sync identifiers.

create table if not exists public.supplier_catalog_wines (
    id uuid primary key default gen_random_uuid(),
    supplier_id uuid references public.suppliers(id),
    supplier_name text not null,
    producer text not null,
    wine_name text not null,
    vintage text not null default 'NV',
    pack_size integer not null default 12 check (pack_size >= 1),
    bottle_size text not null default '750ml',
    pricing_basis text not null default 'bottle',
    fob_bottle numeric(12, 2) not null default 0 check (fob_bottle >= 0),
    fob_case numeric(12, 2) not null default 0 check (fob_case >= 0),
    laid_in_per_bottle numeric(12, 2) not null default 0 check (laid_in_per_bottle >= 0),
    landed_bottle_cost numeric(12, 2) not null default 0 check (landed_bottle_cost >= 0),
    frontline_bottle_price numeric(12, 2) not null default 0 check (frontline_bottle_price >= 0),
    best_price numeric(12, 2) check (best_price is null or best_price >= 0),
    gross_profit_margin numeric(8, 4) not null default 0,
    availability_status text not null default 'available'
        check (availability_status in ('available', 'limited', 'sold_out', 'unknown')),
    conversion_status text not null default 'net_new_product'
        check (
            conversion_status in (
                'exact_existing_product',
                'new_vintage',
                'new_format',
                'possible_match_needs_review',
                'net_new_product'
            )
        ),
    display_name text not null,
    planning_sku text not null unique,
    planning_sku_without_vintage text not null,
    diagnostics jsonb not null default '{}'::jsonb,
    quickbooks_item_id text,
    quickbooks_item_name text,
    quickbooks_sync_status text not null default 'not_created'
        check (quickbooks_sync_status in ('not_created', 'pending_create', 'created', 'linked', 'sync_error')),
    product_lifecycle_status text not null default 'supplier_available'
        check (product_lifecycle_status in ('supplier_available', 'pending_product_creation', 'active_product', 'inactive')),
    accounting_create_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.wine_requests (
    id uuid primary key default gen_random_uuid(),
    request_id text not null unique,
    account_customer text not null,
    requested_quantity integer not null check (requested_quantity > 0),
    needed_by_date date,
    placement_type text not null
        check (placement_type in ('BTG', 'List', 'Shelf', 'Club', 'Special Order', 'Other')),
    source_type text not null
        check (source_type in ('net_new_wine', 'supplier_available_wine')),
    supplier_catalog_wine_id uuid references public.supplier_catalog_wines(id),
    wine_display_name text not null,
    supplier_name text not null,
    requester_name text not null,
    notes text,
    request_status text not null default 'pending_review'
        check (request_status in ('pending_review', 'approved', 'rejected', 'on_hold')),
    fulfillment_status text not null default 'waiting_for_next_order'
        check (
            fulfillment_status in (
                'waiting_for_next_order',
                'added_to_po',
                'ordered',
                'received',
                'cancelled'
            )
        ),
    approval_decision text
        check (
            approval_decision is null or approval_decision in (
                'approve',
                'reject',
                'hold',
                'approve_as_special_order',
                'approve_as_new_stem_product'
            )
        ),
    approver_name text,
    ordering_workflow_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (placement_type <> 'Other' or nullif(btrim(coalesce(notes, '')), '') is not null)
);

create table if not exists public.price_change_events (
    id uuid primary key default gen_random_uuid(),
    supplier_catalog_wine_id uuid references public.supplier_catalog_wines(id),
    supplier text not null,
    wine text not null,
    vintage text not null default 'NV',
    old_fob numeric(12, 2),
    new_fob numeric(12, 2),
    old_frontline numeric(12, 2),
    new_frontline numeric(12, 2),
    old_best_price numeric(12, 2),
    new_best_price numeric(12, 2),
    margin_before numeric(8, 4),
    margin_after numeric(8, 4),
    effective_date date not null default current_date,
    reason text,
    status text not null default 'draft'
        check (status in ('draft', 'pending_review', 'approved', 'communicated', 'live')),
    fob_increase boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists idx_supplier_catalog_wines_supplier
    on public.supplier_catalog_wines(supplier_name, availability_status);

create index if not exists idx_supplier_catalog_wines_pending_creation
    on public.supplier_catalog_wines(conversion_status, product_lifecycle_status, quickbooks_sync_status);

create index if not exists idx_supplier_catalog_wines_planning_sku_without_vintage
    on public.supplier_catalog_wines(planning_sku_without_vintage);

create index if not exists idx_wine_requests_status
    on public.wine_requests(request_status, approval_decision, fulfillment_status);

create index if not exists idx_price_change_events_status
    on public.price_change_events(status, effective_date);

alter table public.supplier_catalog_wines enable row level security;
alter table public.wine_requests enable row level security;
alter table public.price_change_events enable row level security;

grant select, insert, update on public.supplier_catalog_wines to authenticated;
grant select, insert, update on public.wine_requests to authenticated;
grant select, insert, update on public.price_change_events to authenticated;

drop policy if exists "authenticated users can read supplier catalog wines"
    on public.supplier_catalog_wines;

create policy "authenticated users can read supplier catalog wines"
    on public.supplier_catalog_wines for select
    to authenticated
    using (true);

drop policy if exists "buyer and admin profiles can create supplier catalog wines"
    on public.supplier_catalog_wines;

create policy "buyer and admin profiles can create supplier catalog wines"
    on public.supplier_catalog_wines for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "buyer and admin profiles can update supplier catalog wines"
    on public.supplier_catalog_wines;

create policy "buyer and admin profiles can update supplier catalog wines"
    on public.supplier_catalog_wines for update
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "authenticated users can read wine requests"
    on public.wine_requests;

create policy "authenticated users can read wine requests"
    on public.wine_requests for select
    to authenticated
    using (true);

drop policy if exists "buyer and admin profiles can create wine requests"
    on public.wine_requests;

create policy "buyer and admin profiles can create wine requests"
    on public.wine_requests for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "buyer and admin profiles can update wine requests"
    on public.wine_requests;

create policy "buyer and admin profiles can update wine requests"
    on public.wine_requests for update
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "authenticated users can read price change events"
    on public.price_change_events;

create policy "authenticated users can read price change events"
    on public.price_change_events for select
    to authenticated
    using (true);

drop policy if exists "buyer and admin profiles can create price change events"
    on public.price_change_events;

create policy "buyer and admin profiles can create price change events"
    on public.price_change_events for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "buyer and admin profiles can update price change events"
    on public.price_change_events;

create policy "buyer and admin profiles can update price change events"
    on public.price_change_events for update
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );
