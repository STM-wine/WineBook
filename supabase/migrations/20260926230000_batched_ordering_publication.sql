-- Avoid a multi-megabyte single publication statement. Staged supplier rows are
-- private until the job is completed with a matching, complete supplier set.
create function public.stage_ordering_read_model(p_id uuid, p_token uuid, p_suppliers jsonb, p_reset boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare j public.read_model_jobs;
begin
  select * into strict j from public.read_model_jobs where id=p_id for update;
  if j.kind <> 'ordering' or j.status <> 'running' or j.lease_token is distinct from p_token or j.lease_until < now() then return false; end if;
  if p_suppliers is null or jsonb_typeof(p_suppliers) <> 'array' or jsonb_array_length(p_suppliers) > 20 then raise exception 'Ordering batches must contain at most 20 suppliers'; end if;
  if p_reset then delete from public.ordering_workspace_suppliers where snapshot_id=p_id; end if;
  insert into public.ordering_workspace_suppliers(snapshot_id,supplier,data)
    select p_id,s->>'supplier',s->'data' from jsonb_array_elements(p_suppliers) s
    on conflict(snapshot_id,supplier) do update set data=excluded.data;
  return true;
end $$;

create function public.finish_ordering_read_model(p_id uuid, p_token uuid, p_result jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare j public.read_model_jobs; expected integer; actual integer;
begin
  select * into strict j from public.read_model_jobs where id=p_id for update;
  if j.kind <> 'ordering' or j.status <> 'running' or j.lease_token is distinct from p_token or j.lease_until < now() then return false; end if;
  if p_result->'groups' is null or jsonb_typeof(p_result->'groups') <> 'array' then raise exception 'Supplier summary required'; end if;
  expected := jsonb_array_length(p_result->'groups');
  select count(*) into actual from public.ordering_workspace_suppliers where snapshot_id=p_id;
  if actual <> expected or exists (
    select 1 from jsonb_array_elements(p_result->'groups') g
    where not exists(select 1 from public.ordering_workspace_suppliers s where s.snapshot_id=p_id and s.supplier=g->>'supplier')
  ) or (select count(distinct g->>'supplier') from jsonb_array_elements(p_result->'groups') g) <> expected then
    raise exception 'Incomplete ordering snapshot';
  end if;
  -- Publication still checks lease, source epoch and business date atomically.
  return public.publish_read_model(p_id,p_token,p_result,null);
end $$;
revoke all on function public.stage_ordering_read_model(uuid,uuid,jsonb,boolean), public.finish_ordering_read_model(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.stage_ordering_read_model(uuid,uuid,jsonb,boolean), public.finish_ordering_read_model(uuid,uuid,jsonb) to service_role;
