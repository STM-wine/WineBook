alter table if exists public.source_health_issue_workflows
    add column if not exists source_updated_at timestamptz,
    add column if not exists source_updated_by uuid references public.app_profiles(id),
    add column if not exists source_updated_by_name text;

create index if not exists idx_source_health_issue_workflows_source_updated_at
    on public.source_health_issue_workflows(source_updated_at desc);
