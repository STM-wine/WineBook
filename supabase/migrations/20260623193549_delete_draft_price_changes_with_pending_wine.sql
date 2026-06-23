-- Pending product deletion needs to clear draft-only price change rows before
-- deleting the supplier catalog wine referenced by the foreign key.

grant select, delete on public.price_change_events to authenticated;

drop policy if exists "buyer and admin profiles can delete draft price change events"
    on public.price_change_events;

create policy "buyer and admin profiles can delete draft price change events"
    on public.price_change_events for delete
    to authenticated
    using (
        status in ('draft', 'pending_review')
        and exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

notify pgrst, 'reload schema';
