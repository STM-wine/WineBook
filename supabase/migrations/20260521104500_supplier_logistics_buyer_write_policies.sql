-- Supplier logistics are app-managed data in the hosted workflow. Buyers/admins
-- can maintain logistics records without editing importers.csv.

grant insert
    on public.suppliers
    to authenticated;

grant update (
    importer_id,
    name,
    eta_days,
    pick_up_location,
    freight_forwarder,
    order_frequency,
    tdm,
    trucking_cost_per_bottle,
    notes,
    active,
    updated_at
)
    on public.suppliers
    to authenticated;

drop policy if exists "buyer and admin profiles can create suppliers"
    on public.suppliers;

create policy "buyer and admin profiles can create suppliers"
    on public.suppliers for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = auth.uid()
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "buyer and admin profiles can update suppliers"
    on public.suppliers;

create policy "buyer and admin profiles can update suppliers"
    on public.suppliers for update
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
