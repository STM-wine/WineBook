-- Preserve the source facts used to create PO drafts without expanding the PO
-- schema every time ordering inputs change.

alter table public.purchase_order_drafts
    add column if not exists ordering_source text not null default 'report'
        check (ordering_source in ('report', 'database')),
    add column if not exists source_snapshot jsonb not null default '{}'::jsonb;

alter table public.purchase_order_lines
    add column if not exists source_snapshot jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
