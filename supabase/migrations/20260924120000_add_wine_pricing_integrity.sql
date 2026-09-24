-- Add Wine pricing state and concurrency protection.
-- The established save_supplier_catalog_sku function remains responsible for
-- the catalog, price-level, free-goods, and workbench mutations. The atomic
-- wrapper adds locking, idempotency, pricing metadata, and audit history in the
-- same database transaction.

alter table public.supplier_catalog_wines
    add column if not exists frontline_only boolean not null default false,
    add column if not exists lock_version bigint not null default 1,
    add column if not exists updated_by uuid references auth.users(id);

alter table public.supplier_catalog_price_levels
    add column if not exists is_manual_override boolean not null default false;

-- Existing saved levels are user-approved final values. Treat them as manual
-- so opening an older record cannot silently replace them with a new suggestion.
update public.supplier_catalog_price_levels
   set is_manual_override = true
 where is_manual_override = false;

create or replace function public.bump_supplier_catalog_wine_lock_version()
returns trigger
language plpgsql
as $$
begin
    new.lock_version := old.lock_version + 1;
    return new;
end;
$$;

drop trigger if exists trg_bump_supplier_catalog_wine_lock_version on public.supplier_catalog_wines;
create trigger trg_bump_supplier_catalog_wine_lock_version
before update on public.supplier_catalog_wines
for each row execute function public.bump_supplier_catalog_wine_lock_version();

create table if not exists public.supplier_catalog_save_requests (
    actor_id uuid not null references auth.users(id),
    idempotency_key uuid not null,
    request_hash text not null,
    response jsonb not null,
    created_at timestamptz not null default now(),
    primary key (actor_id, idempotency_key)
);

create table if not exists public.supplier_catalog_events (
    id uuid primary key default gen_random_uuid(),
    supplier_catalog_wine_id uuid not null references public.supplier_catalog_wines(id) on delete cascade,
    operation text not null check (operation in ('created', 'updated')),
    before_record jsonb,
    after_record jsonb not null,
    changed_by uuid not null default auth.uid() references auth.users(id),
    changed_at timestamptz not null default now(),
    idempotency_key uuid not null
);

create index if not exists idx_supplier_catalog_events_wine
    on public.supplier_catalog_events(supplier_catalog_wine_id, changed_at desc);

drop trigger if exists trg_supplier_catalog_save_requests_immutable on public.supplier_catalog_save_requests;
create trigger trg_supplier_catalog_save_requests_immutable
before update or delete on public.supplier_catalog_save_requests
for each row execute function public.prevent_immutable_business_event_change();

drop trigger if exists trg_supplier_catalog_events_immutable on public.supplier_catalog_events;
create trigger trg_supplier_catalog_events_immutable
before update or delete on public.supplier_catalog_events
for each row execute function public.prevent_immutable_business_event_change();

alter table public.supplier_catalog_save_requests enable row level security;
alter table public.supplier_catalog_events enable row level security;

grant select on public.supplier_catalog_save_requests to authenticated;
grant select on public.supplier_catalog_events to authenticated;
revoke insert, update, delete on public.supplier_catalog_save_requests from authenticated;
revoke insert, update, delete on public.supplier_catalog_events from authenticated;

drop policy if exists "buyers and admins can read catalog save requests" on public.supplier_catalog_save_requests;
create policy "buyers and admins can read catalog save requests"
    on public.supplier_catalog_save_requests for select to authenticated
    using (actor_id = (select auth.uid()));

drop policy if exists "buyers and admins can insert catalog save requests" on public.supplier_catalog_save_requests;

drop policy if exists "authenticated users can read catalog events" on public.supplier_catalog_events;
create policy "authenticated users can read catalog events"
    on public.supplier_catalog_events for select to authenticated using (true);

drop policy if exists "buyers and admins can insert catalog events" on public.supplier_catalog_events;

create or replace function public.save_supplier_catalog_sku_atomic(
    p_catalog jsonb,
    p_price_levels jsonb default '[]'::jsonb,
    p_free_goods jsonb default '[]'::jsonb,
    p_report_run_id uuid default null,
    p_expected_lock_version bigint default 0,
    p_idempotency_key uuid default null,
    p_request_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := (select auth.uid());
    v_existing public.supplier_catalog_wines%rowtype;
    v_saved public.supplier_catalog_wines%rowtype;
    v_result jsonb;
    v_replay public.supplier_catalog_save_requests%rowtype;
    v_level jsonb;
    v_price_change_created boolean := false;
    v_explicit_id uuid := nullif(p_catalog->>'id', '')::uuid;
    v_planning_sku text := nullif(p_catalog->>'planning_sku', '');
begin
    if v_actor is null then
        raise exception 'Sign in required.';
    end if;
    if p_idempotency_key is null or nullif(p_request_hash, '') is null then
        raise exception 'Idempotency key and request hash are required.';
    end if;
    if not exists (
        select 1 from public.app_profiles profile
         where profile.id = v_actor
           and profile.role in ('buyer', 'admin')
    ) then
        raise exception 'Buyer or admin access required.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0));
    select * into v_replay
      from public.supplier_catalog_save_requests
     where actor_id = v_actor and idempotency_key = p_idempotency_key;
    if found then
        if v_replay.request_hash <> p_request_hash then
            raise exception 'Idempotency key was already used for a different Add Wine request.';
        end if;
        return v_replay.response;
    end if;

    if v_planning_sku is null then
        raise exception 'Planning SKU is required.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_planning_sku, 1));
    if v_explicit_id is not null then
        perform pg_advisory_xact_lock(hashtextextended(v_explicit_id::text, 2));
    end if;

    if v_explicit_id is not null then
        select * into v_existing
          from public.supplier_catalog_wines
         where id = v_explicit_id
         for update;
        if not found then
            raise exception 'Supplier catalog wine not found for edit.';
        end if;
    else
        select * into v_existing
          from public.supplier_catalog_wines
         where planning_sku = v_planning_sku
         for update;
    end if;

    if v_existing.id is not null and coalesce(p_expected_lock_version, 0) <> v_existing.lock_version then
        raise exception 'This wine changed after you opened it. Refresh Add Wine and review the latest values before saving.';
    end if;
    if v_existing.id is null and coalesce(p_expected_lock_version, 0) <> 0 then
        raise exception 'This wine no longer exists in the version you opened. Refresh Add Wine before saving.';
    end if;

    select public.save_supplier_catalog_sku(
        p_catalog,
        p_price_levels,
        p_free_goods,
        p_report_run_id
    ) into v_result;

    update public.supplier_catalog_wines
       set pricing_model = coalesce(nullif(p_catalog->>'pricing_model', ''), 'standard'),
           fob_source_date = nullif(p_catalog->>'fob_source_date', '')::date,
           laid_in_source_date = nullif(p_catalog->>'laid_in_source_date', '')::date,
           pricing_calculated_at = now(),
           pricing_cost_fingerprint = nullif(p_catalog->>'pricing_cost_fingerprint', ''),
           frontline_only = coalesce((p_catalog->>'frontline_only')::boolean, false),
           updated_by = v_actor
     where id = (v_result->'saved'->>'id')::uuid
     returning * into v_saved;

    for v_level in select * from jsonb_array_elements(coalesce(p_price_levels, '[]'::jsonb))
    loop
        update public.supplier_catalog_price_levels
           set solve_for = coalesce(nullif(v_level->>'solve_for', ''), 'gp'),
               approval_decision = nullif(v_level->>'approval_decision', ''),
               suggested_price = nullif(v_level->>'suggested_price', '')::numeric,
               suggested_gp_margin = nullif(v_level->>'suggested_gp_margin', '')::numeric,
               da_alternative = nullif(v_level->>'da_alternative', '')::numeric,
               final_approved_price = nullif(v_level->>'final_approved_price', '')::numeric,
               final_approved_da = nullif(v_level->>'final_approved_da', '')::numeric,
               final_gp_margin = nullif(v_level->>'final_gp_margin', '')::numeric,
               is_manual_override = coalesce((v_level->>'is_manual_override')::boolean, false),
               override_reason = nullif(v_level->>'override_reason', ''),
               approval_owner = nullif(v_level->>'approval_owner', ''),
               decision_timestamp = nullif(v_level->>'decision_timestamp', '')::timestamptz,
               updated_at = now()
         where supplier_catalog_wine_id = v_saved.id
           and display_order = coalesce((v_level->>'display_order')::integer, 0);
    end loop;

    if v_existing.id is not null
       and coalesce(nullif(p_catalog->>'pricing_model', ''), 'standard') <> 'grw_broker'
       and (
           v_existing.fob_bottle is distinct from v_saved.fob_bottle
           or v_existing.frontline_bottle_price is distinct from v_saved.frontline_bottle_price
       ) then
        insert into public.price_change_events (
            supplier_catalog_wine_id, supplier, wine, vintage,
            old_fob, new_fob, old_frontline, new_frontline,
            old_best_price, new_best_price, margin_before, margin_after,
            effective_date, reason, status, fob_increase
        ) values (
            v_saved.id, v_saved.supplier_name, v_saved.display_name, v_saved.vintage,
            v_existing.fob_bottle, v_saved.fob_bottle,
            v_existing.frontline_bottle_price, v_saved.frontline_bottle_price,
            v_existing.best_price, v_saved.best_price,
            v_existing.gross_profit_margin, v_saved.gross_profit_margin,
            current_date, coalesce(nullif(p_catalog->>'price_change_reason', ''), 'Manual catalog update'),
            'draft', v_saved.fob_bottle > v_existing.fob_bottle
        );
        v_price_change_created := true;
    end if;

    insert into public.supplier_catalog_events (
        supplier_catalog_wine_id, operation, before_record, after_record, changed_by, idempotency_key
    ) values (
        v_saved.id,
        case when v_existing.id is null then 'created' else 'updated' end,
        case when v_existing.id is null then null else to_jsonb(v_existing) end,
        to_jsonb(v_saved),
        v_actor,
        p_idempotency_key
    );

    v_result := jsonb_build_object(
        'mode', case when v_existing.id is null then 'created' else 'updated' end,
        'saved', to_jsonb(v_saved),
        'previous', case when v_existing.id is null then null else to_jsonb(v_existing) end,
        'price_change_created', v_price_change_created
    );

    insert into public.supplier_catalog_save_requests (
        actor_id, idempotency_key, request_hash, response
    ) values (v_actor, p_idempotency_key, p_request_hash, v_result);

    return v_result;
end;
$$;

revoke all on function public.save_supplier_catalog_sku_atomic(jsonb, jsonb, jsonb, uuid, bigint, uuid, text) from public;
grant execute on function public.save_supplier_catalog_sku_atomic(jsonb, jsonb, jsonb, uuid, bigint, uuid, text) to authenticated;

-- The prior path cannot provide optimistic locking or idempotent replay. Fail
-- old Add Wine builds closed after this migration, matching the established
-- multi-buyer deployment model for version-aware write paths.
revoke execute on function public.save_supplier_catalog_sku(jsonb, jsonb, jsonb, uuid) from public;
revoke execute on function public.save_supplier_catalog_sku(jsonb, jsonb, jsonb, uuid) from authenticated;

notify pgrst, 'reload schema';
