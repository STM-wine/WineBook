-- Keep Add Wine's catalog identity aligned with the authoritative QuickBooks SKU.
-- This repairs rows created before the UI detached copied QuickBooks references
-- when the buyer changed the vintage or other SKU-defining fields.

with supplier_matches as (
    select distinct on (catalog.id)
        catalog.id as catalog_id,
        supplier.id as supplier_id,
        supplier.name as supplier_name
    from public.supplier_catalog_wines catalog
    join public.reorder_recommendations recommendation
      on upper(regexp_replace(coalesce(recommendation.product_code, ''), '[^A-Za-z0-9]', '', 'g')) =
         upper(regexp_replace(coalesce(catalog.quickbooks_item_number, ''), '[^A-Za-z0-9]', '', 'g'))
    join public.suppliers supplier
      on lower(btrim(supplier.name)) = lower(btrim(recommendation.supplier_name))
    where catalog.supplier_id is null
      and nullif(btrim(catalog.quickbooks_item_number), '') is not null
    order by catalog.id, recommendation.created_at desc, recommendation.id desc
)
update public.supplier_catalog_wines catalog
   set supplier_id = matched.supplier_id,
       supplier_name = matched.supplier_name,
       updated_at = now()
  from supplier_matches matched
 where catalog.id = matched.catalog_id;

update public.supplier_catalog_wines
   set quickbooks_item_id = null,
       quickbooks_item_name = null,
       quickbooks_sync_status = 'not_created',
       updated_at = now()
 where product_lifecycle_status = 'pending_product_creation'
   and quickbooks_sync_status in ('linked', 'created')
   and nullif(btrim(quickbooks_item_number), '') is null;

alter table public.supplier_catalog_wines
    drop constraint if exists supplier_catalog_linked_requires_item_number;

alter table public.supplier_catalog_wines
    add constraint supplier_catalog_linked_requires_item_number
    check (
        quickbooks_sync_status not in ('linked', 'created')
        or nullif(btrim(quickbooks_item_number), '') is not null
    ) not valid;

alter table public.supplier_catalog_wines
    validate constraint supplier_catalog_linked_requires_item_number;
