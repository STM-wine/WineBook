update public.vinosmith_order_lines
set
    price_id = coalesce(
        nullif(price_id, ''),
        nullif(raw_data->>'price_id', ''),
        nullif(raw_data #>> '{price,id}', '')
    ),
    price_label = coalesce(
        nullif(price_label, ''),
        nullif(raw_data->>'price_label', ''),
        nullif(raw_data #>> '{price,label}', '')
    )
where
    price_id is null
    or price_id = ''
    or price_label is null
    or price_label = '';
