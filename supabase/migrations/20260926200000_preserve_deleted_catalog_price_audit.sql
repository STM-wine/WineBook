-- Complete the audit-retention change intended by 20260925053000.
-- PostgreSQL generated a shortened FK name by shortening its component names;
-- truncating the guessed full name did not identify that constraint. Find the
-- exact relationship instead. Historical rows retain the deleted wine UUID.
-- Live price-level -> wine constraints and all guarded deletion checks remain.
do $migration$
declare
    audit_fk record;
begin
    for audit_fk in
        select constraint_row.conname
        from pg_constraint constraint_row
        where constraint_row.contype = 'f'
          and constraint_row.conrelid = 'public.supplier_catalog_price_level_audit'::regclass
          and constraint_row.confrelid = 'public.supplier_catalog_wines'::regclass
          and constraint_row.conkey = array[
              (select attnum from pg_attribute
               where attrelid = 'public.supplier_catalog_price_level_audit'::regclass
                 and attname = 'supplier_catalog_wine_id' and not attisdropped)
          ]::smallint[]
          and constraint_row.confkey = array[
              (select attnum from pg_attribute
               where attrelid = 'public.supplier_catalog_wines'::regclass
                 and attname = 'id' and not attisdropped)
          ]::smallint[]
    loop
        execute format('alter table public.supplier_catalog_price_level_audit drop constraint %I', audit_fk.conname);
    end loop;
end;
$migration$;

comment on column public.supplier_catalog_price_level_audit.supplier_catalog_wine_id is
    'Historical wine identity retained after guarded deletion of a pending catalog product; intentionally not a cascading foreign key.';
