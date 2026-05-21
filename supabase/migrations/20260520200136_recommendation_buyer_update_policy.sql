-- Let authenticated buyer/admin profiles autosave recommendation approval state
-- from the hosted app. Service-role workers still bypass RLS for ingestion.

grant update (recommendation_status, approved_qty)
    on public.reorder_recommendations
    to authenticated;

drop policy if exists "buyer and admin profiles can update recommendation approval"
    on public.reorder_recommendations;

create policy "buyer and admin profiles can update recommendation approval"
    on public.reorder_recommendations for update
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );
