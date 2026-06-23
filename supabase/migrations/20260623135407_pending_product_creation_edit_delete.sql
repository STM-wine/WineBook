-- Support stable-ID edits and protected deletion for pending product creation.

grant select, insert, update, delete on public.supplier_catalog_wines to authenticated;
grant select, insert, update, delete on public.supplier_catalog_workbench_items to authenticated;

alter table public.supplier_catalog_free_goods
    add column if not exists extension_metadata jsonb not null default '{}'::jsonb;

drop policy if exists "buyer and admin profiles can delete pending supplier catalog wines"
    on public.supplier_catalog_wines;

create policy "buyer and admin profiles can delete pending supplier catalog wines"
    on public.supplier_catalog_wines for delete
    to authenticated
    using (
        product_lifecycle_status = 'pending_product_creation'
        and quickbooks_sync_status not in ('created', 'linked')
        and quickbooks_item_id is null
        and quickbooks_item_number is null
        and exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "buyer and admin profiles can delete supplier catalog workbench items"
    on public.supplier_catalog_workbench_items;

create policy "buyer and admin profiles can delete supplier catalog workbench items"
    on public.supplier_catalog_workbench_items for delete
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

create or replace function public.save_supplier_catalog_sku(
    p_catalog jsonb,
    p_price_levels jsonb default '[]'::jsonb,
    p_free_goods jsonb default '[]'::jsonb,
    p_report_run_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_existing public.supplier_catalog_wines%rowtype;
    v_saved public.supplier_catalog_wines%rowtype;
    v_level jsonb;
    v_free_good jsonb;
    v_mode text;
begin
    if not exists (
        select 1
        from public.app_profiles profile
        where profile.id = (select auth.uid())
          and profile.role in ('buyer', 'admin')
    ) then
        raise exception 'Buyer or admin access required.';
    end if;

    if nullif(p_catalog->>'id', '') is not null then
        select *
          into v_existing
          from public.supplier_catalog_wines
         where id = nullif(p_catalog->>'id', '')::uuid
         limit 1;

        if v_existing.id is null then
            raise exception 'Supplier catalog wine not found for edit.';
        end if;
    end if;

    if v_existing.id is null then
        select *
          into v_existing
          from public.supplier_catalog_wines
         where planning_sku = p_catalog->>'planning_sku'
         limit 1;
    elsif exists (
        select 1
          from public.supplier_catalog_wines duplicate
         where duplicate.planning_sku = p_catalog->>'planning_sku'
           and duplicate.id <> v_existing.id
    ) then
        raise exception 'Planning SKU already belongs to another supplier wine.';
    end if;

    if v_existing.id is null then
        insert into public.supplier_catalog_wines (
            supplier_id,
            supplier_name,
            producer,
            wine_name,
            vintage,
            pack_size,
            bottle_size,
            pricing_basis,
            fob_bottle,
            fob_case,
            laid_in_per_bottle,
            landed_bottle_cost,
            frontline_bottle_price,
            best_price,
            gross_profit_margin,
            availability_status,
            conversion_status,
            display_name,
            planning_sku,
            planning_sku_without_vintage,
            diagnostics,
            quickbooks_item_id,
            quickbooks_item_name,
            quickbooks_item_number,
            quickbooks_sync_status,
            product_lifecycle_status,
            accounting_create_payload,
            system_tags,
            copied_from_supplier_catalog_wine_id,
            source_system,
            source_id,
            updated_at
        )
        values (
            nullif(p_catalog->>'supplier_id', '')::uuid,
            p_catalog->>'supplier_name',
            p_catalog->>'producer',
            p_catalog->>'wine_name',
            coalesce(nullif(p_catalog->>'vintage', ''), 'NV'),
            coalesce((p_catalog->>'pack_size')::integer, 12),
            coalesce(nullif(p_catalog->>'bottle_size', ''), '750ml'),
            coalesce(nullif(p_catalog->>'pricing_basis', ''), 'bottle'),
            coalesce((p_catalog->>'fob_bottle')::numeric, 0),
            coalesce((p_catalog->>'fob_case')::numeric, 0),
            coalesce((p_catalog->>'laid_in_per_bottle')::numeric, 0),
            coalesce((p_catalog->>'landed_bottle_cost')::numeric, 0),
            coalesce((p_catalog->>'frontline_bottle_price')::numeric, 0),
            nullif(p_catalog->>'best_price', '')::numeric,
            coalesce((p_catalog->>'gross_profit_margin')::numeric, 0),
            coalesce(nullif(p_catalog->>'availability_status', ''), 'available'),
            coalesce(nullif(p_catalog->>'conversion_status', ''), 'net_new_product'),
            p_catalog->>'display_name',
            p_catalog->>'planning_sku',
            p_catalog->>'planning_sku_without_vintage',
            coalesce(p_catalog->'diagnostics', '{}'::jsonb),
            nullif(p_catalog->>'quickbooks_item_id', ''),
            nullif(p_catalog->>'quickbooks_item_name', ''),
            nullif(p_catalog->>'quickbooks_item_number', ''),
            coalesce(nullif(p_catalog->>'quickbooks_sync_status', ''), 'not_created'),
            coalesce(nullif(p_catalog->>'product_lifecycle_status', ''), 'supplier_available'),
            coalesce(p_catalog->'accounting_create_payload', '{}'::jsonb),
            coalesce(array(select jsonb_array_elements_text(coalesce(p_catalog->'system_tags', '[]'::jsonb))), '{}'),
            nullif(p_catalog->>'copied_from_supplier_catalog_wine_id', '')::uuid,
            nullif(p_catalog->>'source_system', ''),
            nullif(p_catalog->>'source_id', ''),
            now()
        )
        returning * into v_saved;
        v_mode := 'created';
    else
        update public.supplier_catalog_wines
           set supplier_id = nullif(p_catalog->>'supplier_id', '')::uuid,
               supplier_name = p_catalog->>'supplier_name',
               producer = p_catalog->>'producer',
               wine_name = p_catalog->>'wine_name',
               vintage = coalesce(nullif(p_catalog->>'vintage', ''), 'NV'),
               pack_size = coalesce((p_catalog->>'pack_size')::integer, 12),
               bottle_size = coalesce(nullif(p_catalog->>'bottle_size', ''), '750ml'),
               pricing_basis = coalesce(nullif(p_catalog->>'pricing_basis', ''), 'bottle'),
               fob_bottle = coalesce((p_catalog->>'fob_bottle')::numeric, 0),
               fob_case = coalesce((p_catalog->>'fob_case')::numeric, 0),
               laid_in_per_bottle = coalesce((p_catalog->>'laid_in_per_bottle')::numeric, 0),
               landed_bottle_cost = coalesce((p_catalog->>'landed_bottle_cost')::numeric, 0),
               frontline_bottle_price = coalesce((p_catalog->>'frontline_bottle_price')::numeric, 0),
               best_price = nullif(p_catalog->>'best_price', '')::numeric,
               gross_profit_margin = coalesce((p_catalog->>'gross_profit_margin')::numeric, 0),
               availability_status = coalesce(nullif(p_catalog->>'availability_status', ''), 'available'),
               conversion_status = coalesce(nullif(p_catalog->>'conversion_status', ''), 'net_new_product'),
               display_name = p_catalog->>'display_name',
               planning_sku = p_catalog->>'planning_sku',
               planning_sku_without_vintage = p_catalog->>'planning_sku_without_vintage',
               diagnostics = coalesce(p_catalog->'diagnostics', '{}'::jsonb),
               quickbooks_item_id = case
                   when v_existing.quickbooks_sync_status in ('created', 'linked') then v_existing.quickbooks_item_id
                   else nullif(p_catalog->>'quickbooks_item_id', '')
               end,
               quickbooks_item_name = case
                   when v_existing.quickbooks_sync_status in ('created', 'linked') then v_existing.quickbooks_item_name
                   else nullif(p_catalog->>'quickbooks_item_name', '')
               end,
               quickbooks_item_number = case
                   when v_existing.quickbooks_sync_status in ('created', 'linked') then v_existing.quickbooks_item_number
                   else nullif(p_catalog->>'quickbooks_item_number', '')
               end,
               quickbooks_sync_status = case
                   when v_existing.quickbooks_sync_status in ('created', 'linked') then v_existing.quickbooks_sync_status
                   else coalesce(nullif(p_catalog->>'quickbooks_sync_status', ''), 'not_created')
               end,
               product_lifecycle_status = case
                   when v_existing.product_lifecycle_status = 'active_product' then 'active_product'
                   else coalesce(nullif(p_catalog->>'product_lifecycle_status', ''), 'supplier_available')
               end,
               accounting_create_payload = coalesce(p_catalog->'accounting_create_payload', '{}'::jsonb),
               system_tags = coalesce(array(select jsonb_array_elements_text(coalesce(p_catalog->'system_tags', '[]'::jsonb))), '{}'),
               copied_from_supplier_catalog_wine_id = nullif(p_catalog->>'copied_from_supplier_catalog_wine_id', '')::uuid,
               source_system = nullif(p_catalog->>'source_system', ''),
               source_id = nullif(p_catalog->>'source_id', ''),
               updated_at = now()
         where id = v_existing.id
         returning * into v_saved;
        v_mode := 'updated';
    end if;

    delete from public.supplier_catalog_price_levels
     where supplier_catalog_wine_id = v_saved.id;

    for v_level in select * from jsonb_array_elements(coalesce(p_price_levels, '[]'::jsonb))
    loop
        insert into public.supplier_catalog_price_levels (
            supplier_catalog_wine_id,
            name,
            bottle_price,
            depletion_allowance,
            target_gp_margin,
            calculated_gp_margin,
            is_frontline,
            is_best,
            display_order,
            active,
            source_system,
            source_id
        )
        values (
            v_saved.id,
            coalesce(nullif(v_level->>'name', ''), 'Price Level'),
            coalesce((v_level->>'bottle_price')::numeric, 0),
            coalesce((v_level->>'depletion_allowance')::numeric, 0),
            nullif(v_level->>'target_gp_margin', '')::numeric,
            coalesce((v_level->>'calculated_gp_margin')::numeric, 0),
            coalesce((v_level->>'is_frontline')::boolean, false),
            coalesce((v_level->>'is_best')::boolean, false),
            coalesce((v_level->>'display_order')::integer, 0),
            coalesce((v_level->>'active')::boolean, true),
            nullif(v_level->>'source_system', ''),
            nullif(v_level->>'source_id', '')
        );
    end loop;

    delete from public.supplier_catalog_free_goods
     where supplier_catalog_wine_id = v_saved.id;

    for v_free_good in select * from jsonb_array_elements(coalesce(p_free_goods, '[]'::jsonb))
    loop
        insert into public.supplier_catalog_free_goods (
            supplier_catalog_wine_id,
            buy_quantity,
            free_quantity,
            unit,
            program_name,
            starts_on,
            ends_on,
            notes,
            active,
            extension_metadata
        )
        values (
            v_saved.id,
            coalesce((v_free_good->>'buy_quantity')::numeric, 0),
            coalesce((v_free_good->>'free_quantity')::numeric, 0),
            coalesce(nullif(v_free_good->>'unit', ''), 'bottle'),
            nullif(v_free_good->>'program_name', ''),
            nullif(v_free_good->>'starts_on', '')::date,
            nullif(v_free_good->>'ends_on', '')::date,
            nullif(v_free_good->>'notes', ''),
            coalesce((v_free_good->>'active')::boolean, true),
            coalesce(v_free_good->'extension_metadata', '{}'::jsonb)
        );
    end loop;

    if p_report_run_id is not null then
        insert into public.supplier_catalog_workbench_items (
            report_run_id,
            supplier_catalog_wine_id,
            recommended_qty,
            approved_qty,
            recommendation_status,
            order_path,
            active,
            created_by,
            updated_at
        )
        values (
            p_report_run_id,
            v_saved.id,
            greatest(1, coalesce(v_saved.pack_size, 12)),
            0,
            'rejected',
            'stateside',
            true,
            (select auth.uid()),
            now()
        )
        on conflict (report_run_id, supplier_catalog_wine_id)
        do update set
            active = true,
            recommended_qty = case
                when public.supplier_catalog_workbench_items.recommended_qty <= 0
                then excluded.recommended_qty
                else public.supplier_catalog_workbench_items.recommended_qty
            end,
            updated_at = now();
    end if;

    return jsonb_build_object(
        'mode', v_mode,
        'saved', to_jsonb(v_saved),
        'previous', case when v_existing.id is null then null else to_jsonb(v_existing) end
    );
end;
$$;

grant execute on function public.save_supplier_catalog_sku(jsonb, jsonb, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
