-- Delete draft-only Add Wine rows atomically while retaining immutable audit
-- snapshots after the catalog row itself is gone.

alter table public.supplier_catalog_events
    drop constraint if exists supplier_catalog_events_supplier_catalog_wine_id_fkey;

alter table public.supplier_catalog_events
    drop constraint if exists supplier_catalog_events_operation_check;

alter table public.supplier_catalog_events
    add constraint supplier_catalog_events_operation_check
    check (operation in ('created', 'updated', 'deleted'));

alter table public.supplier_catalog_price_level_audit
    drop constraint if exists supplier_catalog_price_level_audit_supplier_catalog_wine_id_fkey;

create table if not exists public.supplier_catalog_delete_requests (
    actor_id uuid not null references auth.users(id),
    idempotency_key uuid not null,
    request_hash text not null,
    response jsonb not null,
    created_at timestamptz not null default now(),
    primary key (actor_id, idempotency_key)
);

drop trigger if exists trg_supplier_catalog_delete_requests_immutable on public.supplier_catalog_delete_requests;
create trigger trg_supplier_catalog_delete_requests_immutable
before update or delete on public.supplier_catalog_delete_requests
for each row execute function public.prevent_immutable_business_event_change();

alter table public.supplier_catalog_delete_requests enable row level security;
grant select on public.supplier_catalog_delete_requests to authenticated;
revoke insert, update, delete on public.supplier_catalog_delete_requests from authenticated;

drop policy if exists "buyers and admins can read catalog delete requests" on public.supplier_catalog_delete_requests;
create policy "buyers and admins can read catalog delete requests"
    on public.supplier_catalog_delete_requests for select to authenticated
    using (actor_id = (select auth.uid()));

create or replace function public.delete_pending_supplier_catalog_sku_atomic(
    p_supplier_catalog_wine_id uuid,
    p_expected_lock_version bigint,
    p_idempotency_key uuid,
    p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := (select auth.uid());
    v_wine public.supplier_catalog_wines%rowtype;
    v_replay public.supplier_catalog_delete_requests%rowtype;
    v_result jsonb;
    v_has_official_product boolean;
    v_is_draft_only boolean;
begin
    if v_actor is null then
        raise exception 'Sign in required.';
    end if;
    if p_supplier_catalog_wine_id is null then
        raise exception 'Supplier catalog wine id is required.';
    end if;
    if p_idempotency_key is null or nullif(p_request_hash, '') is null then
        raise exception 'Idempotency key and request hash are required.';
    end if;
    if not exists (
        select 1
          from public.app_profiles profile
         where profile.id = v_actor
           and profile.role in ('buyer', 'admin')
    ) then
        raise exception 'Buyer or admin access required.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0));
    select * into v_replay
      from public.supplier_catalog_delete_requests
     where actor_id = v_actor
       and idempotency_key = p_idempotency_key;
    if found then
        if v_replay.request_hash <> p_request_hash then
            raise exception 'Idempotency key was already used for a different Add Wine deletion request.';
        end if;
        return v_replay.response;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_supplier_catalog_wine_id::text, 2));
    select * into v_wine
      from public.supplier_catalog_wines
     where id = p_supplier_catalog_wine_id
     for update;
    if not found then
        raise exception 'Supplier wine not found.';
    end if;
    if coalesce(p_expected_lock_version, 0) <> v_wine.lock_version then
        raise exception 'This wine changed after you opened it. Refresh Order Summary before deleting it.';
    end if;

    v_has_official_product :=
        v_wine.product_lifecycle_status = 'active_product'
        or upper(btrim(coalesce(v_wine.quickbooks_item_id, ''))) not in ('', 'NEW', 'NEW ITEM', 'TBD', 'PENDING')
        or upper(btrim(coalesce(v_wine.quickbooks_item_number, ''))) not in ('', 'NEW', 'NEW ITEM', 'TBD', 'PENDING');
    v_is_draft_only :=
        not v_has_official_product
        and (
            v_wine.product_lifecycle_status = 'pending_product_creation'
            or v_wine.quickbooks_sync_status = 'not_created'
            or v_wine.conversion_status in ('new_vintage', 'new_format', 'possible_match_needs_review', 'net_new_product')
        );
    if not v_is_draft_only then
        raise exception 'Only draft-only pending product-creation records can be deleted here.';
    end if;
    if exists (
        select 1
          from public.price_change_events event
         where event.supplier_catalog_wine_id = v_wine.id
           and event.status not in ('draft', 'pending_review')
    ) then
        raise exception 'This record has approved or communicated price changes and cannot be deleted here.';
    end if;
    if exists (
        select 1
          from public.purchase_order_lines line
         where line.supplier_catalog_wine_id = v_wine.id
    ) then
        raise exception 'This record is already referenced by a PO and cannot be deleted.';
    end if;

    update public.supplier_catalog_wines
       set copied_from_supplier_catalog_wine_id = null
     where copied_from_supplier_catalog_wine_id = v_wine.id;

    update public.wine_requests
       set supplier_catalog_wine_id = null,
           updated_at = now()
     where supplier_catalog_wine_id = v_wine.id;

    delete from public.price_change_events
     where supplier_catalog_wine_id = v_wine.id
       and status in ('draft', 'pending_review');

    insert into public.supplier_catalog_events (
        supplier_catalog_wine_id,
        operation,
        before_record,
        after_record,
        changed_by,
        idempotency_key
    ) values (
        v_wine.id,
        'deleted',
        to_jsonb(v_wine),
        to_jsonb(v_wine) || jsonb_build_object('deleted_at', now(), 'deleted_by', v_actor),
        v_actor,
        p_idempotency_key
    );

    delete from public.supplier_catalog_wines
     where id = v_wine.id;
    if not found then
        raise exception 'The pending product was not deleted. Please reload and try again.';
    end if;

    v_result := jsonb_build_object(
        'id', v_wine.id,
        'display_name', v_wine.display_name,
        'deleted', true
    );
    insert into public.supplier_catalog_delete_requests (
        actor_id,
        idempotency_key,
        request_hash,
        response
    ) values (
        v_actor,
        p_idempotency_key,
        p_request_hash,
        v_result
    );

    return v_result;
end;
$$;

revoke all on function public.delete_pending_supplier_catalog_sku_atomic(uuid, bigint, uuid, text) from public;
grant execute on function public.delete_pending_supplier_catalog_sku_atomic(uuid, bigint, uuid, text) to authenticated;

revoke delete on public.supplier_catalog_wines from authenticated;

notify pgrst, 'reload schema';
