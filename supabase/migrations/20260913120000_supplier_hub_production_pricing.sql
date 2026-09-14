-- Production pricing controls. All changes are additive so existing catalog,
-- supplier, pack, price-level and price-change records remain intact.

alter table public.supplier_catalog_wines
    add column if not exists pricing_model text not null default 'standard'
        check (pricing_model in ('standard', 'grw_broker')),
    add column if not exists fob_source_date date,
    add column if not exists laid_in_source_date date,
    add column if not exists pricing_calculated_at timestamptz,
    add column if not exists pricing_cost_fingerprint text;

alter table public.supplier_catalog_price_levels
    add column if not exists solve_for text not null default 'gp'
        check (solve_for in ('price', 'da', 'gp')),
    add column if not exists approval_decision text
        check (approval_decision is null or approval_decision in ('approve_price', 'pursue_da', 'revise', 'hold', 'no_change')),
    add column if not exists suggested_price numeric(12, 2),
    add column if not exists suggested_gp_margin numeric(8, 4),
    add column if not exists da_alternative numeric(12, 2),
    add column if not exists final_approved_price numeric(12, 2),
    add column if not exists final_approved_da numeric(12, 2),
    add column if not exists final_gp_margin numeric(8, 4),
    add column if not exists override_reason text,
    add column if not exists approval_owner text,
    add column if not exists decision_timestamp timestamptz;

create table if not exists public.supplier_catalog_price_level_audit (
    id uuid primary key default gen_random_uuid(),
    supplier_catalog_price_level_id uuid,
    supplier_catalog_wine_id uuid not null references public.supplier_catalog_wines(id) on delete cascade,
    operation text not null check (operation in ('insert', 'update', 'delete')),
    before_record jsonb,
    after_record jsonb,
    changed_by uuid default auth.uid(),
    changed_at timestamptz not null default now()
);

create index if not exists idx_supplier_catalog_price_level_audit_wine
    on public.supplier_catalog_price_level_audit(supplier_catalog_wine_id, changed_at desc);

create or replace function public.audit_supplier_catalog_price_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.supplier_catalog_price_level_audit (
        supplier_catalog_price_level_id,
        supplier_catalog_wine_id,
        operation,
        before_record,
        after_record
    ) values (
        case when tg_op = 'DELETE' then old.id else new.id end,
        case when tg_op = 'DELETE' then old.supplier_catalog_wine_id else new.supplier_catalog_wine_id end,
        lower(tg_op),
        case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
        case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
    );
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_audit_supplier_catalog_price_level on public.supplier_catalog_price_levels;
create trigger trg_audit_supplier_catalog_price_level
after insert or update or delete on public.supplier_catalog_price_levels
for each row execute function public.audit_supplier_catalog_price_level();

alter table public.supplier_catalog_price_level_audit enable row level security;
grant select on public.supplier_catalog_price_level_audit to authenticated;

drop policy if exists "authenticated users can read price level audit" on public.supplier_catalog_price_level_audit;
create policy "authenticated users can read price level audit"
    on public.supplier_catalog_price_level_audit for select
    to authenticated using (true);

comment on column public.supplier_catalog_wines.pricing_model is
    'grw_broker rows are informational-only and excluded from controllable pricing approvals.';
