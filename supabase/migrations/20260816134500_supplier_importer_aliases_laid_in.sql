-- Importer aliases let Vinosmith importer names map to Stem supplier logistics
-- without renaming either source-system value.

create table if not exists public.supplier_importer_aliases (
    importer_name text primary key,
    supplier_id uuid not null references public.suppliers(id) on delete cascade,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_importer_aliases_supplier
    on public.supplier_importer_aliases(supplier_id);

create or replace function public.refresh_vinosmith_wine_stem_laid_in()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    updated_count integer;
begin
    update public.vinosmith_wines wine
    set
        stem_laid_in_per_bottle = coalesce(
            (
                select supplier.trucking_cost_per_bottle
                from public.suppliers supplier
                left join public.supplier_importer_aliases alias
                    on alias.supplier_id = supplier.id
                where lower(trim(supplier.name)) = lower(trim(wine.importer_name))
                    or lower(trim(alias.importer_name)) = lower(trim(wine.importer_name))
                order by
                    case when lower(trim(supplier.name)) = lower(trim(wine.importer_name)) then 0 else 1 end,
                    supplier.active desc,
                    supplier.updated_at desc nulls last,
                    supplier.name
                limit 1
            ),
            0
        ),
        stem_laid_in_source = case
            when exists (
                select 1
                from public.suppliers supplier
                where lower(trim(supplier.name)) = lower(trim(wine.importer_name))
            ) then 'suppliers.trucking_cost_per_bottle'
            when exists (
                select 1
                from public.supplier_importer_aliases alias
                where lower(trim(alias.importer_name)) = lower(trim(wine.importer_name))
            ) then 'supplier_importer_aliases'
            else null
        end,
        stem_laid_in_updated_at = now();

    get diagnostics updated_count = row_count;
    return updated_count;
end;
$$;

create or replace function public.apply_vinosmith_wine_stem_laid_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.stem_laid_in_per_bottle = coalesce(
        (
            select supplier.trucking_cost_per_bottle
            from public.suppliers supplier
            left join public.supplier_importer_aliases alias
                on alias.supplier_id = supplier.id
            where lower(trim(supplier.name)) = lower(trim(new.importer_name))
                or lower(trim(alias.importer_name)) = lower(trim(new.importer_name))
            order by
                case when lower(trim(supplier.name)) = lower(trim(new.importer_name)) then 0 else 1 end,
                supplier.active desc,
                supplier.updated_at desc nulls last,
                supplier.name
            limit 1
        ),
        0
    );
    new.stem_laid_in_source = case
        when exists (
            select 1
            from public.suppliers supplier
            where lower(trim(supplier.name)) = lower(trim(new.importer_name))
        ) then 'suppliers.trucking_cost_per_bottle'
        when exists (
            select 1
            from public.supplier_importer_aliases alias
            where lower(trim(alias.importer_name)) = lower(trim(new.importer_name))
        ) then 'supplier_importer_aliases'
        else null
    end;
    new.stem_laid_in_updated_at = now();

    return new;
end;
$$;

create or replace function public.refresh_vinosmith_wine_stem_laid_in_for_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.refresh_vinosmith_wine_stem_laid_in();
    return null;
end;
$$;

drop trigger if exists trg_refresh_vinosmith_wine_stem_laid_in_for_alias on public.supplier_importer_aliases;
create trigger trg_refresh_vinosmith_wine_stem_laid_in_for_alias
    after insert or update or delete
    on public.supplier_importer_aliases
    for each statement
    execute function public.refresh_vinosmith_wine_stem_laid_in_for_alias();

select public.refresh_vinosmith_wine_stem_laid_in();
