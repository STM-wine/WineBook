-- Supplier Hub SKU-first catalog workflow.
--
-- V1 keeps supplier_catalog_wines as the durable orderable SKU row while adding
-- flexible child tables for price levels/free goods and a separate manual
-- workbench bridge for rows that are not reorder_recommendations.

alter table public.supplier_catalog_wines
    add column if not exists system_tags text[] not null default '{}',
    add column if not exists copied_from_supplier_catalog_wine_id uuid references public.supplier_catalog_wines(id),
    add column if not exists source_system text
        check (source_system is null or source_system in ('quickbooks_desktop', 'vinosmith', 'email', 'manual', 'stem')),
    add column if not exists source_id text,
    add column if not exists quickbooks_item_number text;

create table if not exists public.supplier_catalog_price_levels (
    id uuid primary key default gen_random_uuid(),
    supplier_catalog_wine_id uuid not null references public.supplier_catalog_wines(id) on delete cascade,
    name text not null,
    bottle_price numeric(12, 2) not null default 0 check (bottle_price >= 0),
    depletion_allowance numeric(12, 2) not null default 0 check (depletion_allowance >= 0),
    target_gp_margin numeric(8, 4) check (target_gp_margin is null or (target_gp_margin >= 0 and target_gp_margin < 1)),
    calculated_gp_margin numeric(8, 4) not null default 0,
    is_frontline boolean not null default false,
    is_best boolean not null default false,
    display_order integer not null default 0,
    active boolean not null default true,
    source_system text
        check (source_system is null or source_system in ('quickbooks_desktop', 'vinosmith', 'email', 'manual', 'stem')),
    source_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.supplier_catalog_free_goods (
    id uuid primary key default gen_random_uuid(),
    supplier_catalog_wine_id uuid not null references public.supplier_catalog_wines(id) on delete cascade,
    buy_quantity numeric(12, 2) not null default 0 check (buy_quantity >= 0),
    free_quantity numeric(12, 2) not null default 0 check (free_quantity >= 0),
    unit text not null default 'bottle' check (unit in ('bottle', 'case')),
    program_name text,
    starts_on date,
    ends_on date,
    notes text,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table if not exists public.supplier_catalog_workbench_items (
    id uuid primary key default gen_random_uuid(),
    report_run_id uuid references public.report_runs(id) on delete cascade,
    supplier_catalog_wine_id uuid not null references public.supplier_catalog_wines(id) on delete cascade,
    recommendation_status text not null default 'rejected'
        check (recommendation_status in ('rejected', 'approved', 'edited', 'deferred')),
    recommended_qty integer not null default 0 check (recommended_qty >= 0),
    approved_qty integer not null default 0 check (approved_qty >= 0),
    order_path text not null default 'stateside'
        check (order_path in ('stateside', 'di')),
    active boolean not null default true,
    notes text,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (report_run_id, supplier_catalog_wine_id)
);

alter table public.purchase_order_lines
    add column if not exists supplier_catalog_wine_id uuid references public.supplier_catalog_wines(id),
    add column if not exists is_new_item boolean not null default false,
    add column if not exists new_item_warning text;

create index if not exists idx_supplier_catalog_wines_copied_from
    on public.supplier_catalog_wines(copied_from_supplier_catalog_wine_id);

create index if not exists idx_supplier_catalog_wines_system_tags
    on public.supplier_catalog_wines using gin(system_tags);

create index if not exists idx_supplier_catalog_price_levels_wine
    on public.supplier_catalog_price_levels(supplier_catalog_wine_id, active, display_order);

create index if not exists idx_supplier_catalog_free_goods_wine
    on public.supplier_catalog_free_goods(supplier_catalog_wine_id, active);

create index if not exists idx_supplier_catalog_workbench_items_report
    on public.supplier_catalog_workbench_items(report_run_id, active);

create index if not exists idx_supplier_catalog_workbench_items_wine
    on public.supplier_catalog_workbench_items(supplier_catalog_wine_id);

create index if not exists idx_po_lines_supplier_catalog_wine
    on public.purchase_order_lines(supplier_catalog_wine_id);

alter table public.supplier_catalog_price_levels enable row level security;
alter table public.supplier_catalog_free_goods enable row level security;
alter table public.supplier_catalog_workbench_items enable row level security;

grant select, insert, update, delete on public.supplier_catalog_price_levels to authenticated;
grant select, insert, update, delete on public.supplier_catalog_free_goods to authenticated;
grant select, insert, update on public.supplier_catalog_workbench_items to authenticated;

drop policy if exists "authenticated users can read supplier catalog price levels"
    on public.supplier_catalog_price_levels;

create policy "authenticated users can read supplier catalog price levels"
    on public.supplier_catalog_price_levels for select
    to authenticated
    using (true);

drop policy if exists "buyer and admin profiles can manage supplier catalog price levels"
    on public.supplier_catalog_price_levels;

create policy "buyer and admin profiles can manage supplier catalog price levels"
    on public.supplier_catalog_price_levels for all
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "authenticated users can read supplier catalog free goods"
    on public.supplier_catalog_free_goods;

create policy "authenticated users can read supplier catalog free goods"
    on public.supplier_catalog_free_goods for select
    to authenticated
    using (true);

drop policy if exists "buyer and admin profiles can manage supplier catalog free goods"
    on public.supplier_catalog_free_goods;

create policy "buyer and admin profiles can manage supplier catalog free goods"
    on public.supplier_catalog_free_goods for all
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "authenticated users can read supplier catalog workbench items"
    on public.supplier_catalog_workbench_items;

create policy "authenticated users can read supplier catalog workbench items"
    on public.supplier_catalog_workbench_items for select
    to authenticated
    using (true);

drop policy if exists "buyer and admin profiles can create supplier catalog workbench items"
    on public.supplier_catalog_workbench_items;

create policy "buyer and admin profiles can create supplier catalog workbench items"
    on public.supplier_catalog_workbench_items for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "buyer and admin profiles can update supplier catalog workbench items"
    on public.supplier_catalog_workbench_items;

create policy "buyer and admin profiles can update supplier catalog workbench items"
    on public.supplier_catalog_workbench_items for update
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
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

    select *
      into v_existing
      from public.supplier_catalog_wines
     where planning_sku = p_catalog->>'planning_sku'
     limit 1;

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
               quickbooks_item_id = coalesce(nullif(p_catalog->>'quickbooks_item_id', ''), v_existing.quickbooks_item_id),
               quickbooks_item_name = coalesce(nullif(p_catalog->>'quickbooks_item_name', ''), v_existing.quickbooks_item_name),
               quickbooks_item_number = coalesce(nullif(p_catalog->>'quickbooks_item_number', ''), v_existing.quickbooks_item_number),
               quickbooks_sync_status = case
                   when v_existing.quickbooks_sync_status = 'linked' then 'linked'
                   else coalesce(nullif(p_catalog->>'quickbooks_sync_status', ''), 'not_created')
               end,
               product_lifecycle_status = case
                   when v_existing.product_lifecycle_status = 'active_product' then 'active_product'
                   else coalesce(nullif(p_catalog->>'product_lifecycle_status', ''), 'supplier_available')
               end,
               accounting_create_payload = coalesce(p_catalog->'accounting_create_payload', '{}'::jsonb),
               system_tags = coalesce(array(select jsonb_array_elements_text(coalesce(p_catalog->'system_tags', '[]'::jsonb))), '{}'),
               copied_from_supplier_catalog_wine_id = coalesce(
                   nullif(p_catalog->>'copied_from_supplier_catalog_wine_id', '')::uuid,
                   v_existing.copied_from_supplier_catalog_wine_id
               ),
               source_system = coalesce(nullif(p_catalog->>'source_system', ''), v_existing.source_system),
               source_id = coalesce(nullif(p_catalog->>'source_id', ''), v_existing.source_id),
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
            active
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
            coalesce((v_free_good->>'active')::boolean, true)
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
