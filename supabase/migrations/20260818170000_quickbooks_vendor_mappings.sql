-- App-owned vendor classification and supplier matching.
--
-- QuickBooks remains the source of truth for vendor identity and active
-- status. Stem owns the business classification and optional match to the
-- supplier logistics row used by ordering and freight workflows.

create table if not exists public.quickbooks_vendor_mappings (
    quickbooks_vendor_list_id text primary key references public.quickbooks_vendors(list_id) on delete cascade,
    supplier_id uuid references public.suppliers(id) on delete set null,
    vendor_classification text not null default 'unclassified'
        check (vendor_classification in (
            'unclassified',
            'inventory_wine',
            'freight_logistics',
            'service_expense',
            'other'
        )),
    notes text,
    created_by uuid references public.app_profiles(id),
    updated_by uuid references public.app_profiles(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_quickbooks_vendor_mappings_supplier
    on public.quickbooks_vendor_mappings(supplier_id);

create index if not exists idx_quickbooks_vendor_mappings_classification
    on public.quickbooks_vendor_mappings(vendor_classification);

create or replace function public.touch_quickbooks_vendor_mappings()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at = now();
    new.updated_by = coalesce(new.updated_by, (select auth.uid()));

    if tg_op = 'INSERT' then
        new.created_at = coalesce(new.created_at, now());
        new.created_by = coalesce(new.created_by, new.updated_by);
    end if;

    return new;
end;
$$;

drop trigger if exists quickbooks_vendor_mappings_touch
    on public.quickbooks_vendor_mappings;

create trigger quickbooks_vendor_mappings_touch
    before insert or update on public.quickbooks_vendor_mappings
    for each row
    execute function public.touch_quickbooks_vendor_mappings();

alter table public.quickbooks_vendor_mappings enable row level security;

create policy "authenticated users can read quickbooks vendor mappings"
    on public.quickbooks_vendor_mappings for select
    to authenticated
    using (true);

create policy "buyers and admins can create quickbooks vendor mappings"
    on public.quickbooks_vendor_mappings for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

create policy "buyers and admins can update quickbooks vendor mappings"
    on public.quickbooks_vendor_mappings for update
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

grant select, insert, update on table public.quickbooks_vendor_mappings to authenticated;
grant select, insert, update, delete on table public.quickbooks_vendor_mappings to service_role;

insert into public.quickbooks_vendor_mappings (
    quickbooks_vendor_list_id,
    supplier_id,
    vendor_classification,
    notes
)
select
    vendor.list_id,
    supplier.id,
    'inventory_wine',
    'Seeded by exact QB vendor name to Stem supplier name match.'
from public.quickbooks_vendors vendor
join public.suppliers supplier
  on lower(btrim(supplier.name)) = lower(btrim(coalesce(vendor.name, vendor.full_name)))
where vendor.is_active is distinct from false
on conflict (quickbooks_vendor_list_id) do update
set supplier_id = coalesce(public.quickbooks_vendor_mappings.supplier_id, excluded.supplier_id),
    vendor_classification = case
        when public.quickbooks_vendor_mappings.vendor_classification = 'unclassified'
            then excluded.vendor_classification
        else public.quickbooks_vendor_mappings.vendor_classification
    end,
    notes = coalesce(public.quickbooks_vendor_mappings.notes, excluded.notes),
    updated_at = now();

comment on table public.quickbooks_vendor_mappings is
    'Stem-owned classification and supplier match layer for QuickBooks vendors.';
