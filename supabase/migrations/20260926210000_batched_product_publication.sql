-- Keep large catalogs out of one PostgREST JSON request. Readers still require
-- a completed job, so uploading rows never exposes a partial snapshot.
create function public.stage_product_read_model(p_id uuid, p_token uuid, p_rows jsonb, p_reset boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare j public.read_model_jobs;
begin
  select * into strict j from public.read_model_jobs where id = p_id for update;
  if j.kind <> 'products' or j.status <> 'running' or j.lease_token is distinct from p_token or j.lease_until < now() then
    return false;
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    raise exception 'Product batches must contain at most 200 rows';
  end if;
  if p_reset then delete from public.product_workspace_records where snapshot_id = p_id; end if;
  insert into public.product_workspace_records(snapshot_id, id, record)
    select p_id, r->>'id', r from jsonb_array_elements(p_rows) r
    on conflict (snapshot_id, id) do update set record = excluded.record;
  return true;
end $$;

create function public.finish_product_read_model(p_id uuid, p_token uuid, p_count integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare j public.read_model_jobs; actual bigint;
begin
  select * into strict j from public.read_model_jobs where id = p_id for update;
  if j.kind <> 'products' or j.status <> 'running' or j.lease_token is distinct from p_token or j.lease_until < now() then
    return false;
  end if;
  select count(*) into actual from public.product_workspace_records where snapshot_id = p_id;
  if p_count is null or p_count < 0 or actual <> p_count then raise exception 'Incomplete product snapshot'; end if;
  -- Existing publisher atomically checks source epoch, business date and lease
  -- before marking the already-uploaded, complete row set readable.
  return public.publish_read_model(p_id, p_token, jsonb_build_object('rowCount', p_count), '[]'::jsonb);
end $$;

revoke all on function public.stage_product_read_model(uuid,uuid,jsonb,boolean),
  public.finish_product_read_model(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.stage_product_read_model(uuid,uuid,jsonb,boolean),
  public.finish_product_read_model(uuid,uuid,integer) to service_role;
