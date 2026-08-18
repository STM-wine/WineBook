-- App-owned ordering markers.
--
-- These replace Vinosmith as the source of truth for BTG/Core ordering
-- behavior. Rows are keyed by exact item code so they can be joined to
-- QuickBooks items, Vinosmith wines, and future upload/export workflows.

create table if not exists public.ordering_item_markers (
    item_code text primary key
        check (length(btrim(item_code)) > 0),
    quickbooks_item_list_id text references public.quickbooks_items(list_id) on delete set null,
    source_file_id uuid references public.source_files(id) on delete set null,
    is_btg boolean not null default false,
    is_core boolean not null default false,
    marker_note text,
    note_source text not null default 'manual'
        check (note_source in ('manual', 'initial_upload', 'rep_request', 'system')),
    created_by uuid references public.app_profiles(id),
    updated_by uuid references public.app_profiles(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.ordering_item_marker_history (
    id uuid primary key default gen_random_uuid(),
    item_code text not null,
    action text not null check (action in ('insert', 'update', 'delete')),
    previous_values jsonb,
    new_values jsonb,
    change_note text,
    changed_by uuid references public.app_profiles(id),
    changed_at timestamptz not null default now()
);

create index if not exists idx_ordering_item_markers_quickbooks_item
    on public.ordering_item_markers(quickbooks_item_list_id);

create index if not exists idx_ordering_item_markers_btg
    on public.ordering_item_markers(item_code)
    where is_btg = true;

create index if not exists idx_ordering_item_markers_core
    on public.ordering_item_markers(item_code)
    where is_core = true;

create index if not exists idx_ordering_item_markers_updated_at
    on public.ordering_item_markers(updated_at desc);

create index if not exists idx_ordering_item_marker_history_item_code
    on public.ordering_item_marker_history(item_code, changed_at desc);

create or replace function public.touch_ordering_item_markers()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.item_code = upper(btrim(new.item_code));

    if new.item_code = '' then
        raise exception 'Ordering marker item_code cannot be empty.';
    end if;

    if new.note_source is null then
        new.note_source = 'manual';
    end if;

    new.updated_at = now();
    new.updated_by = coalesce(new.updated_by, (select auth.uid()));

    if tg_op = 'INSERT' then
        new.created_at = coalesce(new.created_at, now());
        new.created_by = coalesce(new.created_by, new.updated_by);
    end if;

    return new;
end;
$$;

drop trigger if exists ordering_item_markers_touch
    on public.ordering_item_markers;

create trigger ordering_item_markers_touch
    before insert or update on public.ordering_item_markers
    for each row
    execute function public.touch_ordering_item_markers();

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
    )
    values (
        v_item_code,
        v_action,
        case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
        case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
        v_change_note,
        v_changed_by
    );

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

drop trigger if exists ordering_item_markers_history
    on public.ordering_item_markers;

create trigger ordering_item_markers_history
    after insert or update or delete on public.ordering_item_markers
    for each row
    execute function public.record_ordering_item_marker_history();

alter table public.ordering_item_markers enable row level security;
alter table public.ordering_item_marker_history enable row level security;

create policy "settings users can read ordering item markers"
    on public.ordering_item_markers for select
    to authenticated
    using (
        exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in (
                  'view_settings',
                  'view_logic_settings',
                  'view_settings_history',
                  'draft_logic_changes',
                  'manage_supplier_settings'
              )
        )
    );

create policy "settings admins can create ordering item markers"
    on public.ordering_item_markers for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in ('draft_logic_changes', 'manage_supplier_settings')
        )
    );

create policy "settings admins can update ordering item markers"
    on public.ordering_item_markers for update
    to authenticated
    using (
        exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in ('draft_logic_changes', 'manage_supplier_settings')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in ('draft_logic_changes', 'manage_supplier_settings')
        )
    );

create policy "settings admins can delete ordering item markers"
    on public.ordering_item_markers for delete
    to authenticated
    using (
        exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in ('draft_logic_changes', 'manage_supplier_settings')
        )
    );

create policy "settings users can read ordering item marker history"
    on public.ordering_item_marker_history for select
    to authenticated
    using (
        exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in (
                  'view_settings',
                  'view_logic_settings',
                  'view_settings_history',
                  'draft_logic_changes',
                  'manage_supplier_settings'
              )
        )
    );

grant select, insert, update, delete on table public.ordering_item_markers to authenticated;
grant select on table public.ordering_item_marker_history to authenticated;
grant select, insert, update, delete on table public.ordering_item_markers to service_role;
grant select, insert, update, delete on table public.ordering_item_marker_history to service_role;

comment on table public.ordering_item_markers is
    'Stem-owned BTG/Core ordering markers keyed by exact item code.';

comment on column public.ordering_item_markers.marker_note is
    'Human or workflow note explaining why this marker row exists or changed. Rep wine requests can populate this later.';

comment on table public.ordering_item_marker_history is
    'Audit history for ordering marker changes, including previous/new row values and the note at the time of change.';
