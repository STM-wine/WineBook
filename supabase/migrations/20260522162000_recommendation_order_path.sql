-- Buyer-controlled procurement path for V1 Direct Import planning.
-- Eligibility is seeded in application logic; this field stores only the
-- buyer's selected row-level path. All rows default to Stateside.

alter table public.reorder_recommendations
    add column if not exists order_path text not null default 'stateside';

alter table public.reorder_recommendations
    drop constraint if exists reorder_recommendations_order_path_check;

alter table public.reorder_recommendations
    add constraint reorder_recommendations_order_path_check
    check (order_path in ('stateside', 'di'));

create index if not exists idx_recommendations_order_path
    on public.reorder_recommendations(report_run_id, order_path);

grant update (order_path)
    on public.reorder_recommendations
    to authenticated;
