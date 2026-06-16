-- Speed up validation/parity reports that fetch rescued order lines by their
-- parent supplier order IDs.
create index if not exists idx_vinosmith_order_lines_supplier_order
    on public.vinosmith_order_lines(supplier_order_id);
