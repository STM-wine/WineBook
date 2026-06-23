-- Treat draft-only not-created supplier wines as pending product creation so
-- they can be cleared safely even if older rows were saved as exact matches.

drop policy if exists "buyer and admin profiles can delete pending supplier catalog wines"
    on public.supplier_catalog_wines;

create policy "buyer and admin profiles can delete pending supplier catalog wines"
    on public.supplier_catalog_wines for delete
    to authenticated
    using (
        product_lifecycle_status <> 'active_product'
        and quickbooks_sync_status not in ('created', 'linked')
        and quickbooks_item_id is null
        and quickbooks_item_number is null
        and (
            product_lifecycle_status = 'pending_product_creation'
            or quickbooks_sync_status = 'not_created'
            or conversion_status in (
                'new_vintage',
                'new_format',
                'possible_match_needs_review',
                'net_new_product'
            )
        )
        and exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

notify pgrst, 'reload schema';
