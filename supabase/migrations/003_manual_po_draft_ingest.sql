-- Transitional fields for creating PO drafts from saved recommendations before
-- the normalized product and supplier catalog is fully populated.

alter table public.purchase_order_drafts
    add column if not exists supplier_name text;

alter table public.purchase_order_lines
    alter column product_id drop not null;

alter table public.purchase_order_lines
    add column if not exists product_name text,
    add column if not exists product_code text,
    add column if not exists planning_sku text;

create index if not exists idx_po_drafts_report_run_supplier_name
    on public.purchase_order_drafts(report_run_id, supplier_name);

create index if not exists idx_po_lines_planning_sku
    on public.purchase_order_lines(planning_sku);
