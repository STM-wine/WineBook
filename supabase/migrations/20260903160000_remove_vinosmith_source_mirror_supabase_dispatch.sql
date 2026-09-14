-- GitHub Actions now owns the native schedule for the Vinosmith source mirror.
-- Remove the older Supabase-to-GitHub dispatcher so the refresh cannot run twice.

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
