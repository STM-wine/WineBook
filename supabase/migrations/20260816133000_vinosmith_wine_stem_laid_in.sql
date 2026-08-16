-- Materialize Stem supplier logistics onto Vinosmith items so GP calculations do
-- not need to resolve importer logistics on every dashboard request.

alter table public.vinosmith_wines
    add column if not exists stem_laid_in_per_bottle numeric(12, 4) not null default 0,
    add column if not exists stem_laid_in_source text,
    add column if not exists stem_laid_in_updated_at timestamptz;

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
                where lower(trim(supplier.name)) = lower(trim(wine.importer_name))
                order by supplier.active desc, supplier.updated_at desc nulls last, supplier.name
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
            where lower(trim(supplier.name)) = lower(trim(new.importer_name))
            order by supplier.active desc, supplier.updated_at desc nulls last, supplier.name
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
        else null
    end;
    new.stem_laid_in_updated_at = now();

    return new;
end;
$$;

drop trigger if exists trg_apply_vinosmith_wine_stem_laid_in on public.vinosmith_wines;
create trigger trg_apply_vinosmith_wine_stem_laid_in
    before insert or update of importer_name
    on public.vinosmith_wines
    for each row
    execute function public.apply_vinosmith_wine_stem_laid_in();

create or replace function public.refresh_vinosmith_wine_stem_laid_in_for_supplier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.vinosmith_wines wine
    set
        stem_laid_in_per_bottle = coalesce(new.trucking_cost_per_bottle, 0),
        stem_laid_in_source = 'suppliers.trucking_cost_per_bottle',
        stem_laid_in_updated_at = now()
    where lower(trim(wine.importer_name)) = lower(trim(new.name));

    if tg_op = 'UPDATE' and lower(trim(old.name)) <> lower(trim(new.name)) then
        update public.vinosmith_wines wine
        set
            stem_laid_in_per_bottle = 0,
            stem_laid_in_source = null,
            stem_laid_in_updated_at = now()
        where lower(trim(wine.importer_name)) = lower(trim(old.name));
    end if;

    return null;
end;
$$;

drop trigger if exists trg_refresh_vinosmith_wine_stem_laid_in_for_supplier on public.suppliers;
create trigger trg_refresh_vinosmith_wine_stem_laid_in_for_supplier
    after insert or update of name, trucking_cost_per_bottle, active
    on public.suppliers
    for each row
    execute function public.refresh_vinosmith_wine_stem_laid_in_for_supplier();

select public.refresh_vinosmith_wine_stem_laid_in();
