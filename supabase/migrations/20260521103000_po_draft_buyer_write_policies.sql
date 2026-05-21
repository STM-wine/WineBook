-- Allow hosted buyer/admin users to create and manage PO drafts from approved
-- recommendations. Read access already exists from the initial MVP policies.

grant insert
    on public.purchase_order_drafts
    to authenticated;

grant update (status, notes, updated_at, reviewed_by)
    on public.purchase_order_drafts
    to authenticated;

grant insert
    on public.purchase_order_lines
    to authenticated;

drop policy if exists "buyer and admin profiles can create purchase order drafts"
    on public.purchase_order_drafts;

create policy "buyer and admin profiles can create purchase order drafts"
    on public.purchase_order_drafts for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "buyer and admin profiles can update purchase order drafts"
    on public.purchase_order_drafts;

create policy "buyer and admin profiles can update purchase order drafts"
    on public.purchase_order_drafts for update
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

drop policy if exists "buyer and admin profiles can create purchase order lines"
    on public.purchase_order_lines;

create policy "buyer and admin profiles can create purchase order lines"
    on public.purchase_order_lines for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );
