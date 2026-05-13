-- Supabase-owned scheduler for the daily Vinosmith ingest.
--
-- GitHub Actions remains the worker, but GitHub's native schedule has proven
-- unreliable. This cron job uses Supabase's scheduler to call GitHub's
-- workflow_dispatch API during the morning ingestion window.
--
-- Before enabling this job, store a GitHub token in Supabase Vault:
--
--   select vault.create_secret(
--       '<fine-grained-github-token>',
--       'github_actions_dispatch_token',
--       'Token allowed to dispatch STM-wine/WineBook workflows'
--   );
--
-- Token permission needed for repository STM-wine/WineBook:
-- Actions: Read and write.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

do $$
declare
    existing_job record;
begin
    for existing_job in
        select jobid
        from cron.job
        where jobname = 'daily-vinosmith-github-dispatch'
    loop
        perform cron.unschedule(existing_job.jobid);
    end loop;
end $$;

select cron.schedule(
    'daily-vinosmith-github-dispatch',
    -- UTC schedule. These off-quarter-hour times cover 7am-12:59pm Mountain
    -- during daylight time; the worker skips once today's report is complete.
    '7,22,37,52 13-18 * * *',
    $$
    select net.http_post(
        url := 'https://api.github.com/repos/STM-wine/WineBook/actions/workflows/daily-vinosmith-ingest.yml/dispatches',
        headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || (
                select decrypted_secret
                from vault.decrypted_secrets
                where name = 'github_actions_dispatch_token'
                limit 1
            ),
            'Accept', 'application/vnd.github+json',
            'X-GitHub-Api-Version', '2022-11-28',
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'ref', 'main',
            'inputs', jsonb_build_object(
                'report_date', to_char(now() at time zone 'America/Denver', 'YYYY-MM-DD'),
                'force', 'false'
            )
        )
    );
    $$
);
