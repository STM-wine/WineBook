-- Initial Supabase schema for the Stem ordering platform.
-- This models Stem's business objects first; Vinosmith/RB6/RADs files are
-- treated as temporary source feeds that populate these tables.

create extension if not exists pgcrypto;

create table if not exists public.app_profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    full_name text,
    role text not null default 'viewer'
        check (role in ('viewer', 'buyer', 'admin')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
    id uuid primary key default gen_random_uuid(),
    importer_id text unique,
    name text not null unique,
    eta_days integer,
    pick_up_location text,
    freight_forwarder text,
    order_frequency text,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.products (
    id uuid primary key default gen_random_uuid(),
    planning_sku text not null unique,
    product_code text,
    name text not null,
    vintage text,
    pack_size numeric,
    wine_category text,
    product_type text,
    brand_manager text,
    is_btg boolean not null default false,
    is_core boolean not null default false,
    supplier_id uuid references public.suppliers(id),
    current_fob numeric(12, 2),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.source_files (
    id uuid primary key default gen_random_uuid(),
    source_type text not null
        check (source_type in ('rb6_inventory', 'rads_sales', 'importers', 'quickbooks', 'manual_upload')),
    file_name text not null,
    storage_path text,
    content_type text,
    byte_size bigint,
    checksum text,
    received_at timestamptz not null default now(),
    uploaded_by uuid references auth.users(id),
    metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.report_runs (
    id uuid primary key default gen_random_uuid(),
    run_type text not null default 'manual_upload'
        check (run_type in ('manual_upload', 'scheduled_email', 'quickbooks_sync')),
    status text not null default 'pending'
        check (status in ('pending', 'running', 'completed', 'failed')),
    source_file_ids uuid[] not null default '{}',
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    error_message text,
    diagnostics jsonb not null default '{}'::jsonb,
    created_by uuid references auth.users(id)
);

create table if not exists public.inventory_snapshots (
    id uuid primary key default gen_random_uuid(),
    report_run_id uuid not null references public.report_runs(id) on delete cascade,
    product_id uuid not null references public.products(id),
    snapshot_date date not null,
    true_available numeric not null default 0,
    on_order numeric not null default 0,
    unconfirmed_line_item_qty numeric not null default 0,
    raw_row jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (report_run_id, product_id)
);

create table if not exists public.sales_history (
    id uuid primary key default gen_random_uuid(),
    source_file_id uuid references public.source_files(id),
    product_id uuid references public.products(id),
    invoice_date date not null,
    account_name text,
    quantity numeric not null,
    unit_price numeric(12, 2),
    invoice_number text,
    po_number text,
    raw_row jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.reorder_recommendations (
    id uuid primary key default gen_random_uuid(),
    report_run_id uuid not null references public.report_runs(id) on delete cascade,
    product_id uuid not null references public.products(id),
    supplier_id uuid references public.suppliers(id),
    last_30_day_sales numeric not null default 0,
    next_60_days_ly_sales numeric not null default 0,
    weekly_velocity numeric,
    weeks_on_hand numeric,
    weeks_on_hand_with_on_order numeric,
    target_days integer not null,
    target_qty numeric not null default 0,
    recommended_qty_raw numeric not null default 0,
    recommended_qty_rounded integer not null default 0,
    order_cost numeric(12, 2) not null default 0,
    reorder_status text not null
        check (reorder_status in ('URGENT', 'LOW', 'OK', 'NO SALES')),
    order_timing_risk text,
    diagnostics jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (report_run_id, product_id)
);

create table if not exists public.purchase_order_drafts (
    id uuid primary key default gen_random_uuid(),
    supplier_id uuid references public.suppliers(id),
    report_run_id uuid references public.report_runs(id),
    status text not null default 'draft'
        check (status in ('draft', 'ready_for_entry', 'entered_in_quickbooks', 'cancelled')),
    po_number text,
    quickbooks_purchase_order_id text,
    exported_file_path text,
    notes text,
    created_by uuid references auth.users(id),
    reviewed_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
    id uuid primary key default gen_random_uuid(),
    purchase_order_draft_id uuid not null references public.purchase_order_drafts(id) on delete cascade,
    recommendation_id uuid references public.reorder_recommendations(id),
    product_id uuid not null references public.products(id),
    recommended_qty integer not null default 0,
    approved_qty integer not null default 0,
    fob numeric(12, 2),
    line_cost numeric(12, 2),
    override_reason text,
    created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references auth.users(id),
    event_type text not null,
    entity_type text not null,
    entity_id uuid,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_products_supplier_id on public.products(supplier_id);
create index if not exists idx_inventory_snapshots_product_id on public.inventory_snapshots(product_id);
create index if not exists idx_sales_history_product_date on public.sales_history(product_id, invoice_date);
create index if not exists idx_recommendations_run_supplier on public.reorder_recommendations(report_run_id, supplier_id);
create index if not exists idx_po_drafts_supplier_status on public.purchase_order_drafts(supplier_id, status);

alter table public.app_profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.source_files enable row level security;
alter table public.report_runs enable row level security;
alter table public.inventory_snapshots enable row level security;
alter table public.sales_history enable row level security;
alter table public.reorder_recommendations enable row level security;
alter table public.purchase_order_drafts enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.audit_events enable row level security;

-- Initial internal-tool policies. Tighten these before external access.
create policy "authenticated users can read suppliers"
    on public.suppliers for select
    to authenticated
    using (true);

create policy "authenticated users can read products"
    on public.products for select
    to authenticated
    using (true);

create policy "authenticated users can read report runs"
    on public.report_runs for select
    to authenticated
    using (true);

create policy "authenticated users can read recommendations"
    on public.reorder_recommendations for select
    to authenticated
    using (true);

create policy "authenticated users can read purchase orders"
    on public.purchase_order_drafts for select
    to authenticated
    using (true);

create policy "authenticated users can read purchase order lines"
    on public.purchase_order_lines for select
    to authenticated
    using (true);

