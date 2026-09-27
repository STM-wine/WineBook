-- Historical read snapshots also depend on the finalized daily rollups.
create trigger read_model_invalidate after insert or update or delete or truncate
  on public.gross_profit_daily_rollups for each statement
  execute function public.invalidate_read_models('margins');

-- A rolling deployment must not let an older calculation implementation claim
-- a job labeled with a newer formula. Legacy no-argument callers claim nothing.
drop function public.claim_read_model();
create function public.claim_read_model(p_formulas jsonb default '{}'::jsonb)
returns public.read_model_jobs language plpgsql security definer set search_path = public as $$
declare j public.read_model_jobs;
begin
  select * into j from public.read_model_jobs
    where (status = 'queued' or (status = 'running' and lease_until < now()))
      and formula_version = p_formulas->>kind
    order by created_at for update skip locked limit 1;
  if j.id is null then return null; end if;
  update public.read_model_jobs set status = 'running', lease_token = gen_random_uuid(),
    lease_until = now() + interval '15 minutes', attempts = attempts + 1 where id = j.id returning * into j;
  return j;
end $$;
revoke all on function public.claim_read_model(jsonb) from public, anon, authenticated;
grant execute on function public.claim_read_model(jsonb) to service_role;
