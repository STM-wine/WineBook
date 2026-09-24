-- Order Summary exposes replenishment policy and recommendation suppression
-- to buyers. Keep the database policy aligned with that application role while
-- retaining the existing explicit settings-permission path.

drop policy if exists "settings users can read ordering item markers"
    on public.ordering_item_markers;
drop policy if exists "buyer and admin profiles can read ordering item markers"
    on public.ordering_item_markers;

create policy "buyer and admin profiles can read ordering item markers"
    on public.ordering_item_markers for select
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
        or exists (
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

drop policy if exists "settings admins can create ordering item markers"
    on public.ordering_item_markers;
drop policy if exists "buyer and admin profiles can create ordering item markers"
    on public.ordering_item_markers;

create policy "buyer and admin profiles can create ordering item markers"
    on public.ordering_item_markers for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
        or exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in ('draft_logic_changes', 'manage_supplier_settings')
        )
    );

drop policy if exists "settings admins can update ordering item markers"
    on public.ordering_item_markers;
drop policy if exists "buyer and admin profiles can update ordering item markers"
    on public.ordering_item_markers;

create policy "buyer and admin profiles can update ordering item markers"
    on public.ordering_item_markers for update
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
        or exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in ('draft_logic_changes', 'manage_supplier_settings')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
        or exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in ('draft_logic_changes', 'manage_supplier_settings')
        )
    );

notify pgrst, 'reload schema';
