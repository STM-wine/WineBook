-- Supplier Offer Compiler foundation.
--
-- This is a trust-first intermediate layer for messy supplier documents. It
-- stores source evidence, extracted fields, compiled offer candidates, match
-- suggestions, validation findings, pricing traces, and review tasks before any
-- approved data can be published to sales-facing offer surfaces or Supplier Hub.
--
-- Nothing in this migration writes to QuickBooks, VinoSmith, public.products,
-- or public.supplier_catalog_wines.

create table if not exists public.supplier_offer_documents (
    id uuid primary key default gen_random_uuid(),
    source_file_id uuid references public.source_files(id),
    supplier_id uuid references public.suppliers(id),
    supplier_name_snapshot text not null,
    original_filename text not null,
    content_type text,
    byte_size bigint,
    checksum text,
    storage_path text,
    document_type text not null default 'unknown'
        check (document_type in (
            'price_list',
            'inventory',
            'allocation',
            'closeout',
            'prearrival',
            'portfolio',
            'portal_export',
            'email_attachment',
            'unknown'
        )),
    document_type_confidence numeric(5, 4) not null default 0
        check (document_type_confidence >= 0 and document_type_confidence <= 1),
    document_status text not null default 'uploaded'
        check (document_status in (
            'uploaded',
            'parsing',
            'parsed',
            'needs_document_review',
            'ready_for_review',
            'approved',
            'published',
            'rejected',
            'failed'
        )),
    offer_date date,
    valid_until date,
    received_at timestamptz not null default now(),
    uploaded_by uuid references auth.users(id),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (valid_until is null or offer_date is null or valid_until >= offer_date)
);

create table if not exists public.supplier_offer_parse_runs (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.supplier_offer_documents(id) on delete cascade,
    parser_type text not null
        check (parser_type in ('xlsx', 'csv', 'pdf_text', 'pdf_ocr', 'manual')),
    parser_version text not null,
    status text not null default 'running'
        check (status in ('running', 'completed', 'failed')),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    diagnostics jsonb not null default '{}'::jsonb,
    error_message text
);

create table if not exists public.supplier_offer_extracted_rows (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.supplier_offer_documents(id) on delete cascade,
    parse_run_id uuid not null references public.supplier_offer_parse_runs(id) on delete cascade,
    source_kind text not null
        check (source_kind in ('spreadsheet_row', 'csv_row', 'pdf_table_row', 'email_block')),
    sheet_name text,
    row_number integer,
    page_number integer,
    region_ref jsonb not null default '{}'::jsonb,
    raw_row jsonb not null default '{}'::jsonb,
    raw_text text,
    row_confidence numeric(5, 4) not null default 0
        check (row_confidence >= 0 and row_confidence <= 1),
    is_skipped boolean not null default false,
    skip_reason text,
    created_at timestamptz not null default now()
);

create table if not exists public.supplier_offer_extracted_fields (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.supplier_offer_documents(id) on delete cascade,
    parse_run_id uuid not null references public.supplier_offer_parse_runs(id) on delete cascade,
    extracted_row_id uuid references public.supplier_offer_extracted_rows(id) on delete cascade,
    canonical_field text not null,
    source_header text,
    source_column text,
    source_cell_ref text,
    source_page integer,
    source_region jsonb not null default '{}'::jsonb,
    original_value text,
    normalized_value text,
    data_type text not null default 'text'
        check (data_type in ('text', 'number', 'money', 'date', 'boolean', 'json')),
    extraction_method text not null default 'header_mapping',
    confidence numeric(5, 4) not null default 0
        check (confidence >= 0 and confidence <= 1),
    review_status text not null default 'unreviewed'
        check (review_status in ('unreviewed', 'accepted', 'corrected', 'ignored', 'rejected')),
    reviewed_by uuid references auth.users(id),
    reviewed_at timestamptz,
    correction_value text,
    evidence jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.supplier_offer_candidates (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.supplier_offer_documents(id) on delete cascade,
    parse_run_id uuid not null references public.supplier_offer_parse_runs(id) on delete cascade,
    extracted_row_id uuid references public.supplier_offer_extracted_rows(id) on delete set null,
    supplier_id uuid references public.suppliers(id),
    supplier_name text not null,
    document_type text not null default 'unknown',
    producer text,
    wine_name text,
    vintage text,
    appellation text,
    region text,
    country text,
    grape text,
    bottle_size text,
    pack_size integer check (pack_size is null or pack_size >= 1),
    fob numeric(12, 2) check (fob is null or fob >= 0),
    wholesale_price numeric(12, 2) check (wholesale_price is null or wholesale_price >= 0),
    srp numeric(12, 2) check (srp is null or srp >= 0),
    quantity numeric(18, 4) check (quantity is null or quantity >= 0),
    arrival_date date,
    allocation_limit text,
    minimum_order text,
    discount text,
    deal_terms text,
    notes text,
    candidate_status text not null default 'compiled'
        check (candidate_status in ('compiled', 'needs_review', 'reviewed', 'approved', 'published', 'rejected')),
    overall_confidence numeric(5, 4) not null default 0
        check (overall_confidence >= 0 and overall_confidence <= 1),
    review_status text not null default 'needs_review'
        check (review_status in ('needs_review', 'in_review', 'approved', 'rejected', 'held')),
    published_status text not null default 'not_published'
        check (published_status in ('not_published', 'published_to_sales', 'published_to_supplier_hub')),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.supplier_offer_candidate_fields (
    id uuid primary key default gen_random_uuid(),
    candidate_id uuid not null references public.supplier_offer_candidates(id) on delete cascade,
    canonical_field text not null,
    selected_extracted_field_id uuid references public.supplier_offer_extracted_fields(id) on delete set null,
    original_value text,
    normalized_value text,
    final_value text,
    confidence numeric(5, 4) not null default 0
        check (confidence >= 0 and confidence <= 1),
    review_status text not null default 'unreviewed'
        check (review_status in ('unreviewed', 'accepted', 'corrected', 'ignored', 'rejected')),
    reviewed_by uuid references auth.users(id),
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (candidate_id, canonical_field)
);

create table if not exists public.supplier_offer_match_candidates (
    id uuid primary key default gen_random_uuid(),
    candidate_id uuid not null references public.supplier_offer_candidates(id) on delete cascade,
    source text not null
        check (source in ('supplier_catalog', 'product', 'quickbooks_item', 'vinosmith', 'recommendation')),
    source_id text not null,
    match_status text not null default 'likely_match_needs_review'
        check (match_status in (
            'exact_match',
            'likely_match_needs_review',
            'new_vintage_candidate',
            'new_wine_candidate',
            'possible_duplicate',
            'conflict',
            'ignored',
            'accepted'
        )),
    score numeric(5, 4) not null default 0
        check (score >= 0 and score <= 1),
    rank integer not null default 0,
    matched_display_name text,
    matched_supplier text,
    matched_vintage text,
    matched_pack_size integer,
    matched_bottle_size text,
    matched_fob numeric(12, 2),
    explanation jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (candidate_id, source, source_id)
);

create table if not exists public.supplier_offer_validation_results (
    id uuid primary key default gen_random_uuid(),
    candidate_id uuid not null references public.supplier_offer_candidates(id) on delete cascade,
    field_name text,
    rule_code text not null,
    severity text not null
        check (severity in ('blocker', 'warning', 'info')),
    message text not null,
    details jsonb not null default '{}'::jsonb,
    resolved boolean not null default false,
    resolved_by uuid references auth.users(id),
    resolved_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.supplier_offer_pricing_traces (
    id uuid primary key default gen_random_uuid(),
    candidate_id uuid not null references public.supplier_offer_candidates(id) on delete cascade,
    pricing_version text not null,
    currency text not null default 'USD',
    fob numeric(12, 2),
    freight numeric(12, 4),
    tax numeric(12, 4),
    landed_cost numeric(12, 4),
    target_gp numeric(8, 4),
    raw_wholesale numeric(12, 4),
    rounding_rule text,
    suggested_wholesale numeric(12, 2),
    suggested_frontline numeric(12, 2),
    deal_price numeric(12, 2),
    calculated_margin numeric(8, 4),
    trace_steps jsonb not null default '[]'::jsonb,
    warnings jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.supplier_offer_review_tasks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid references public.supplier_offer_documents(id) on delete cascade,
    candidate_id uuid references public.supplier_offer_candidates(id) on delete cascade,
    extracted_field_id uuid references public.supplier_offer_extracted_fields(id) on delete cascade,
    task_type text not null
        check (task_type in ('document_review', 'field_review', 'match_review', 'pricing_review', 'validation_review', 'publish_review')),
    severity text not null default 'warning'
        check (severity in ('blocker', 'warning', 'info')),
    status text not null default 'open'
        check (status in ('open', 'in_review', 'resolved', 'dismissed')),
    title text not null,
    description text,
    assigned_to uuid references auth.users(id),
    created_by_rule text,
    resolution text,
    resolved_by uuid references auth.users(id),
    resolved_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    check (document_id is not null or candidate_id is not null or extracted_field_id is not null)
);

create table if not exists public.approved_supplier_offers (
    id uuid primary key default gen_random_uuid(),
    candidate_id uuid not null unique references public.supplier_offer_candidates(id) on delete restrict,
    document_id uuid not null references public.supplier_offer_documents(id) on delete restrict,
    supplier_id uuid references public.suppliers(id),
    supplier_name text not null,
    producer text not null,
    wine_name text not null,
    vintage text not null default 'NV',
    appellation text,
    region text,
    country text,
    grape text,
    bottle_size text,
    pack_size integer check (pack_size is null or pack_size >= 1),
    fob numeric(12, 2),
    quantity numeric(18, 4),
    arrival_date date,
    offer_date date,
    valid_until date,
    notes text,
    approved_match_source text,
    approved_match_source_id text,
    approved_pricing_trace_id uuid references public.supplier_offer_pricing_traces(id) on delete set null,
    approval_status text not null default 'approved'
        check (approval_status in ('approved', 'published', 'expired', 'rejected')),
    published_to_sales boolean not null default false,
    published_at timestamptz,
    approved_by uuid references auth.users(id),
    approved_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.supplier_offer_publications (
    id uuid primary key default gen_random_uuid(),
    approved_offer_id uuid not null references public.approved_supplier_offers(id) on delete cascade,
    publication_type text not null
        check (publication_type in ('sales_offer_table', 'supplier_catalog_wine', 'excel_export', 'item_recommendation_export')),
    target_entity_type text,
    target_entity_id text,
    published_by uuid references auth.users(id),
    published_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.supplier_offer_supplier_rules (
    id uuid primary key default gen_random_uuid(),
    supplier_id uuid references public.suppliers(id),
    document_type text,
    rule_type text not null
        check (rule_type in ('header_row_hint', 'field_mapping', 'price_basis', 'ignore_row', 'default_value', 'normalization_hint')),
    scope text,
    rule_status text not null default 'suggested'
        check (rule_status in ('suggested', 'approved', 'rejected', 'disabled')),
    confidence numeric(5, 4) not null default 0
        check (confidence >= 0 and confidence <= 1),
    learned_from_review_count integer not null default 0 check (learned_from_review_count >= 0),
    definition jsonb not null default '{}'::jsonb,
    created_from_document_id uuid references public.supplier_offer_documents(id) on delete set null,
    created_by uuid references auth.users(id),
    approved_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.supplier_offer_field_mappings (
    id uuid primary key default gen_random_uuid(),
    supplier_id uuid references public.suppliers(id),
    document_type text,
    source_header_normalized text not null,
    canonical_field text not null,
    confidence numeric(5, 4) not null default 0
        check (confidence >= 0 and confidence <= 1),
    times_seen integer not null default 0 check (times_seen >= 0),
    times_confirmed integer not null default 0 check (times_confirmed >= 0),
    times_rejected integer not null default 0 check (times_rejected >= 0),
    last_seen_at timestamptz,
    status text not null default 'suggested'
        check (status in ('suggested', 'approved', 'rejected', 'disabled')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (supplier_id, document_type, source_header_normalized, canonical_field)
);

create table if not exists public.supplier_offer_compiler_events (
    id uuid primary key default gen_random_uuid(),
    document_id uuid references public.supplier_offer_documents(id) on delete cascade,
    candidate_id uuid references public.supplier_offer_candidates(id) on delete cascade,
    actor_id uuid references auth.users(id),
    event_type text not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_supplier_offer_documents_supplier_status
    on public.supplier_offer_documents(supplier_id, document_status, received_at desc);
create index if not exists idx_supplier_offer_parse_runs_document
    on public.supplier_offer_parse_runs(document_id, started_at desc);
create index if not exists idx_supplier_offer_rows_document
    on public.supplier_offer_extracted_rows(document_id, parse_run_id);
create index if not exists idx_supplier_offer_fields_row
    on public.supplier_offer_extracted_fields(extracted_row_id, canonical_field);
create index if not exists idx_supplier_offer_fields_document_confidence
    on public.supplier_offer_extracted_fields(document_id, confidence);
create index if not exists idx_supplier_offer_candidates_document_status
    on public.supplier_offer_candidates(document_id, review_status, candidate_status);
create index if not exists idx_supplier_offer_match_candidates_candidate
    on public.supplier_offer_match_candidates(candidate_id, rank);
create index if not exists idx_supplier_offer_validation_candidate
    on public.supplier_offer_validation_results(candidate_id, severity, resolved);
create index if not exists idx_supplier_offer_pricing_candidate
    on public.supplier_offer_pricing_traces(candidate_id, created_at desc);
create index if not exists idx_supplier_offer_review_tasks_queue
    on public.supplier_offer_review_tasks(status, severity, task_type, created_at);
create index if not exists idx_approved_supplier_offers_sales
    on public.approved_supplier_offers(published_to_sales, supplier_name, producer, wine_name);
create index if not exists idx_supplier_offer_rules_supplier
    on public.supplier_offer_supplier_rules(supplier_id, document_type, rule_type, rule_status);
create index if not exists idx_supplier_offer_field_mappings_supplier
    on public.supplier_offer_field_mappings(supplier_id, document_type, source_header_normalized, status);



grant select, insert on public.source_files to authenticated;

drop policy if exists "authenticated users can read supplier offer source files"
    on public.source_files;

create policy "authenticated users can read supplier offer source files"
    on public.source_files for select
    to authenticated
    using (metadata->>'compiler' = 'supplier_offer_compiler');

drop policy if exists "buyer and admin profiles can insert supplier offer source files"
    on public.source_files;

create policy "buyer and admin profiles can insert supplier offer source files"
    on public.source_files for insert
    to authenticated
    with check (
        source_type = 'manual_upload'
        and metadata->>'compiler' = 'supplier_offer_compiler'
        and exists (
            select 1 from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

alter table public.supplier_offer_documents enable row level security;
alter table public.supplier_offer_parse_runs enable row level security;
alter table public.supplier_offer_extracted_rows enable row level security;
alter table public.supplier_offer_extracted_fields enable row level security;
alter table public.supplier_offer_candidates enable row level security;
alter table public.supplier_offer_candidate_fields enable row level security;
alter table public.supplier_offer_match_candidates enable row level security;
alter table public.supplier_offer_validation_results enable row level security;
alter table public.supplier_offer_pricing_traces enable row level security;
alter table public.supplier_offer_review_tasks enable row level security;
alter table public.approved_supplier_offers enable row level security;
alter table public.supplier_offer_publications enable row level security;
alter table public.supplier_offer_supplier_rules enable row level security;
alter table public.supplier_offer_field_mappings enable row level security;
alter table public.supplier_offer_compiler_events enable row level security;

grant select, insert, update on table
    public.supplier_offer_documents,
    public.supplier_offer_parse_runs,
    public.supplier_offer_extracted_rows,
    public.supplier_offer_extracted_fields,
    public.supplier_offer_candidates,
    public.supplier_offer_candidate_fields,
    public.supplier_offer_match_candidates,
    public.supplier_offer_validation_results,
    public.supplier_offer_pricing_traces,
    public.supplier_offer_review_tasks,
    public.approved_supplier_offers,
    public.supplier_offer_publications,
    public.supplier_offer_supplier_rules,
    public.supplier_offer_field_mappings,
    public.supplier_offer_compiler_events
to authenticated;

create policy "authenticated users can read supplier offer compiler documents"
    on public.supplier_offer_documents for select
    to authenticated
    using (true);

create policy "buyer and admin profiles can manage supplier offer compiler documents"
    on public.supplier_offer_documents for all
    to authenticated
    using (
        exists (
            select 1 from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
        exists (
            select 1 from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

create policy "authenticated users can read supplier offer compiler rows"
    on public.supplier_offer_parse_runs for select to authenticated using (true);
create policy "authenticated users can read supplier offer extracted rows"
    on public.supplier_offer_extracted_rows for select to authenticated using (true);
create policy "authenticated users can read supplier offer extracted fields"
    on public.supplier_offer_extracted_fields for select to authenticated using (true);
create policy "authenticated users can read supplier offer candidates"
    on public.supplier_offer_candidates for select to authenticated using (true);
create policy "authenticated users can read supplier offer candidate fields"
    on public.supplier_offer_candidate_fields for select to authenticated using (true);
create policy "authenticated users can read supplier offer match candidates"
    on public.supplier_offer_match_candidates for select to authenticated using (true);
create policy "authenticated users can read supplier offer validation results"
    on public.supplier_offer_validation_results for select to authenticated using (true);
create policy "authenticated users can read supplier offer pricing traces"
    on public.supplier_offer_pricing_traces for select to authenticated using (true);
create policy "authenticated users can read supplier offer review tasks"
    on public.supplier_offer_review_tasks for select to authenticated using (true);
create policy "authenticated users can read approved supplier offers"
    on public.approved_supplier_offers for select to authenticated using (true);
create policy "authenticated users can read supplier offer publications"
    on public.supplier_offer_publications for select to authenticated using (true);
create policy "authenticated users can read supplier offer supplier rules"
    on public.supplier_offer_supplier_rules for select to authenticated using (true);
create policy "authenticated users can read supplier offer field mappings"
    on public.supplier_offer_field_mappings for select to authenticated using (true);
create policy "authenticated users can read supplier offer compiler events"
    on public.supplier_offer_compiler_events for select to authenticated using (true);

create policy "buyer and admin profiles can manage supplier offer compiler rows"
    on public.supplier_offer_parse_runs for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer extracted rows"
    on public.supplier_offer_extracted_rows for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer extracted fields"
    on public.supplier_offer_extracted_fields for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer candidates"
    on public.supplier_offer_candidates for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer candidate fields"
    on public.supplier_offer_candidate_fields for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer match candidates"
    on public.supplier_offer_match_candidates for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer validation results"
    on public.supplier_offer_validation_results for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer pricing traces"
    on public.supplier_offer_pricing_traces for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer review tasks"
    on public.supplier_offer_review_tasks for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage approved supplier offers"
    on public.approved_supplier_offers for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer publications"
    on public.supplier_offer_publications for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer supplier rules"
    on public.supplier_offer_supplier_rules for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can manage supplier offer field mappings"
    on public.supplier_offer_field_mappings for all to authenticated
    using (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')))
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));
create policy "buyer and admin profiles can create supplier offer compiler events"
    on public.supplier_offer_compiler_events for insert to authenticated
    with check (exists (select 1 from public.app_profiles profile where profile.id = (select auth.uid()) and profile.role in ('buyer', 'admin')));

notify pgrst, 'reload schema';
