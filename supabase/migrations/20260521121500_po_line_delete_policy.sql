-- Allow hosted buyer/admin users to remove a line from an active PO draft
-- during PO Draft review.

grant delete
    on public.purchase_order_lines
    to authenticated;

drop policy if exists "buyer and admin profiles can delete purchase order lines"
    on public.purchase_order_lines;

create policy "buyer and admin profiles can delete purchase order lines"
    on public.purchase_order_lines for delete
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );
