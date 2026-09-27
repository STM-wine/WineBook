-- Run after the three performance migrations against a disposable/local database.
begin;
do $$
declare j public.read_model_jobs; claimed public.read_model_jobs; second public.read_model_jobs;
  page jsonb; counts jsonb; detail jsonb; rows jsonb; ok boolean;
begin
  j := public.request_read_model('products','performance-test','test-v1','{}');
  claimed := public.claim_read_model();
  if claimed.id <> j.id then raise exception 'Use an empty disposable jobs table for this test'; end if;
  second := public.claim_read_model();
  if second.id is not null then raise exception 'Concurrent claim duplicated work'; end if;
  select jsonb_agg(jsonb_build_object('id', 'item-'||n, 'itemCode', lpad(n::text,5,'0'),
    'productName', 'Same name', 'supplierName','Supplier', 'active', n <> 1001, 'fob', n,
    'statusKey',case when n=1001 then 'qb_inactive_vs_active' else 'active_match' end,
    'sourceHealth','ready','revenueCenter','Stem Core','lowestGpPercent',27,
    'quickbooks',jsonb_build_object('listId',n,'fullName','Full name '||n),
    'orderingMarker',jsonb_build_object('replenishmentPolicy','Core'),
    'priceLevels',jsonb_build_array(jsonb_build_object('name','frontline','bottlePrice',20)),
    'gpExplanation','Detailed explanation')) into rows from generate_series(1,1201) n;
  ok := public.publish_read_model(j.id,claimed.lease_token,'{}',rows);
  if not ok then raise exception 'Complete snapshot failed to publish'; end if;
  page := public.read_product_workspace(j.id,'{}',0,76,'productName','asc','page');
  if jsonb_array_length(page->'data')<>76 then raise exception 'Page size wrong'; end if;
  if page#>'{data,0,priceLevels}' is not null then raise exception 'Compact list leaked detail'; end if;
  detail := public.read_product_workspace(j.id,'{}',0,75,'productName','asc','detail','item-1001');
  if detail#>'{data,priceLevels}' is null then raise exception 'Detail missing prices'; end if;
  counts := public.read_product_workspace(j.id,'{}',0,75,'productName','asc','counts');
  if (counts#>>'{data,visible}')::int <> 1201 then raise exception 'Inactive lifecycle mismatch lost'; end if;
  if (counts#>>'{data,gpYellow}')::int <> 1201 then raise exception 'GP thresholds changed'; end if;
  page := public.read_product_workspace(j.id,'{"search":"Full name 1201"}',0,76,'fob','desc','page');
  if jsonb_array_length(page->'data')<>1 or page#>>'{data,0,id}' <> 'item-1201' then raise exception 'Global search failed'; end if;
  page := public.read_product_workspace(j.id,'{}',1000,1000,'fob','asc','export');
  if jsonb_array_length(page->'data')<>201 or page#>>'{data,0,id}' <> 'item-1001' then raise exception 'Full export pagination failed'; end if;
  if page#>'{data,0,priceLevels}' is null then raise exception 'Export missing details'; end if;
  -- Tie ordering must be stable and non-overlapping.
  if public.read_product_workspace(j.id,'{}',75,75,'productName','asc','page')#>>'{data,0,id}'
    = public.read_product_workspace(j.id,'{}',0,75,'productName','asc','page')#>>'{data,0,id}' then raise exception 'Unstable pagination'; end if;
  -- Invalid source generation may never publish as current.
  j := public.request_read_model('products','obsolete-test','test-v1','{}');
  claimed := public.claim_read_model();
  update public.read_model_versions set version=version+1 where kind='products';
  if public.publish_read_model(j.id,claimed.lease_token,'{}',rows) then raise exception 'Obsolete work published'; end if;
  if not (public.read_product_workspace((select id from public.read_model_jobs where cache_key='performance-test'),'{}') ->> 'isStale')::boolean then raise exception 'Stale snapshot not labelled'; end if;
  -- A stolen/expired lease cannot publish or override a winner.
  j := public.request_read_model('margins','lease-test','test-v1','{}'); claimed := public.claim_read_model();
  if public.publish_read_model(j.id,gen_random_uuid(),'{}') then raise exception 'Wrong worker published'; end if;
  update public.read_model_jobs set lease_until=now()-interval '1 second' where id=j.id;
  if public.publish_read_model(j.id,claimed.lease_token,'{}') then raise exception 'Expired lease published'; end if;
  second := public.claim_read_model();
  if second.lease_token=claimed.lease_token then raise exception 'Reclaim reused lease'; end if;
  if not public.publish_read_model(j.id,second.lease_token,'{"complete":true}') then raise exception 'Reclaimed job did not publish'; end if;
  if has_table_privilege('authenticated','public.product_workspace_records','SELECT') then raise exception 'Browser can read private cache'; end if;
  if has_function_privilege('authenticated','public.publish_read_model(uuid,uuid,jsonb,jsonb)','EXECUTE') then raise exception 'Browser can publish cache'; end if;
  if has_function_privilege('anon','public.read_product_workspace(uuid,jsonb,integer,integer,text,text,text,text)','EXECUTE') then raise exception 'Anonymous cache read allowed'; end if;
end $$;
rollback;
