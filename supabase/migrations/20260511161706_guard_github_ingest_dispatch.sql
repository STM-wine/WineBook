-- Reschedule the daily Vinosmith ingest trigger so Supabase only dispatches
-- GitHub while the current Mountain-time report date still lacks a completed
-- scheduled_email report run.
--
-- This keeps Supabase as the reliable clock while avoiding repeated GitHub
-- Actions runs after the morning ingest has already succeeded.

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
    -- during daylight time. The SQL body suppresses dispatches after success.
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
    )
    where not exists (
        select 1
        from public.report_runs
        where run_type = 'scheduled_email'
            and report_date = (now() at time zone 'America/Denver')::date
            and status = 'completed'
    );
    $$
);
