-- Supplier logistics are editable application data, not a file-management task.
-- This extends the existing suppliers table so importer.csv can become a seed
-- and fallback source instead of the normal operating workflow.

alter table public.suppliers
    add column if not exists trucking_cost_per_bottle numeric(12, 4) not null default 0,
    add column if not exists active boolean not null default true;

create index if not exists idx_suppliers_active_name
    on public.suppliers(active, name);
