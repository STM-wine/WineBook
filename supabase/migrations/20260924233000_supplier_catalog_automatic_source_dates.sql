-- Source dates are backend provenance. Buyers should not have to enter them,
-- and editing an existing wine must not erase its original dates.

alter table public.supplier_catalog_wines
    alter column fob_source_date
        set default ((now() at time zone 'America/Phoenix')::date),
    alter column laid_in_source_date
        set default ((now() at time zone 'America/Phoenix')::date);

update public.supplier_catalog_wines
set fob_source_date = coalesce(
        fob_source_date,
        (created_at at time zone 'America/Phoenix')::date
    ),
    laid_in_source_date = coalesce(
        laid_in_source_date,
        (created_at at time zone 'America/Phoenix')::date
    )
where fob_source_date is null
   or laid_in_source_date is null;

create or replace function public.set_supplier_catalog_source_dates()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_created_date date := coalesce(
        (new.created_at at time zone 'America/Phoenix')::date,
        (now() at time zone 'America/Phoenix')::date
    );
begin
    if tg_op = 'INSERT' then
        new.fob_source_date = coalesce(new.fob_source_date, v_created_date);
        new.laid_in_source_date = coalesce(new.laid_in_source_date, v_created_date);
    else
        new.fob_source_date = coalesce(new.fob_source_date, old.fob_source_date, v_created_date);
        new.laid_in_source_date = coalesce(new.laid_in_source_date, old.laid_in_source_date, v_created_date);
    end if;
    return new;
end;
$$;

drop trigger if exists trg_supplier_catalog_source_dates
    on public.supplier_catalog_wines;

create trigger trg_supplier_catalog_source_dates
before insert or update of fob_source_date, laid_in_source_date
on public.supplier_catalog_wines
for each row execute function public.set_supplier_catalog_source_dates();

notify pgrst, 'reload schema';
