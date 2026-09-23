-- Keep the user and timestamp that changed automatic-reorder suppression
-- separate from generic marker edits. Snapshot the same fields onto generated
-- recommendations so an ordering run remains auditable.

alter table public.ordering_item_markers
    add column if not exists suppression_changed_at timestamptz,
    add column if not exists suppression_changed_by uuid;

update public.ordering_item_markers
set suppression_changed_at = coalesce(suppression_changed_at, updated_at),
    suppression_changed_by = coalesce(suppression_changed_by, updated_by)
where recommendations_suppressed
  and suppression_changed_at is null;

alter table public.reorder_recommendations
    add column if not exists suppression_reason text,
    add column if not exists suppressed_until date,
    add column if not exists suppression_changed_at timestamptz,
    add column if not exists suppression_changed_by uuid;

notify pgrst, 'reload schema';
