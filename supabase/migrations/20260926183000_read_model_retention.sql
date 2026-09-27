-- Keep pinned pages/exports usable for seven days; retain the newest completed
-- generation of each semantic range even if it is older. Missing expired pins fail explicitly.
create function public.prune_read_models() returns bigint
language plpgsql security definer set search_path = public as $$
declare removed bigint;
begin
  delete from public.read_model_jobs j where j.created_at < now() - interval '7 days'
    and j.status <> 'running'
    and j.id not in (
      select distinct on (kind, case when kind='ordering' then 'active' else cache_key end, formula_version) id
      from public.read_model_jobs where status='completed'
      order by kind, case when kind='ordering' then 'active' else cache_key end, formula_version, completed_at desc
    );
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function public.prune_read_models() from public, anon, authenticated;
grant execute on function public.prune_read_models() to service_role;
