-- Multi-buyer ordering integrity.
--
-- This migration intentionally makes old direct approval writes fail closed.
-- New application code writes approvals through save_order_approvals(), which
-- validates the version the buyer originally read and commits a whole batch or
-- none of it.

alter table public.reorder_recommendations
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists updated_by uuid references auth.users(id),
    add column if not exists lock_version bigint not null default 1;

alter table public.supplier_catalog_workbench_items
    add column if not exists updated_by uuid references auth.users(id),
    add column if not exists lock_version bigint not null default 1;

update public.reorder_recommendations
set updated_at = coalesce(updated_at, created_at, now()),
    lock_version = greatest(coalesce(lock_version, 1), 1);

update public.supplier_catalog_workbench_items
set updated_at = coalesce(updated_at, created_at, now()),
    updated_by = coalesce(updated_by, created_by),
    lock_version = greatest(coalesce(lock_version, 1), 1);

create table if not exists public.approval_events (
    id uuid primary key default gen_random_uuid(),
    report_run_id uuid not null references public.report_runs(id) on delete cascade,
    source_type text not null check (source_type in ('recommendation', 'catalog_workbench')),
    source_id uuid not null,
    recommendation_status text not null
        check (recommendation_status in ('rejected', 'approved', 'edited', 'deferred')),
    approved_qty integer not null,
    source_lock_version bigint not null,
    actor_id uuid references auth.users(id),
    created_at timestamptz not null default now()
);

create index if not exists idx_approval_events_source
    on public.approval_events(source_type, source_id, created_at desc);

create index if not exists idx_approval_events_report
    on public.approval_events(report_run_id, created_at desc);

insert into public.approval_events (
    report_run_id, source_type, source_id, recommendation_status,
    approved_qty, source_lock_version, actor_id, created_at
)
select report_run_id, 'recommendation', id, recommendation_status,
       approved_qty, lock_version, updated_by, updated_at
from public.reorder_recommendations recommendation
where not exists (
    select 1 from public.approval_events event
    where event.source_type = 'recommendation' and event.source_id = recommendation.id
);

insert into public.approval_events (
    report_run_id, source_type, source_id, recommendation_status,
    approved_qty, source_lock_version, actor_id, created_at
)
select report_run_id, 'catalog_workbench', id, recommendation_status,
       approved_qty, lock_version, coalesce(updated_by, created_by), updated_at
from public.supplier_catalog_workbench_items workbench
where report_run_id is not null
  and not exists (
      select 1 from public.approval_events event
      where event.source_type = 'catalog_workbench' and event.source_id = workbench.id
  );

create or replace function public.guard_versioned_approval_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'INSERT'
       and (new.recommendation_status <> 'rejected' or new.approved_qty <> 0)
       and current_user <> 'service_role'
       and coalesce(current_setting('app.versioned_approval_write', true), '') <> 'on' then
        raise exception using
            errcode = '40001',
            message = 'Approval created without the versioned workflow. Refresh and retry.';
    end if;
    if tg_op = 'UPDATE' and (
       new.recommendation_status is distinct from old.recommendation_status
       or new.approved_qty is distinct from old.approved_qty) then
        if coalesce(current_setting('app.versioned_approval_write', true), '') <> 'on' then
            raise exception using
                errcode = '40001',
                message = 'Approval changed without optimistic concurrency control. Refresh and retry.';
        end if;
    end if;

    if tg_op = 'UPDATE' and new is distinct from old then
        new.lock_version := old.lock_version + 1;
        new.updated_at := clock_timestamp();
        new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
    end if;
    return new;
end;
$$;

drop trigger if exists trg_recommendation_approval_version on public.reorder_recommendations;
create trigger trg_recommendation_approval_version
before insert or update on public.reorder_recommendations
for each row execute function public.guard_versioned_approval_write();

drop trigger if exists trg_catalog_workbench_approval_version on public.supplier_catalog_workbench_items;
create trigger trg_catalog_workbench_approval_version
before insert or update on public.supplier_catalog_workbench_items
for each row execute function public.guard_versioned_approval_write();

create or replace function public.prevent_immutable_business_event_change()
returns trigger
language plpgsql
as $$
begin
    raise exception 'Business history records are immutable';
end;
$$;

drop trigger if exists trg_approval_events_immutable on public.approval_events;
create trigger trg_approval_events_immutable
before update or delete on public.approval_events
for each row execute function public.prevent_immutable_business_event_change();

alter table public.approval_events enable row level security;
grant select on public.approval_events to authenticated;

drop policy if exists "authenticated users can read approval events" on public.approval_events;
create policy "authenticated users can read approval events"
    on public.approval_events for select to authenticated using (true);

create or replace function public.save_order_approvals(p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
    v_update jsonb;
    v_source_type text;
    v_source_id uuid;
    v_workbench_id uuid;
    v_report_run_id uuid;
    v_status text;
    v_approved_qty integer;
    v_current_status text;
    v_current_qty integer;
    v_current_version bigint;
    v_current_updated_at timestamptz;
    v_current_updated_by uuid;
    v_expected_version bigint;
    v_conflicts jsonb := '[]'::jsonb;
    v_saved jsonb := '[]'::jsonb;
begin
    if v_actor is null or not exists (
        select 1 from public.app_profiles
        where id = v_actor and role in ('buyer', 'admin')
    ) then
        raise exception 'Buyer or admin access required' using errcode = '42501';
    end if;

    if jsonb_typeof(p_updates) <> 'array' or jsonb_array_length(p_updates) = 0 then
        return jsonb_build_object('ok', true, 'saved', '[]'::jsonb, 'conflicts', '[]'::jsonb);
    end if;

    if exists (
        select 1
        from (
            select value->>'sourceType' as source_type,
                   coalesce(value->>'id', value->>'supplierCatalogWineId') as source_key,
                   count(*)
            from jsonb_array_elements(p_updates)
            group by 1, 2
            having count(*) > 1
        ) duplicate
    ) then
        raise exception 'Approval batch contains duplicate rows';
    end if;

    -- Lock and validate in a stable order so concurrent batches cannot deadlock.
    for v_update in
        select value
        from jsonb_array_elements(p_updates)
        order by value->>'sourceType', coalesce(value->>'id', value->>'supplierCatalogWineId')
    loop
        v_source_type := v_update->>'sourceType';
        v_source_id := null;
        v_workbench_id := null;
        v_report_run_id := null;
        v_current_status := null;
        v_current_qty := null;
        v_current_version := null;
        v_current_updated_at := null;
        v_current_updated_by := null;
        v_status := v_update->>'recommendationStatus';
        v_approved_qty := greatest(0, coalesce((v_update->>'approvedQty')::integer, 0));
        v_expected_version := greatest(0, coalesce((v_update->>'expectedLockVersion')::bigint, 0));

        if v_status not in ('rejected', 'approved', 'edited', 'deferred') then
            raise exception 'Unsupported recommendation status';
        end if;

        if v_source_type = 'recommendation' then
            v_source_id := (v_update->>'id')::uuid;
            select report_run_id, recommendation_status, approved_qty, lock_version, updated_at, updated_by
            into v_report_run_id, v_current_status, v_current_qty, v_current_version,
                 v_current_updated_at, v_current_updated_by
            from public.reorder_recommendations
            where id = v_source_id
            for update;
        elsif v_source_type = 'catalog_workbench' then
            v_workbench_id := nullif(v_update->>'id', '')::uuid;
            if v_workbench_id is null then
                select id, report_run_id, recommendation_status, approved_qty, lock_version, updated_at, updated_by
                into v_workbench_id, v_report_run_id, v_current_status, v_current_qty,
                     v_current_version, v_current_updated_at, v_current_updated_by
                from public.supplier_catalog_workbench_items
                where report_run_id = (v_update->>'reportRunId')::uuid
                  and supplier_catalog_wine_id = (v_update->>'supplierCatalogWineId')::uuid
                for update;
            else
                select id, report_run_id, recommendation_status, approved_qty, lock_version, updated_at, updated_by
                into v_workbench_id, v_report_run_id, v_current_status, v_current_qty,
                     v_current_version, v_current_updated_at, v_current_updated_by
                from public.supplier_catalog_workbench_items
                where id = v_workbench_id
                for update;
            end if;

            if v_workbench_id is null and v_expected_version = 0 then
                -- A catalog wine can be visible before it has a workbench row.
                -- Treat version zero as a valid not-yet-created row, but do not
                -- insert it until the entire batch has passed validation.
                v_report_run_id := (v_update->>'reportRunId')::uuid;
                v_current_status := 'rejected';
                v_current_qty := 0;
                v_current_version := 0;
            end if;
            v_source_id := v_workbench_id;
        else
            raise exception 'Unsupported approval source type';
        end if;

        if v_source_id is null and not (v_source_type = 'catalog_workbench' and v_expected_version = 0) then
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'sourceType', v_source_type,
                'id', v_update->>'id',
                'reason', 'not_found'
            ));
        elsif v_current_version <> v_expected_version then
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'sourceType', v_source_type,
                'id', v_source_id,
                'reason', 'version_conflict',
                'currentStatus', v_current_status,
                'currentApprovedQty', v_current_qty,
                'currentLockVersion', v_current_version,
                'updatedAt', v_current_updated_at,
                'updatedBy', v_current_updated_by,
                'updatedByName', (select coalesce(full_name, email) from public.app_profiles where id = v_current_updated_by)
            ));
        end if;
    end loop;

    if jsonb_array_length(v_conflicts) > 0 then
        return jsonb_build_object('ok', false, 'saved', '[]'::jsonb, 'conflicts', v_conflicts);
    end if;

    perform set_config('app.versioned_approval_write', 'on', true);

    for v_update in
        select value
        from jsonb_array_elements(p_updates)
        order by value->>'sourceType', coalesce(value->>'id', value->>'supplierCatalogWineId')
    loop
        v_source_type := v_update->>'sourceType';
        v_status := v_update->>'recommendationStatus';
        v_approved_qty := greatest(0, coalesce((v_update->>'approvedQty')::integer, 0));

        if v_source_type = 'recommendation' then
            v_source_id := (v_update->>'id')::uuid;
            update public.reorder_recommendations
            set recommendation_status = v_status,
                approved_qty = v_approved_qty,
                order_path = coalesce(nullif(v_update->>'orderPath', ''), order_path),
                updated_by = v_actor
            where id = v_source_id
            returning report_run_id, lock_version, updated_at
            into v_report_run_id, v_current_version, v_current_updated_at;
        else
            v_workbench_id := nullif(v_update->>'id', '')::uuid;
            if v_workbench_id is null then
                select id into v_workbench_id
                from public.supplier_catalog_workbench_items
                where report_run_id = (v_update->>'reportRunId')::uuid
                  and supplier_catalog_wine_id = (v_update->>'supplierCatalogWineId')::uuid;
            end if;
            if v_workbench_id is null then
                insert into public.supplier_catalog_workbench_items (
                    report_run_id, supplier_catalog_wine_id, recommendation_status,
                    recommended_qty, approved_qty, order_path, active,
                    created_by, updated_by, lock_version
                ) values (
                    (v_update->>'reportRunId')::uuid,
                    (v_update->>'supplierCatalogWineId')::uuid,
                    v_status,
                    greatest(0, coalesce((v_update->>'recommendedQty')::integer, 0)),
                    v_approved_qty,
                    coalesce(nullif(v_update->>'orderPath', ''), 'stateside'),
                    true, v_actor, v_actor, 1
                )
                returning id, report_run_id, lock_version, updated_at
                into v_source_id, v_report_run_id, v_current_version, v_current_updated_at;
            else
                v_source_id := v_workbench_id;
                update public.supplier_catalog_workbench_items
                set recommendation_status = v_status,
                    approved_qty = v_approved_qty,
                    recommended_qty = coalesce((v_update->>'recommendedQty')::integer, recommended_qty),
                    order_path = coalesce(nullif(v_update->>'orderPath', ''), order_path),
                    active = true,
                    updated_by = v_actor
                where id = v_source_id
                returning report_run_id, lock_version, updated_at
                into v_report_run_id, v_current_version, v_current_updated_at;
            end if;
        end if;

        insert into public.approval_events (
            report_run_id, source_type, source_id, recommendation_status,
            approved_qty, source_lock_version, actor_id, created_at
        ) values (
            v_report_run_id, v_source_type, v_source_id, v_status,
            v_approved_qty, v_current_version, v_actor, v_current_updated_at
        );

        v_saved := v_saved || jsonb_build_array(jsonb_build_object(
            'sourceType', v_source_type,
            'id', v_source_id,
            'supplierCatalogWineId', v_update->>'supplierCatalogWineId',
            'recommendationStatus', v_status,
            'approvedQty', v_approved_qty,
            'lockVersion', v_current_version,
            'updatedAt', v_current_updated_at,
            'updatedBy', v_actor,
            'updatedByName', (select coalesce(full_name, email) from public.app_profiles where id = v_actor)
        ));
    end loop;

    return jsonb_build_object('ok', true, 'saved', v_saved, 'conflicts', '[]'::jsonb);
end;
$$;

revoke all on function public.save_order_approvals(jsonb) from public;
grant execute on function public.save_order_approvals(jsonb) to authenticated;

create or replace function public.carry_forward_supplier_workbench_items(
    p_previous_report_run_id uuid,
    p_next_report_run_id uuid,
    p_excluded_catalog_wine_ids uuid[] default '{}'::uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    perform set_config('app.versioned_approval_write', 'on', true);
    insert into public.supplier_catalog_workbench_items (
        report_run_id, supplier_catalog_wine_id, recommendation_status,
        recommended_qty, approved_qty, order_path, active, notes,
        created_by, updated_by, lock_version, created_at, updated_at
    )
    select p_next_report_run_id, source.supplier_catalog_wine_id,
           source.recommendation_status, source.recommended_qty,
           source.approved_qty, source.order_path, source.active,
           source.notes, source.created_by, source.updated_by,
           1, now(), now()
    from public.supplier_catalog_workbench_items source
    where source.report_run_id = p_previous_report_run_id
      and source.active = true
      and not (source.supplier_catalog_wine_id = any(coalesce(p_excluded_catalog_wine_ids, '{}'::uuid[])))
    on conflict (report_run_id, supplier_catalog_wine_id) do nothing;
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

revoke all on function public.carry_forward_supplier_workbench_items(uuid, uuid, uuid[]) from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'grant execute on function public.carry_forward_supplier_workbench_items(uuid, uuid, uuid[]) to service_role';
    end if;
end $$;

-- Define the PO revision structures before compiling the transactional
-- functions that reference their row types. Backfill and constraints follow.
alter table public.purchase_order_drafts
    add column if not exists order_path text not null default 'stateside'
        check (order_path in ('stateside', 'di')),
    add column if not exists revision_no integer not null default 0,
    add column if not exists content_hash text,
    add column if not exists last_exported_at timestamptz,
    add column if not exists last_exported_by uuid references auth.users(id);

alter table public.purchase_order_lines
    add column if not exists source_type text
        check (source_type in ('recommendation', 'catalog_workbench')),
    add column if not exists source_id uuid,
    add column if not exists source_lock_version bigint;

create table if not exists public.purchase_order_draft_revisions (
    id uuid primary key default gen_random_uuid(),
    purchase_order_draft_id uuid not null references public.purchase_order_drafts(id) on delete cascade,
    revision_no integer not null check (revision_no > 0),
    content_hash text not null,
    draft_snapshot jsonb not null,
    lines_snapshot jsonb not null,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    unique (purchase_order_draft_id, revision_no)
);

create table if not exists public.purchase_order_request_keys (
    idempotency_key uuid primary key,
    report_run_id uuid not null references public.report_runs(id) on delete cascade,
    actor_id uuid not null references auth.users(id),
    request_hash text not null,
    result jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists public.approval_commitments (
    id uuid primary key default gen_random_uuid(),
    report_run_id uuid not null references public.report_runs(id) on delete cascade,
    source_type text not null check (source_type in ('recommendation', 'catalog_workbench')),
    source_id uuid not null,
    source_lock_version bigint not null,
    purchase_order_draft_id uuid not null references public.purchase_order_drafts(id),
    draft_revision_no integer not null,
    quantity integer not null,
    actor_id uuid references auth.users(id),
    created_at timestamptz not null default now(),
    unique (purchase_order_draft_id, draft_revision_no, source_type, source_id)
);

create or replace function public.create_purchase_order_drafts_atomic(
    p_report_run_id uuid,
    p_idempotency_key uuid,
    p_request_hash text,
    p_approval_manifest jsonb,
    p_groups jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
    v_existing_request public.purchase_order_request_keys%rowtype;
    v_manifest jsonb;
    v_group jsonb;
    v_line jsonb;
    v_effective_lines jsonb;
    v_conflicts jsonb := '[]'::jsonb;
    v_result jsonb := jsonb_build_object('ok', true, 'created', '[]'::jsonb, 'updated', '[]'::jsonb, 'skipped', '[]'::jsonb);
    v_source_type text;
    v_source_id uuid;
    v_current_status text;
    v_current_qty integer;
    v_current_version bigint;
    v_current_updated_at timestamptz;
    v_current_updated_by uuid;
    v_expected_count integer;
    v_current_count integer;
    v_supplier text;
    v_order_path text;
    v_ordering_source text;
    v_draft public.purchase_order_drafts%rowtype;
    v_revision integer;
    v_content_hash text;
    v_committed_qty integer;
    v_delta_qty integer;
    v_line_snapshot jsonb;
    v_draft_snapshot jsonb;
    v_line_id uuid;
    v_fob numeric;
    v_trucking numeric;
begin
    if v_actor is null or not exists (
        select 1 from public.app_profiles
        where id = v_actor and role in ('buyer', 'admin')
    ) then
        raise exception 'Buyer or admin access required' using errcode = '42501';
    end if;

    if p_report_run_id is null or p_idempotency_key is null or coalesce(p_request_hash, '') = '' then
        raise exception 'Report run, idempotency key, and request hash are required';
    end if;
    if jsonb_typeof(p_approval_manifest) <> 'array' or jsonb_typeof(p_groups) <> 'array' then
        raise exception 'Approval manifest and PO groups must be arrays';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_report_run_id::text, 9173));
    perform set_config('app.versioned_po_status_write', 'on', true);
    perform set_config('app.versioned_po_line_write', 'on', true);

    select * into v_existing_request
    from public.purchase_order_request_keys
    where idempotency_key = p_idempotency_key;
    if found then
        if v_existing_request.report_run_id <> p_report_run_id
           or v_existing_request.request_hash <> p_request_hash then
            raise exception 'Idempotency key was already used for a different request';
        end if;
        return v_existing_request.result;
    end if;

    v_expected_count := jsonb_array_length(p_approval_manifest);
    select
        (select count(*) from public.reorder_recommendations
         where report_run_id = p_report_run_id
           and (
               (recommendation_status in ('approved', 'edited') and approved_qty > 0)
               or exists (
                   select 1 from public.approval_commitments commitment
                   where commitment.report_run_id = p_report_run_id
                     and commitment.source_type = 'recommendation'
                     and commitment.source_id = reorder_recommendations.id
               )
           ))
        +
        (select count(*) from public.supplier_catalog_workbench_items
         where report_run_id = p_report_run_id and active = true
           and (
               (recommendation_status in ('approved', 'edited') and approved_qty > 0)
               or exists (
                   select 1 from public.approval_commitments commitment
                   where commitment.report_run_id = p_report_run_id
                     and commitment.source_type = 'catalog_workbench'
                     and commitment.source_id = supplier_catalog_workbench_items.id
               )
           ))
    into v_current_count;

    if v_current_count <> v_expected_count then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'reason', 'approval_set_changed',
            'expectedCount', v_expected_count,
            'currentCount', v_current_count
        ));
    end if;

    for v_manifest in
        select value from jsonb_array_elements(p_approval_manifest)
        order by value->>'sourceType', value->>'sourceId'
    loop
        v_source_type := v_manifest->>'sourceType';
        v_source_id := (v_manifest->>'sourceId')::uuid;
        if v_source_type = 'recommendation' then
            select recommendation_status, approved_qty, lock_version, updated_at, updated_by
            into v_current_status, v_current_qty, v_current_version, v_current_updated_at, v_current_updated_by
            from public.reorder_recommendations
            where id = v_source_id and report_run_id = p_report_run_id
            for update;
        elsif v_source_type = 'catalog_workbench' then
            select recommendation_status, approved_qty, lock_version, updated_at, updated_by
            into v_current_status, v_current_qty, v_current_version, v_current_updated_at, v_current_updated_by
            from public.supplier_catalog_workbench_items
            where id = v_source_id and report_run_id = p_report_run_id and active = true
            for update;
        else
            raise exception 'Unsupported approval source type in manifest';
        end if;

        if not found
           or v_current_status <> (v_manifest->>'recommendationStatus')
           or v_current_qty <> (v_manifest->>'approvedQty')::integer
           or v_current_version <> (v_manifest->>'lockVersion')::bigint then
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'sourceType', v_source_type,
                'sourceId', v_source_id,
                'reason', case when not found then 'not_found' else 'version_conflict' end,
                'currentStatus', v_current_status,
                'currentApprovedQty', v_current_qty,
                'currentLockVersion', v_current_version,
                'updatedAt', v_current_updated_at,
                'updatedBy', v_current_updated_by,
                'updatedByName', (select coalesce(full_name, email) from public.app_profiles where id = v_current_updated_by)
            ));
        end if;
    end loop;

    if jsonb_array_length(v_conflicts) > 0 then
        return jsonb_build_object('ok', false, 'conflicts', v_conflicts);
    end if;

    for v_group in select value from jsonb_array_elements(p_groups)
    loop
        v_draft := null;
        v_supplier := btrim(coalesce(v_group->>'supplier', 'Unassigned'));
        v_order_path := coalesce(nullif(v_group->>'orderPath', ''), 'stateside');
        v_ordering_source := coalesce(nullif(v_group->>'orderingSource', ''), 'report');
        if v_order_path not in ('stateside', 'di') then
            raise exception 'Unsupported PO order path';
        end if;

        v_effective_lines := '[]'::jsonb;
        for v_line in
            select value from jsonb_array_elements(coalesce(v_group->'lines', '[]'::jsonb))
            order by value->>'sourceType', value->>'sourceId'
        loop
            v_source_type := v_line->>'sourceType';
            v_source_id := (v_line->>'sourceId')::uuid;
            if not exists (
                select 1 from jsonb_array_elements(p_approval_manifest) manifest
                where manifest->>'sourceType' = v_source_type
                  and manifest->>'sourceId' = v_source_id::text
                  and (manifest->>'lockVersion')::bigint = (v_line->>'sourceLockVersion')::bigint
            ) then
                raise exception 'PO line was not present in the validated approval manifest';
            end if;

            select coalesce(sum(quantity), 0) into v_committed_qty
            from public.approval_commitments
            where report_run_id = p_report_run_id
              and source_type = v_source_type
              and source_id = v_source_id
              and source_lock_version = (v_line->>'sourceLockVersion')::bigint;
            v_delta_qty := (v_line->>'approvedQty')::integer - v_committed_qty;
            if v_delta_qty <> 0 then
                v_fob := coalesce((v_line->>'fob')::numeric, 0);
                v_trucking := coalesce((v_line->>'truckingCostPerBottle')::numeric, 0);
                v_effective_lines := v_effective_lines || jsonb_build_array(
                    v_line || jsonb_build_object(
                        'approvedQty', v_delta_qty,
                        'wineCost', v_fob * v_delta_qty,
                        'laidInCost', v_trucking * v_delta_qty,
                        'landedCost', (v_fob + v_trucking) * v_delta_qty,
                        'lineCost', v_fob * v_delta_qty,
                        'absoluteApprovedQty', (v_line->>'approvedQty')::integer,
                        'committedQty', v_committed_qty
                    )
                );
            end if;
        end loop;

        select * into v_draft
        from public.purchase_order_drafts
        where report_run_id = p_report_run_id
          and lower(btrim(coalesce(supplier_name, ''))) = lower(v_supplier)
          and order_path = v_order_path
          and status in ('draft', 'ready_for_entry')
        for update;

        if jsonb_array_length(v_effective_lines) = 0 then
            if found then
                update public.purchase_order_drafts
                set status = 'cancelled', reviewed_by = v_actor, updated_at = now(),
                    notes = concat_ws(' ', nullif(notes, ''), 'Cancelled because no uncommitted approved quantity remains.')
                where id = v_draft.id;
                v_result := jsonb_set(v_result, '{updated}', (v_result->'updated') || jsonb_build_array(v_draft.id));
            end if;
            continue;
        end if;

        v_content_hash := md5((jsonb_build_object(
            'supplier', lower(v_supplier),
            'orderPath', v_order_path,
            'lines', v_effective_lines
        ))::text);

        if v_draft.id is null then
            insert into public.purchase_order_drafts (
                supplier_name, report_run_id, ordering_source, status,
                order_path, notes, created_by, revision_no, content_hash, source_snapshot
            ) values (
                v_supplier, p_report_run_id, v_ordering_source, 'draft',
                v_order_path, v_group->>'notes', v_actor, 0, null,
                coalesce(v_group->'draftSnapshot', '{}'::jsonb)
            ) returning * into v_draft;
            v_result := jsonb_set(v_result, '{created}', (v_result->'created') || jsonb_build_array(v_draft.id));
        elsif v_draft.content_hash = v_content_hash then
            v_result := jsonb_set(v_result, '{skipped}', (v_result->'skipped') || jsonb_build_array(v_draft.id));
            continue;
        else
            v_result := jsonb_set(v_result, '{updated}', (v_result->'updated') || jsonb_build_array(v_draft.id));
        end if;

        delete from public.purchase_order_lines where purchase_order_draft_id = v_draft.id;

        for v_line in select value from jsonb_array_elements(v_effective_lines)
        loop
            insert into public.purchase_order_lines (
                purchase_order_draft_id, recommendation_id, supplier_catalog_wine_id,
                producer_name, product_name, product_code, planning_sku,
                recommended_qty, approved_qty, fob, trucking_cost_per_bottle,
                wine_cost, laid_in_cost, landed_cost, line_cost,
                is_new_item, new_item_warning, source_snapshot,
                source_type, source_id, source_lock_version
            ) values (
                v_draft.id,
                case when v_line->>'sourceType' = 'recommendation' then (v_line->>'sourceId')::uuid else null end,
                nullif(v_line->>'supplierCatalogWineId', '')::uuid,
                nullif(v_line->>'producerName', ''), nullif(v_line->>'productName', ''),
                nullif(v_line->>'productCode', ''), nullif(v_line->>'planningSku', ''),
                coalesce((v_line->>'recommendedQty')::integer, 0),
                (v_line->>'approvedQty')::integer,
                coalesce((v_line->>'fob')::numeric, 0),
                coalesce((v_line->>'truckingCostPerBottle')::numeric, 0),
                coalesce((v_line->>'wineCost')::numeric, 0),
                coalesce((v_line->>'laidInCost')::numeric, 0),
                coalesce((v_line->>'landedCost')::numeric, 0),
                coalesce((v_line->>'lineCost')::numeric, 0),
                coalesce((v_line->>'isNewItem')::boolean, false),
                nullif(v_line->>'newItemWarning', ''),
                coalesce(v_line->'sourceSnapshot', '{}'::jsonb) || jsonb_build_object(
                    'absolute_approved_qty', (v_line->>'absoluteApprovedQty')::integer,
                    'committed_qty_before_revision', (v_line->>'committedQty')::integer
                ),
                v_line->>'sourceType', (v_line->>'sourceId')::uuid,
                (v_line->>'sourceLockVersion')::bigint
            ) returning id into v_line_id;
        end loop;

        v_revision := v_draft.revision_no + 1;
        select coalesce(jsonb_agg(to_jsonb(line) order by line.id), '[]'::jsonb)
        into v_line_snapshot
        from public.purchase_order_lines line
        where line.purchase_order_draft_id = v_draft.id;
        v_draft_snapshot := jsonb_build_object(
            'id', v_draft.id,
            'report_run_id', p_report_run_id,
            'supplier_name', v_supplier,
            'order_path', v_order_path,
            'status', 'draft',
            'po_number', v_draft.po_number,
            'notes', coalesce(v_group->>'notes', v_draft.notes),
            'ordering_source', v_ordering_source,
            'source_snapshot', coalesce(v_group->'draftSnapshot', '{}'::jsonb),
            'revision_no', v_revision,
            'content_hash', v_content_hash
        );

        insert into public.purchase_order_draft_revisions (
            purchase_order_draft_id, revision_no, content_hash,
            draft_snapshot, lines_snapshot, created_by
        ) values (
            v_draft.id, v_revision, v_content_hash,
            v_draft_snapshot, v_line_snapshot, v_actor
        );

        update public.purchase_order_drafts
        set supplier_name = v_supplier,
            order_path = v_order_path,
            ordering_source = v_ordering_source,
            source_snapshot = coalesce(v_group->'draftSnapshot', '{}'::jsonb),
            notes = coalesce(v_group->>'notes', notes),
            status = 'draft',
            revision_no = v_revision,
            content_hash = v_content_hash,
            reviewed_by = v_actor,
            updated_at = now()
        where id = v_draft.id;
    end loop;

    -- Reconcile groups that disappeared completely (for example, the final
    -- approval for a supplier was rejected). They are absent from p_groups,
    -- so the per-group loop above cannot cancel their stale active draft.
    for v_draft in
        select draft.*
        from public.purchase_order_drafts draft
        where draft.report_run_id = p_report_run_id
          and draft.status in ('draft', 'ready_for_entry')
          and not exists (
              select 1
              from jsonb_array_elements(p_groups) entry(value)
              where lower(btrim(coalesce(entry.value->>'supplier', 'Unassigned')))
                    = lower(btrim(coalesce(draft.supplier_name, '')))
                and coalesce(nullif(entry.value->>'orderPath', ''), 'stateside') = draft.order_path
          )
        order by draft.id
        for update
    loop
        update public.purchase_order_drafts
        set status = 'cancelled',
            reviewed_by = v_actor,
            updated_at = now(),
            notes = concat_ws(' ', nullif(notes, ''), 'Cancelled because its approval group is no longer active.')
        where id = v_draft.id;
        v_result := jsonb_set(v_result, '{updated}', (v_result->'updated') || jsonb_build_array(v_draft.id));
    end loop;

    insert into public.purchase_order_request_keys (
        idempotency_key, report_run_id, actor_id, request_hash, result
    ) values (
        p_idempotency_key, p_report_run_id, v_actor, p_request_hash, v_result
    );

    return v_result;
end;
$$;

revoke all on function public.create_purchase_order_drafts_atomic(uuid, uuid, text, jsonb, jsonb) from public;
grant execute on function public.create_purchase_order_drafts_atomic(uuid, uuid, text, jsonb, jsonb) to authenticated;

create or replace function public.set_purchase_order_draft_status(
    p_draft_id uuid,
    p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
    v_draft public.purchase_order_drafts%rowtype;
    v_report_run_id uuid;
begin
    if v_actor is null or not exists (
        select 1 from public.app_profiles where id = v_actor and role in ('buyer', 'admin')
    ) then
        raise exception 'Buyer or admin access required' using errcode = '42501';
    end if;
    if p_status not in ('draft', 'ready_for_entry', 'entered_in_quickbooks', 'cancelled') then
        raise exception 'Unsupported PO draft status';
    end if;

    select report_run_id into v_report_run_id from public.purchase_order_drafts where id = p_draft_id;
    if not found then raise exception 'PO draft not found'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_report_run_id::text, 9173));

    select * into v_draft from public.purchase_order_drafts
    where id = p_draft_id for update;
    if not found then raise exception 'PO draft not found'; end if;
    if v_draft.status = 'entered_in_quickbooks' and p_status <> 'entered_in_quickbooks' then
        raise exception 'QuickBooks-entered PO history cannot be reopened';
    end if;

    if p_status = 'entered_in_quickbooks' and v_draft.status <> 'entered_in_quickbooks' then
        insert into public.approval_commitments (
            report_run_id, source_type, source_id, source_lock_version,
            purchase_order_draft_id, draft_revision_no, quantity, actor_id
        )
        select v_draft.report_run_id, line.source_type, line.source_id,
               coalesce(line.source_lock_version, 0), v_draft.id,
               v_draft.revision_no, line.approved_qty, v_actor
        from public.purchase_order_lines line
        where line.purchase_order_draft_id = v_draft.id
          and line.source_type is not null and line.source_id is not null
        on conflict (purchase_order_draft_id, draft_revision_no, source_type, source_id) do nothing;
    end if;

    perform set_config('app.versioned_po_status_write', 'on', true);
    update public.purchase_order_drafts
    set status = p_status, reviewed_by = v_actor, updated_at = now()
    where id = p_draft_id;

    return jsonb_build_object('ok', true, 'id', p_draft_id, 'status', p_status);
end;
$$;

revoke all on function public.set_purchase_order_draft_status(uuid, text) from public;
grant execute on function public.set_purchase_order_draft_status(uuid, text) to authenticated;

create or replace function public.delete_purchase_order_line_revisioned(p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
    v_draft public.purchase_order_drafts%rowtype;
    v_report_run_id uuid;
    v_draft_id uuid;
    v_revision integer;
    v_lines jsonb;
    v_hash text;
    v_snapshot jsonb;
begin
    if v_actor is null or not exists (
        select 1 from public.app_profiles where id = v_actor and role in ('buyer', 'admin')
    ) then
        raise exception 'Buyer or admin access required' using errcode = '42501';
    end if;

    select draft.id, draft.report_run_id into v_draft_id, v_report_run_id
    from public.purchase_order_drafts draft
    join public.purchase_order_lines line on line.purchase_order_draft_id = draft.id
    where line.id = p_line_id;
    if not found then raise exception 'PO line not found'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_report_run_id::text, 9173));
    select * into v_draft from public.purchase_order_drafts where id = v_draft_id for update;
    if v_draft.status not in ('draft', 'ready_for_entry') then
        raise exception 'Only active PO drafts can be edited';
    end if;

    perform set_config('app.versioned_po_line_write', 'on', true);
    delete from public.purchase_order_lines where id = p_line_id;
    select coalesce(jsonb_agg(to_jsonb(line) order by line.id), '[]'::jsonb)
    into v_lines from public.purchase_order_lines line
    where line.purchase_order_draft_id = v_draft.id;
    v_revision := v_draft.revision_no + 1;
    v_snapshot := jsonb_build_object(
        'id', v_draft.id, 'report_run_id', v_draft.report_run_id,
        'supplier_name', v_draft.supplier_name, 'order_path', v_draft.order_path,
        'status', v_draft.status, 'po_number', v_draft.po_number,
        'notes', v_draft.notes, 'ordering_source', v_draft.ordering_source,
        'source_snapshot', v_draft.source_snapshot,
        'revision_no', v_revision
    );
    v_hash := md5((jsonb_build_object('draft', v_snapshot, 'lines', v_lines))::text);
    v_snapshot := v_snapshot || jsonb_build_object('content_hash', v_hash);

    insert into public.purchase_order_draft_revisions (
        purchase_order_draft_id, revision_no, content_hash,
        draft_snapshot, lines_snapshot, created_by
    ) values (v_draft.id, v_revision, v_hash, v_snapshot, v_lines, v_actor);

    update public.purchase_order_drafts
    set revision_no = v_revision, content_hash = v_hash,
        reviewed_by = v_actor, updated_at = now()
    where id = v_draft.id;

    return jsonb_build_object('ok', true, 'draftId', v_draft.id, 'revisionNo', v_revision);
end;
$$;

revoke all on function public.delete_purchase_order_line_revisioned(uuid) from public;
grant execute on function public.delete_purchase_order_line_revisioned(uuid) to authenticated;

-- Existing active drafts may predate order-path identity. Backfill it first.
update public.purchase_order_drafts
set order_path = case
    when notes ~* 'order path:\s*(direct import|di)' then 'di'
    else 'stateside'
end;

-- Remove duplicate source lines inside a single draft before adding constraints.
delete from public.purchase_order_lines line
using public.purchase_order_lines kept
where line.purchase_order_draft_id = kept.purchase_order_draft_id
  and line.id > kept.id
  and (
      (line.recommendation_id is not null and line.recommendation_id = kept.recommendation_id)
      or (line.supplier_catalog_wine_id is not null and line.supplier_catalog_wine_id = kept.supplier_catalog_wine_id)
  );

-- Merge pre-existing duplicate active drafts into the oldest canonical draft.
with ranked as (
    select id,
           first_value(id) over (
               partition by report_run_id, lower(btrim(coalesce(supplier_name, ''))), order_path
               order by created_at, id
           ) as canonical_id,
           row_number() over (
               partition by report_run_id, lower(btrim(coalesce(supplier_name, ''))), order_path
               order by created_at, id
           ) as position
    from public.purchase_order_drafts
    where status in ('draft', 'ready_for_entry')
), duplicates as (
    select id, canonical_id from ranked where position > 1
)
delete from public.purchase_order_lines line
using duplicates duplicate
where line.purchase_order_draft_id = duplicate.id
  and exists (
      select 1 from public.purchase_order_lines canonical
      where canonical.purchase_order_draft_id = duplicate.canonical_id
        and (
            (line.recommendation_id is not null and canonical.recommendation_id = line.recommendation_id)
            or (line.supplier_catalog_wine_id is not null and canonical.supplier_catalog_wine_id = line.supplier_catalog_wine_id)
        )
  );

with ranked as (
    select id,
           first_value(id) over (
               partition by report_run_id, lower(btrim(coalesce(supplier_name, ''))), order_path
               order by created_at, id
           ) as canonical_id,
           row_number() over (
               partition by report_run_id, lower(btrim(coalesce(supplier_name, ''))), order_path
               order by created_at, id
           ) as position
    from public.purchase_order_drafts
    where status in ('draft', 'ready_for_entry')
), duplicates as (
    select id, canonical_id from ranked where position > 1
)
update public.purchase_order_lines line
set purchase_order_draft_id = duplicate.canonical_id
from duplicates duplicate
where line.purchase_order_draft_id = duplicate.id;

delete from public.purchase_order_lines line
using public.purchase_order_lines kept
where line.purchase_order_draft_id = kept.purchase_order_draft_id
  and line.id > kept.id
  and (
      (line.recommendation_id is not null and line.recommendation_id = kept.recommendation_id)
      or (line.supplier_catalog_wine_id is not null and line.supplier_catalog_wine_id = kept.supplier_catalog_wine_id)
  );

with ranked as (
    select id,
           row_number() over (
               partition by report_run_id, lower(btrim(coalesce(supplier_name, ''))), order_path
               order by created_at, id
           ) as position
    from public.purchase_order_drafts
    where status in ('draft', 'ready_for_entry')
)
update public.purchase_order_drafts draft
set status = 'cancelled',
    notes = concat_ws(' ', nullif(draft.notes, ''), 'Cancelled during duplicate-active-draft migration.'),
    updated_at = now()
from ranked duplicate
where draft.id = duplicate.id and duplicate.position > 1;

create unique index if not exists uq_active_po_draft_group
    on public.purchase_order_drafts (
        report_run_id,
        lower(btrim(coalesce(supplier_name, ''))),
        order_path
    )
    where status in ('draft', 'ready_for_entry');

create unique index if not exists uq_po_line_recommendation
    on public.purchase_order_lines(purchase_order_draft_id, recommendation_id)
    where recommendation_id is not null;

create unique index if not exists uq_po_line_catalog_wine
    on public.purchase_order_lines(purchase_order_draft_id, supplier_catalog_wine_id)
    where supplier_catalog_wine_id is not null;

update public.purchase_order_lines
set source_type = case
        when supplier_catalog_wine_id is not null then 'catalog_workbench'
        else 'recommendation'
    end,
    source_id = case
        when supplier_catalog_wine_id is not null then coalesce(
            (
                select workbench.id
                from public.supplier_catalog_workbench_items workbench
                join public.purchase_order_drafts draft on draft.id = purchase_order_lines.purchase_order_draft_id
                where workbench.report_run_id = draft.report_run_id
                  and workbench.supplier_catalog_wine_id = purchase_order_lines.supplier_catalog_wine_id
                limit 1
            ),
            supplier_catalog_wine_id
        )
        else recommendation_id
    end,
    source_lock_version = coalesce(source_lock_version, 0)
where source_type is null or source_id is null or source_lock_version is null;

create index if not exists idx_approval_commitments_source
    on public.approval_commitments(source_type, source_id);

create table if not exists public.purchase_order_export_events (
    id uuid primary key default gen_random_uuid(),
    report_run_id uuid not null references public.report_runs(id) on delete cascade,
    actor_id uuid not null references auth.users(id),
    format text not null check (format in ('xlsx', 'csv')),
    export_scope text not null check (export_scope in ('single', 'selected', 'all')),
    draft_revisions jsonb not null,
    line_snapshots jsonb not null,
    content_hash text,
    filename text,
    generation_status text not null check (generation_status in ('succeeded', 'failed')),
    error_message text,
    generated_at timestamptz not null default now()
);

drop trigger if exists trg_po_draft_revisions_immutable on public.purchase_order_draft_revisions;
create trigger trg_po_draft_revisions_immutable
before update or delete on public.purchase_order_draft_revisions
for each row execute function public.prevent_immutable_business_event_change();

drop trigger if exists trg_approval_commitments_immutable on public.approval_commitments;
create trigger trg_approval_commitments_immutable
before update or delete on public.approval_commitments
for each row execute function public.prevent_immutable_business_event_change();

drop trigger if exists trg_po_export_events_immutable on public.purchase_order_export_events;
create trigger trg_po_export_events_immutable
before update or delete on public.purchase_order_export_events
for each row execute function public.prevent_immutable_business_event_change();

create or replace function public.guard_purchase_order_status_write()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'INSERT'
       and coalesce(current_setting('app.versioned_po_status_write', true), '') <> 'on' then
        raise exception using
            errcode = '40001',
            message = 'PO draft created outside the transactional workflow. Refresh and retry.';
    end if;
    if tg_op = 'UPDATE'
       and new.status is distinct from old.status
       and coalesce(current_setting('app.versioned_po_status_write', true), '') <> 'on' then
        raise exception using
            errcode = '40001',
            message = 'PO status changed outside the transactional workflow. Refresh and retry.';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_purchase_order_status_guard on public.purchase_order_drafts;
create trigger trg_purchase_order_status_guard
before insert or update on public.purchase_order_drafts
for each row execute function public.guard_purchase_order_status_write();

create or replace function public.guard_purchase_order_line_write()
returns trigger
language plpgsql
as $$
begin
    if coalesce(current_setting('app.versioned_po_line_write', true), '') <> 'on' then
        raise exception using
            errcode = '40001',
            message = 'PO lines changed outside the revisioned transactional workflow. Refresh and retry.';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

drop trigger if exists trg_purchase_order_line_guard on public.purchase_order_lines;
create trigger trg_purchase_order_line_guard
before insert or update or delete on public.purchase_order_lines
for each row execute function public.guard_purchase_order_line_write();

-- Backfill one frozen revision for every existing draft.
with snapshots as (
    select draft.id,
           greatest(draft.revision_no, 1) as revision_no,
           jsonb_build_object(
               'id', draft.id,
               'report_run_id', draft.report_run_id,
               'supplier_name', draft.supplier_name,
               'order_path', draft.order_path,
               'status', draft.status,
               'po_number', draft.po_number,
               'notes', draft.notes
           ) as draft_snapshot,
           coalesce(jsonb_agg(to_jsonb(line) order by line.id) filter (where line.id is not null), '[]'::jsonb) as lines_snapshot
    from public.purchase_order_drafts draft
    left join public.purchase_order_lines line on line.purchase_order_draft_id = draft.id
    group by draft.id
), hashed as (
    select *, md5((jsonb_build_object('draft', draft_snapshot, 'lines', lines_snapshot))::text) as content_hash
    from snapshots
)
insert into public.purchase_order_draft_revisions (
    purchase_order_draft_id, revision_no, content_hash,
    draft_snapshot, lines_snapshot, created_at
)
select id, revision_no, content_hash, draft_snapshot, lines_snapshot, now()
from hashed
on conflict (purchase_order_draft_id, revision_no) do nothing;

update public.purchase_order_drafts draft
set revision_no = revision.revision_no,
    content_hash = revision.content_hash
from public.purchase_order_draft_revisions revision
where revision.purchase_order_draft_id = draft.id
  and revision.revision_no = (
      select max(latest.revision_no)
      from public.purchase_order_draft_revisions latest
      where latest.purchase_order_draft_id = draft.id
  );

-- Existing QuickBooks-entered drafts become immutable commitment facts.
insert into public.approval_commitments (
    report_run_id, source_type, source_id, source_lock_version,
    purchase_order_draft_id, draft_revision_no, quantity,
    actor_id, created_at
)
select draft.report_run_id,
       coalesce(line.source_type, case when line.supplier_catalog_wine_id is not null then 'catalog_workbench' else 'recommendation' end),
       coalesce(line.source_id, line.recommendation_id, line.supplier_catalog_wine_id),
       coalesce(line.source_lock_version, 0),
       draft.id, greatest(draft.revision_no, 1), line.approved_qty,
       draft.reviewed_by, draft.updated_at
from public.purchase_order_drafts draft
join public.purchase_order_lines line on line.purchase_order_draft_id = draft.id
where draft.status = 'entered_in_quickbooks'
  and coalesce(line.source_id, line.recommendation_id, line.supplier_catalog_wine_id) is not null
on conflict (purchase_order_draft_id, draft_revision_no, source_type, source_id) do nothing;

alter table public.purchase_order_draft_revisions enable row level security;
alter table public.purchase_order_request_keys enable row level security;
alter table public.approval_commitments enable row level security;
alter table public.purchase_order_export_events enable row level security;

grant select on public.purchase_order_draft_revisions to authenticated;
grant select on public.approval_commitments to authenticated;
grant select, insert on public.purchase_order_export_events to authenticated;

create policy "authenticated users can read PO revisions"
    on public.purchase_order_draft_revisions for select to authenticated using (true);
create policy "authenticated users can read approval commitments"
    on public.approval_commitments for select to authenticated using (true);
create policy "authenticated users can read PO exports"
    on public.purchase_order_export_events for select to authenticated using (true);
create policy "buyer and admin profiles can record PO exports"
    on public.purchase_order_export_events for insert to authenticated
    with check (
        actor_id = auth.uid() and exists (
            select 1 from public.app_profiles profile
            where profile.id = auth.uid() and profile.role in ('buyer', 'admin')
        )
    );

-- Realtime is visibility only; version checks and constraints above remain the
-- correctness mechanism.
do $$
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        return;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename = 'reorder_recommendations'
    ) then
        alter publication supabase_realtime add table public.reorder_recommendations;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename = 'supplier_catalog_workbench_items'
    ) then
        alter publication supabase_realtime add table public.supplier_catalog_workbench_items;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename = 'purchase_order_drafts'
    ) then
        alter publication supabase_realtime add table public.purchase_order_drafts;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename = 'purchase_order_lines'
    ) then
        alter publication supabase_realtime add table public.purchase_order_lines;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename = 'purchase_order_export_events'
    ) then
        alter publication supabase_realtime add table public.purchase_order_export_events;
    end if;
end $$;

notify pgrst, 'reload schema';
