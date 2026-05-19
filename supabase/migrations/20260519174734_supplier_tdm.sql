-- Track the buyer-facing Trade Development Manager / Brand Manager value
-- editable from Supplier Hub supplier logistics.

alter table public.suppliers
    add column if not exists tdm text;
