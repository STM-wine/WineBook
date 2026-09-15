-- Replace the Core/BTG-only marker model with explicit replenishment policy.
-- Keep the legacy booleans for rollback and historical compatibility.

alter table public.ordering_item_markers
    add column if not exists replenishment_policy text not null default 'Limited',
    add column if not exists policy_family_key text,
    add column if not exists policy_family_name text,
    add column if not exists family_default_policy text not null default 'Limited',
    add column if not exists recommendations_suppressed boolean not null default false,
    add column if not exists suppression_reason text,
    add column if not exists suppressed_until date;

alter table public.ordering_item_markers
    drop constraint if exists ordering_item_markers_replenishment_policy_check,
    add constraint ordering_item_markers_replenishment_policy_check
        check (replenishment_policy in ('Core', 'Limited Core', 'Limited', 'Allocated', 'Special Order')),
    drop constraint if exists ordering_item_markers_family_default_policy_check,
    add constraint ordering_item_markers_family_default_policy_check
        check (family_default_policy in ('Core', 'Limited Core', 'Limited', 'Allocated', 'Special Order')),
    drop constraint if exists ordering_item_markers_suppression_policy_check,
    add constraint ordering_item_markers_suppression_policy_check
        check (not recommendations_suppressed or replenishment_policy = 'Limited');

update public.ordering_item_markers
set replenishment_policy = case when is_core or is_btg then 'Core' else 'Limited' end,
    family_default_policy = case when is_core or is_btg then 'Core' else 'Limited' end,
    is_core = is_core or is_btg,
    is_btg = false
where replenishment_policy = 'Limited'
  and family_default_policy = 'Limited';

create index if not exists idx_ordering_item_markers_policy
    on public.ordering_item_markers(replenishment_policy, item_code);

create index if not exists idx_ordering_item_markers_family
    on public.ordering_item_markers(policy_family_key)
    where policy_family_key is not null;

alter table public.reorder_recommendations
    add column if not exists replenishment_policy text not null default 'Limited',
    add column if not exists policy_family_key text,
    add column if not exists recommendations_suppressed boolean not null default false;

alter table public.reorder_recommendations
    drop constraint if exists reorder_recommendations_replenishment_policy_check,
    add constraint reorder_recommendations_replenishment_policy_check
        check (replenishment_policy in ('Core', 'Limited Core', 'Limited', 'Allocated', 'Special Order'));

update public.reorder_recommendations
set replenishment_policy = 'Core'
where is_core or is_btg;

create index if not exists idx_reorder_recommendations_policy
    on public.reorder_recommendations(report_run_id, replenishment_policy);

create or replace function public.record_ordering_item_marker_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_action text;
    v_item_code text;
    v_changed_by uuid;
    v_change_note text;
begin
    if tg_op = 'INSERT' then
        v_action = 'insert';
        v_item_code = new.item_code;
        v_changed_by = coalesce(new.updated_by, new.created_by, (select auth.uid()));
        v_change_note = new.marker_note;
    elsif tg_op = 'UPDATE' then
        v_action = 'update';
        v_item_code = new.item_code;
        v_changed_by = coalesce(new.updated_by, (select auth.uid()));
        v_change_note = new.marker_note;

        if old.is_btg is not distinct from new.is_btg
           and old.is_core is not distinct from new.is_core
           and old.replenishment_policy is not distinct from new.replenishment_policy
           and old.policy_family_key is not distinct from new.policy_family_key
           and old.policy_family_name is not distinct from new.policy_family_name
           and old.family_default_policy is not distinct from new.family_default_policy
           and old.recommendations_suppressed is not distinct from new.recommendations_suppressed
           and old.suppression_reason is not distinct from new.suppression_reason
           and old.suppressed_until is not distinct from new.suppressed_until
           and old.marker_note is not distinct from new.marker_note
           and old.note_source is not distinct from new.note_source
           and old.quickbooks_item_list_id is not distinct from new.quickbooks_item_list_id
           and old.source_file_id is not distinct from new.source_file_id then
            return new;
        end if;
    else
        v_action = 'delete';
        v_item_code = old.item_code;
        v_changed_by = coalesce(old.updated_by, (select auth.uid()));
        v_change_note = old.marker_note;
    end if;

    insert into public.ordering_item_marker_history (
        item_code,
        action,
        previous_values,
        new_values,
        change_note,
        changed_by
    ) values (
        v_item_code,
        v_action,
        case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
        case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
        v_change_note,
        v_changed_by
    );

    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

notify pgrst, 'reload schema';
