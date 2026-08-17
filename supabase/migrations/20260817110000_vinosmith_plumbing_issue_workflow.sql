-- Stem-owned workflow state for source-health diagnostics.
--
-- This table tracks admin review work only. It does not write back to
-- Vinosmith, QuickBooks, or any source-system mirror.

create table if not exists public.source_health_issue_workflows (
    issue_key text primary key,
    source_system text not null default 'vinosmith'
        check (source_system in ('vinosmith', 'quickbooks_desktop', 'stem')),
    issue_type text not null,
    issue_title text not null,
    item_code text,
    product_name text,
    source_of_truth text not null,
    status text not null default 'needs_review'
        check (status in (
            'needs_review',
            'in_progress',
            'waiting_on_qb',
            'waiting_on_vs',
            'fixed_needs_resync',
            'ignored',
            'resolved'
        )),
    assigned_to text,
    admin_note text,
    last_reviewed_by uuid references public.app_profiles(id),
    last_reviewed_at timestamptz,
    resolved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_source_health_issue_workflows_status
    on public.source_health_issue_workflows(source_system, status);

create index if not exists idx_source_health_issue_workflows_updated_at
    on public.source_health_issue_workflows(updated_at desc);

alter table public.source_health_issue_workflows enable row level security;

grant select, insert, update, delete on table public.source_health_issue_workflows to service_role;
