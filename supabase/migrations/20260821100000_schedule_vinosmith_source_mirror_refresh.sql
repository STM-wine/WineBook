-- Supabase-owned scheduler for the live Vinosmith source mirror.
--
-- This refreshes the normalized Vinosmith wines, prices, and inventory cache
-- independently from the daily emailed RB6/RADs ingest. GitHub Actions remains
-- the worker; Supabase Cron remains the clock.

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
        where jobname = 'vinosmith-source-mirror-refresh'
    loop
        perform cron.unschedule(existing_job.jobid);
    end loop;
end $$;

select cron.schedule(
    'vinosmith-source-mirror-refresh',
    -- UTC schedule. Runs every 15 minutes around the clock.
    '*/15 * * * *',
    $$
    select net.http_post(
        url := 'https://api.github.com/repos/STM-wine/WineBook/actions/workflows/vinosmith-source-mirror-refresh.yml/dispatches',
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
        body := jsonb_build_object('ref', 'main')
    );
    $$
);
