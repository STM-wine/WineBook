-- Daily email ingestion support for scheduled Vinosmith report processing.

insert into storage.buckets (id, name, public)
values ('source-files', 'source-files', false)
on conflict (id) do nothing;

alter table public.report_runs
    add column if not exists report_date date,
    add column if not exists source_channel text not null default 'manual'
        check (source_channel in ('manual', 'email', 'quickbooks'));

create index if not exists idx_report_runs_daily_email
    on public.report_runs(report_date, status)
    where run_type = 'scheduled_email' and report_date is not null;

alter table public.source_files
    add column if not exists email_message_id text;

create index if not exists idx_source_files_email_message_id
    on public.source_files(email_message_id);
