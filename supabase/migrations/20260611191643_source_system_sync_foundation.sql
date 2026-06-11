-- Source-system synchronization foundation for making Stem the durable source of truth.
--
-- These tables are intentionally private to trusted workers for now. They capture
-- raw-response metadata, checkpoints, source IDs, and normalized API facts from
-- QuickBooks Desktop and Vinosmith without changing the current RB6/RADs email
-- production workflow.

create table if not exists public.source_sync_runs (
    id uuid primary key default gen_random_uuid(),
    source_system text not null
        check (source_system in ('quickbooks_desktop', 'vinosmith', 'email', 'manual', 'stem')),
    sync_type text not null
        check (sync_type in ('discovery', 'historical_backfill', 'daily_refresh', 'parity_check', 'manual_poc')),
    status text not null default 'pending'
        check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
    requested_start_date date,
    requested_end_date date,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    triggered_by uuid references auth.users(id),
    worker_name text,
    parameters jsonb not null default '{}'::jsonb,
    diagnostics jsonb not null default '{}'::jsonb,
    error_message text,
    created_at timestamptz not null default now(),
    check (requested_end_date is null or requested_start_date is null or requested_end_date >= requested_start_date)
);

create table if not exists public.source_api_responses (
    id uuid primary key default gen_random_uuid(),
    source_sync_run_id uuid references public.source_sync_runs(id),
    source_system text not null
        check (source_system in ('quickbooks_desktop', 'vinosmith', 'email', 'manual', 'stem')),
    endpoint text not null,
    request_method text not null default 'GET',
    request_identifier text,
    requested_params jsonb not null default '{}'::jsonb,
    returned_metadata jsonb not null default '{}'::jsonb,
    response_status integer,
    response_status_text text,
    content_type text,
    byte_size bigint,
    checksum text,
    raw_storage_path text,
    record_count integer,
    fetched_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create table if not exists public.source_sync_checkpoints (
    id uuid primary key default gen_random_uuid(),
    source_system text not null
        check (source_system in ('quickbooks_desktop', 'vinosmith', 'email', 'manual', 'stem')),
    resource_name text not null,
    checkpoint_key text not null,
    status text not null default 'pending'
        check (status in ('pending', 'running', 'completed', 'failed', 'needs_repair')),
    requested_start_date date,
    requested_end_date date,
    completed_through timestamptz,
    cursor_data jsonb not null default '{}'::jsonb,
    last_source_sync_run_id uuid references public.source_sync_runs(id),
    diagnostics jsonb not null default '{}'::jsonb,
    last_synced_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source_system, resource_name, checkpoint_key)
);

create table if not exists public.product_source_links (
    id uuid primary key default gen_random_uuid(),
    product_id uuid references public.products(id) on delete cascade,
    source_system text not null
        check (source_system in ('quickbooks_desktop', 'vinosmith', 'email', 'manual', 'stem')),
    source_entity_type text not null,
    source_id text not null,
    source_code text,
    source_name text,
    match_status text not null default 'unmapped'
        check (match_status in ('unmapped', 'candidate', 'matched', 'ignored', 'conflict')),
    confidence numeric(5, 4) not null default 0
        check (confidence >= 0 and confidence <= 1),
    is_primary boolean not null default false,
    metadata jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source_system, source_entity_type, source_id)
);

create table if not exists public.quickbooks_customers (
    list_id text primary key,
    edit_sequence text,
    name text,
    full_name text not null,
    is_active boolean,
    account_number text,
    terms_ref jsonb not null default '{}'::jsonb,
    balance numeric(14, 2),
    time_created timestamptz,
    time_modified timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.quickbooks_vendors (
    list_id text primary key,
    edit_sequence text,
    name text,
    full_name text not null,
    is_active boolean,
    account_number text,
    terms_ref jsonb not null default '{}'::jsonb,
    balance numeric(14, 2),
    time_created timestamptz,
    time_modified timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.quickbooks_items (
    list_id text primary key,
    edit_sequence text,
    item_type text,
    name text,
    full_name text not null,
    is_active boolean,
    sales_desc text,
    purchase_desc text,
    sales_price numeric(14, 4),
    purchase_cost numeric(14, 4),
    average_cost numeric(14, 4),
    quantity_on_hand numeric(18, 4),
    quantity_on_order numeric(18, 4),
    quantity_on_sales_order numeric(18, 4),
    income_account_ref jsonb not null default '{}'::jsonb,
    cogs_account_ref jsonb not null default '{}'::jsonb,
    asset_account_ref jsonb not null default '{}'::jsonb,
    custom_fields jsonb not null default '{}'::jsonb,
    time_created timestamptz,
    time_modified timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.quickbooks_inventory_snapshots (
    id uuid primary key default gen_random_uuid(),
    source_sync_run_id uuid references public.source_sync_runs(id),
    raw_response_id uuid references public.source_api_responses(id),
    snapshot_at timestamptz not null default now(),
    snapshot_date date not null default current_date,
    item_list_id text not null references public.quickbooks_items(list_id),
    quantity_on_hand numeric(18, 4),
    quantity_on_order numeric(18, 4),
    quantity_on_sales_order numeric(18, 4),
    average_cost numeric(14, 4),
    raw_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (source_sync_run_id, item_list_id)
);

create table if not exists public.quickbooks_invoices (
    txn_id text primary key,
    edit_sequence text,
    ref_number text,
    txn_date date,
    ship_date date,
    due_date date,
    customer_list_id text,
    customer_full_name text,
    terms_ref jsonb not null default '{}'::jsonb,
    sales_rep_ref jsonb not null default '{}'::jsonb,
    subtotal numeric(14, 2),
    total_amount numeric(14, 2),
    balance_remaining numeric(14, 2),
    is_paid boolean,
    is_pending boolean,
    is_void boolean not null default false,
    linked_txns jsonb not null default '[]'::jsonb,
    custom_fields jsonb not null default '{}'::jsonb,
    time_created timestamptz,
    time_modified timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.quickbooks_invoice_lines (
    id uuid primary key default gen_random_uuid(),
    txn_id text not null references public.quickbooks_invoices(txn_id) on delete cascade,
    txn_line_id text,
    line_sequence integer,
    item_list_id text,
    item_full_name text,
    description text,
    quantity numeric(18, 4),
    unit_of_measure text,
    rate numeric(14, 4),
    amount numeric(14, 2),
    class_ref jsonb not null default '{}'::jsonb,
    raw_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (txn_id, txn_line_id)
);

create table if not exists public.quickbooks_credit_memos (
    txn_id text primary key,
    edit_sequence text,
    ref_number text,
    txn_date date,
    customer_list_id text,
    customer_full_name text,
    subtotal numeric(14, 2),
    total_amount numeric(14, 2),
    linked_txns jsonb not null default '[]'::jsonb,
    custom_fields jsonb not null default '{}'::jsonb,
    time_created timestamptz,
    time_modified timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.quickbooks_credit_memo_lines (
    id uuid primary key default gen_random_uuid(),
    txn_id text not null references public.quickbooks_credit_memos(txn_id) on delete cascade,
    txn_line_id text,
    line_sequence integer,
    item_list_id text,
    item_full_name text,
    description text,
    quantity numeric(18, 4),
    unit_of_measure text,
    rate numeric(14, 4),
    amount numeric(14, 2),
    class_ref jsonb not null default '{}'::jsonb,
    raw_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (txn_id, txn_line_id)
);

create table if not exists public.quickbooks_receive_payments (
    txn_id text primary key,
    edit_sequence text,
    ref_number text,
    txn_date date,
    customer_list_id text,
    customer_full_name text,
    total_amount numeric(14, 2),
    payment_method_ref jsonb not null default '{}'::jsonb,
    deposit_to_account_ref jsonb not null default '{}'::jsonb,
    applied_txns jsonb not null default '[]'::jsonb,
    time_created timestamptz,
    time_modified timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.quickbooks_purchase_orders (
    txn_id text primary key,
    edit_sequence text,
    ref_number text,
    txn_date date,
    due_date date,
    expected_date date,
    vendor_list_id text,
    vendor_full_name text,
    subtotal numeric(14, 2),
    total_amount numeric(14, 2),
    is_fully_received boolean,
    linked_txns jsonb not null default '[]'::jsonb,
    custom_fields jsonb not null default '{}'::jsonb,
    time_created timestamptz,
    time_modified timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.quickbooks_purchase_order_lines (
    id uuid primary key default gen_random_uuid(),
    txn_id text not null references public.quickbooks_purchase_orders(txn_id) on delete cascade,
    txn_line_id text,
    line_sequence integer,
    item_list_id text,
    item_full_name text,
    description text,
    quantity numeric(18, 4),
    received_quantity numeric(18, 4),
    unit_of_measure text,
    rate numeric(14, 4),
    amount numeric(14, 2),
    class_ref jsonb not null default '{}'::jsonb,
    raw_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (txn_id, txn_line_id)
);

create table if not exists public.vinosmith_wines (
    wine_id text primary key,
    code text,
    name text,
    vintage text,
    supplier_id text,
    importer_name text,
    producer_name text,
    product_family text,
    unit_set numeric(18, 4),
    bottle_size text,
    bottle_size_label text,
    fob_price numeric(14, 4),
    external_identifier_1 text,
    category text,
    country text,
    region text,
    appellation text,
    vineyard text,
    about_info text,
    active boolean,
    orderable boolean,
    core boolean,
    admin_only boolean,
    inventory_item boolean,
    source_created_at timestamptz,
    source_updated_at timestamptz,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.vinosmith_prices (
    price_id text primary key,
    wine_id text references public.vinosmith_wines(wine_id),
    label text,
    price_type text,
    price_cents integer,
    bill_back_price_cents integer,
    bill_back_at timestamptz,
    effective_start_at timestamptz,
    effective_end_at timestamptz,
    active boolean,
    disabled boolean,
    is_default boolean,
    premise text,
    marketplace text,
    minimum_quantity numeric(18, 4),
    maximum_quantity numeric(18, 4),
    reference_discount numeric(10, 4),
    external_identifier text,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.vinosmith_inventory_snapshots (
    id uuid primary key default gen_random_uuid(),
    source_sync_run_id uuid references public.source_sync_runs(id),
    raw_response_id uuid references public.source_api_responses(id),
    snapshot_at timestamptz not null default now(),
    snapshot_date date not null default current_date,
    wine_id text not null references public.vinosmith_wines(wine_id),
    warehouse_id text,
    warehouse_name text,
    available numeric(18, 4),
    on_hand numeric(18, 4),
    on_hold numeric(18, 4),
    on_order numeric(18, 4),
    on_future numeric(18, 4),
    on_pending_sync numeric(18, 4),
    end_of_stock boolean,
    raw_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (source_sync_run_id, wine_id, warehouse_id)
);

create table if not exists public.vinosmith_order_headers (
    supplier_order_id text primary key,
    order_id text,
    account_id text,
    account_name text,
    user_id text,
    user_email text,
    user_full_name text,
    invoice_number text,
    po_number text,
    order_at timestamptz,
    confirmed_at timestamptz,
    delivery_at timestamptz,
    due_at timestamptz,
    paid_at timestamptz,
    delivery_status text,
    payment_status text,
    warehouse_id text,
    warehouse_name text,
    total_cents integer,
    balance_cents integer,
    raw_response_id uuid references public.source_api_responses(id),
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.vinosmith_order_lines (
    line_item_id text primary key,
    supplier_order_id text not null references public.vinosmith_order_headers(supplier_order_id) on delete cascade,
    wine_id text,
    wine_code text,
    wine_name text,
    vintage text,
    importer_name text,
    producer_name text,
    quantity_cases numeric(18, 4),
    unit_set numeric(18, 4),
    quantity_bottles numeric(18, 4),
    price_cents integer,
    total_cents integer,
    discount numeric(10, 4),
    manual_price boolean,
    commission_rate numeric(10, 4),
    notes text,
    raw_data jsonb not null default '{}'::jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create index if not exists idx_source_sync_runs_system_status
    on public.source_sync_runs(source_system, status, started_at desc);
create index if not exists idx_source_api_responses_run
    on public.source_api_responses(source_sync_run_id, endpoint);
create index if not exists idx_source_api_responses_system_endpoint
    on public.source_api_responses(source_system, endpoint, fetched_at desc);
create index if not exists idx_product_source_links_product
    on public.product_source_links(product_id);
create index if not exists idx_product_source_links_match
    on public.product_source_links(source_system, source_entity_type, match_status);

create index if not exists idx_quickbooks_items_full_name
    on public.quickbooks_items(full_name);
create index if not exists idx_quickbooks_invoices_txn_date
    on public.quickbooks_invoices(txn_date);
create index if not exists idx_quickbooks_invoices_ship_date
    on public.quickbooks_invoices(ship_date);
create index if not exists idx_quickbooks_invoices_customer
    on public.quickbooks_invoices(customer_list_id);
create index if not exists idx_quickbooks_invoice_lines_item
    on public.quickbooks_invoice_lines(item_list_id);
create index if not exists idx_quickbooks_credit_memos_txn_date
    on public.quickbooks_credit_memos(txn_date);
create index if not exists idx_quickbooks_credit_memo_lines_item
    on public.quickbooks_credit_memo_lines(item_list_id);
create index if not exists idx_quickbooks_purchase_orders_vendor
    on public.quickbooks_purchase_orders(vendor_list_id, txn_date);
create index if not exists idx_quickbooks_purchase_order_lines_item
    on public.quickbooks_purchase_order_lines(item_list_id);

create index if not exists idx_vinosmith_wines_code
    on public.vinosmith_wines(code);
create index if not exists idx_vinosmith_wines_importer
    on public.vinosmith_wines(importer_name);
create index if not exists idx_vinosmith_prices_wine
    on public.vinosmith_prices(wine_id);
create index if not exists idx_vinosmith_inventory_snapshots_date
    on public.vinosmith_inventory_snapshots(snapshot_date, wine_id);
create index if not exists idx_vinosmith_order_headers_delivery
    on public.vinosmith_order_headers(delivery_at, delivery_status);
create index if not exists idx_vinosmith_order_lines_wine
    on public.vinosmith_order_lines(wine_id);

alter table public.source_sync_runs enable row level security;
alter table public.source_api_responses enable row level security;
alter table public.source_sync_checkpoints enable row level security;
alter table public.product_source_links enable row level security;
alter table public.quickbooks_customers enable row level security;
alter table public.quickbooks_vendors enable row level security;
alter table public.quickbooks_items enable row level security;
alter table public.quickbooks_inventory_snapshots enable row level security;
alter table public.quickbooks_invoices enable row level security;
alter table public.quickbooks_invoice_lines enable row level security;
alter table public.quickbooks_credit_memos enable row level security;
alter table public.quickbooks_credit_memo_lines enable row level security;
alter table public.quickbooks_receive_payments enable row level security;
alter table public.quickbooks_purchase_orders enable row level security;
alter table public.quickbooks_purchase_order_lines enable row level security;
alter table public.vinosmith_wines enable row level security;
alter table public.vinosmith_prices enable row level security;
alter table public.vinosmith_inventory_snapshots enable row level security;
alter table public.vinosmith_order_headers enable row level security;
alter table public.vinosmith_order_lines enable row level security;

revoke all on table
    public.source_sync_runs,
    public.source_api_responses,
    public.source_sync_checkpoints,
    public.product_source_links,
    public.quickbooks_customers,
    public.quickbooks_vendors,
    public.quickbooks_items,
    public.quickbooks_inventory_snapshots,
    public.quickbooks_invoices,
    public.quickbooks_invoice_lines,
    public.quickbooks_credit_memos,
    public.quickbooks_credit_memo_lines,
    public.quickbooks_receive_payments,
    public.quickbooks_purchase_orders,
    public.quickbooks_purchase_order_lines,
    public.vinosmith_wines,
    public.vinosmith_prices,
    public.vinosmith_inventory_snapshots,
    public.vinosmith_order_headers,
    public.vinosmith_order_lines
from anon, authenticated;

grant select, insert, update, delete on table
    public.source_sync_runs,
    public.source_api_responses,
    public.source_sync_checkpoints,
    public.product_source_links,
    public.quickbooks_customers,
    public.quickbooks_vendors,
    public.quickbooks_items,
    public.quickbooks_inventory_snapshots,
    public.quickbooks_invoices,
    public.quickbooks_invoice_lines,
    public.quickbooks_credit_memos,
    public.quickbooks_credit_memo_lines,
    public.quickbooks_receive_payments,
    public.quickbooks_purchase_orders,
    public.quickbooks_purchase_order_lines,
    public.vinosmith_wines,
    public.vinosmith_prices,
    public.vinosmith_inventory_snapshots,
    public.vinosmith_order_headers,
    public.vinosmith_order_lines
to service_role;
