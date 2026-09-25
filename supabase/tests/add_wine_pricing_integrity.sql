-- Run with `supabase test db` after applying all migrations.
-- This test is transactional and leaves no catalog data behind.

begin;

do $$
declare
    buyer_id constant uuid := '61000000-0000-0000-0000-000000000001';
    first_key constant uuid := '62000000-0000-0000-0000-000000000001';
    update_key constant uuid := '62000000-0000-0000-0000-000000000002';
    stale_key constant uuid := '62000000-0000-0000-0000-000000000003';
    delete_key constant uuid := '62000000-0000-0000-0000-000000000004';
    catalog jsonb := jsonb_build_object(
        'supplier_name', 'Add Wine Test Supplier',
        'producer', 'Test Producer',
        'wine_name', 'Test Item',
        'vintage', '2026',
        'pack_size', 12,
        'bottle_size', '750ml',
        'pricing_basis', 'bottle',
        'pricing_model', 'standard',
        'fob_bottle', 10,
        'fob_case', 120,
        'laid_in_per_bottle', 0.30,
        'landed_bottle_cost', 10.30,
        'frontline_bottle_price', 15.25,
        'best_price', 14.75,
        'gross_profit_margin', 0.3246,
        'availability_status', 'available',
        'conversion_status', 'net_new_product',
        'display_name', 'Test Producer Test Item 2026 12/750ml',
        'planning_sku', 'add-wine-integrity-test-2026-12-750ml',
        'planning_sku_without_vintage', 'add-wine-integrity-test-12-750ml',
        'diagnostics', '{}'::jsonb,
        'quickbooks_sync_status', 'not_created',
        'product_lifecycle_status', 'pending_product_creation',
        'accounting_create_payload', '{}'::jsonb,
        'system_tags', '[]'::jsonb,
        'source_system', 'manual',
        'frontline_only', false,
        'pricing_cost_fingerprint', '12|10.00|0.30'
    );
    levels jsonb := jsonb_build_array(
        jsonb_build_object(
            'name', 'Frontline', 'bottle_price', 15.25, 'depletion_allowance', 0,
            'target_gp_margin', 0.32, 'calculated_gp_margin', 0.3246,
            'is_frontline', true, 'is_best', false, 'display_order', 0,
            'active', true, 'solve_for', 'gp', 'suggested_price', 15.25,
            'suggested_gp_margin', 0.3246, 'is_manual_override', false
        ),
        jsonb_build_object(
            'name', 'Best', 'bottle_price', 14.75, 'depletion_allowance', 0,
            'target_gp_margin', 0.30, 'calculated_gp_margin', 0.3017,
            'is_frontline', false, 'is_best', true, 'display_order', 1,
            'active', true, 'solve_for', 'gp', 'suggested_price', 14.75,
            'suggested_gp_margin', 0.3017, 'is_manual_override', false
        )
    );
    result jsonb;
    replay jsonb;
    wine_id uuid;
    original_version bigint;
    updated_version bigint;
begin
    insert into auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
        buyer_id, 'authenticated', 'authenticated', 'add-wine@example.test', '', now(),
        '{}'::jsonb, '{}'::jsonb, now(), now()
    ) on conflict (id) do nothing;

    insert into public.app_profiles (id, email, full_name, role)
    values (buyer_id, 'add-wine@example.test', 'Add Wine Buyer', 'buyer')
    on conflict (id) do update set role = excluded.role;

    perform set_config('request.jwt.claim.sub', buyer_id::text, true);
    result := public.save_supplier_catalog_sku_atomic(
        catalog, levels, '[]'::jsonb, null, 0, first_key, 'create-hash'
    );
    if result->>'mode' <> 'created' then
        raise exception 'Add Wine create returned unexpected result: %', result;
    end if;
    wine_id := (result->'saved'->>'id')::uuid;
    original_version := (result->'saved'->>'lock_version')::bigint;

    replay := public.save_supplier_catalog_sku_atomic(
        catalog, '[]'::jsonb, '[]'::jsonb, null, 0, first_key, 'create-hash'
    );
    if replay <> result then raise exception 'idempotent Add Wine retry changed its response'; end if;
    if (select count(*) from public.supplier_catalog_wines where planning_sku = catalog->>'planning_sku') <> 1 then
        raise exception 'idempotent Add Wine retry created a duplicate catalog row';
    end if;
    if (select count(*) from public.supplier_catalog_price_levels where supplier_catalog_wine_id = wine_id) <> 2 then
        raise exception 'Add Wine did not atomically save both price levels';
    end if;

    result := public.save_supplier_catalog_sku_atomic(
        catalog || jsonb_build_object('id', wine_id, 'fob_bottle', 11, 'fob_case', 132),
        levels, '[]'::jsonb, null, original_version, update_key, 'update-hash'
    );
    if result->>'mode' <> 'updated' or not (result->>'price_change_created')::boolean then
        raise exception 'Add Wine update did not atomically create price history: %', result;
    end if;
    updated_version := (result->'saved'->>'lock_version')::bigint;

    begin
        perform public.save_supplier_catalog_sku_atomic(
            catalog || jsonb_build_object('id', wine_id, 'fob_bottle', 12, 'fob_case', 144),
            levels, '[]'::jsonb, null, original_version, stale_key, 'stale-hash'
        );
        raise exception 'stale Add Wine update unexpectedly succeeded';
    exception
        when others then
            if sqlerrm not like 'This wine changed after you opened it.%' then raise; end if;
    end;

    if (select count(*) from public.supplier_catalog_events where supplier_catalog_wine_id = wine_id) <> 2 then
        raise exception 'Add Wine catalog audit history is incomplete';
    end if;

    result := public.delete_pending_supplier_catalog_sku_atomic(
        wine_id, updated_version, delete_key, 'delete-hash'
    );
    if not coalesce((result->>'deleted')::boolean, false) then
        raise exception 'Add Wine delete returned unexpected result: %', result;
    end if;
    replay := public.delete_pending_supplier_catalog_sku_atomic(
        wine_id, updated_version, delete_key, 'delete-hash'
    );
    if replay <> result then raise exception 'idempotent Add Wine delete retry changed its response'; end if;
    if exists (select 1 from public.supplier_catalog_wines where id = wine_id) then
        raise exception 'Add Wine delete left the catalog row behind';
    end if;
    if exists (select 1 from public.supplier_catalog_price_levels where supplier_catalog_wine_id = wine_id) then
        raise exception 'Add Wine delete left price levels behind';
    end if;
    if (select count(*) from public.supplier_catalog_events where supplier_catalog_wine_id = wine_id) <> 3 then
        raise exception 'Add Wine delete did not preserve complete catalog audit history';
    end if;
    if (select count(*) from public.supplier_catalog_events where supplier_catalog_wine_id = wine_id and operation = 'deleted') <> 1 then
        raise exception 'Add Wine delete audit event is missing';
    end if;
    if (select count(*) from public.supplier_catalog_delete_requests where actor_id = buyer_id and idempotency_key = delete_key) <> 1 then
        raise exception 'Add Wine delete idempotency record is missing';
    end if;
end;
$$;

rollback;
