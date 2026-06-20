-- Store the producer that should appear on PO exports instead of inferring it
-- from the product display name, which can truncate multi-word producers.

alter table public.purchase_order_lines
    add column if not exists producer_name text;

notify pgrst, 'reload schema';
