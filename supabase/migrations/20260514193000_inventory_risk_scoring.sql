-- Operational inventory risk scoring fields.
-- These are calculated from RB6 inventory and RADs sales only; they are not
-- accounting aging fields and do not require QuickBooks receipt data.

alter table public.reorder_recommendations
    add column if not exists inventory_value numeric(12, 2) not null default 0,
    add column if not exists days_since_last_sale integer,
    add column if not exists inventory_risk_label text
        check (inventory_risk_label in ('LOW', 'WATCH', 'HIGH RISK', 'FREEZE')),
    add column if not exists inventory_risk_reason text;

create index if not exists idx_recommendations_inventory_risk
    on public.reorder_recommendations(report_run_id, inventory_risk_label);
