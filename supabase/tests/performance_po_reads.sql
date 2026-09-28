-- Verify server aggregates against the existing PO cost fallback rules using guarded writes.
begin;
do $$
declare buyer uuid := gen_random_uuid(); run uuid := gen_random_uuid(); product uuid := gen_random_uuid();
  recommendation uuid := gen_random_uuid(); supplier uuid := gen_random_uuid(); result jsonb; version bigint; totals jsonb;
  added_product uuid := gen_random_uuid(); added_recommendation uuid := gen_random_uuid();
  draft_id uuid; request_key uuid := gen_random_uuid(); manifest jsonb; groups jsonb;
begin
  insert into auth.users(id,email) values(buyer,'performance-buyer@example.test');
  insert into public.app_profiles(id,email,role) values(buyer,'performance-buyer@example.test','buyer');
  insert into public.suppliers(id,name,trucking_cost_per_bottle) values(supplier,'Performance cost fixture',1.5);
  insert into public.report_runs(id,run_type,status) values(run,'manual_upload','completed');
  insert into public.products(id,planning_sku,product_code,name) values(product,'performance-cost','PERF','Cost fixture');
  insert into public.reorder_recommendations(id,report_run_id,product_id,target_days,reorder_status,recommendation_status,approved_qty,recommended_qty_rounded,fob,order_path)
    values(recommendation,run,product,30,'LOW','rejected',0,12,10,'stateside');
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  result := public.save_order_approvals(jsonb_build_array(jsonb_build_object('sourceType','recommendation','id',recommendation,
    'recommendationStatus','approved','approvedQty',12,'expectedLockVersion',1)));
  if not (result->>'ok')::boolean then raise exception 'Approval failed: %',result; end if;
  select lock_version into version from public.reorder_recommendations where id=recommendation;
  result := public.create_purchase_order_drafts_atomic(run,gen_random_uuid(),'performance-cost-request',
    jsonb_build_array(jsonb_build_object('sourceType','recommendation','sourceId',recommendation,'recommendationStatus','approved','approvedQty',12,'lockVersion',version)),
    jsonb_build_array(jsonb_build_object('supplier','Performance cost fixture','orderPath','stateside','orderingSource','report','notes','Internal fixture note',
      'draftSnapshot','{}'::jsonb,'lines',jsonb_build_array(jsonb_build_object('sourceType','recommendation','sourceId',recommendation,
        'sourceLockVersion',version,'productName','Cost fixture','productCode','PERF','planningSku','performance-cost',
        'recommendedQty',12,'approvedQty',12,'fob',10,'truckingCostPerBottle',0,'isNewItem',false,'sourceSnapshot','{}'::jsonb)))));
  if not (result->>'ok')::boolean then raise exception 'Draft failed: %',result; end if;
  select summary into strict totals from public.purchase_order_draft_summaries where report_run_id=run;
  if (totals->>'lineCount')::int<>1 or (totals->>'approvedQty')::numeric<>12 or (totals->>'wineCost')::numeric<>120
    or (totals->>'laidInCost')::numeric<>18 or (totals->>'estimatedCost')::numeric<>138 then
    raise exception 'PO summary differs from existing cost fallback rules: %',totals;
  end if;
  if not exists(select 1 from public.purchase_order_draft_summaries where report_run_id=run and search_text like '%PERF%') then
    raise exception 'Unloaded draft lines missing from complete search';
  end if;
  select id into strict draft_id from public.purchase_order_drafts where report_run_id=run;
  -- Reproduce adding a wine after a draft already exists, without touching live POs.
  insert into public.products(id,planning_sku,product_code,name) values(added_product,'performance-added','ADDED','Added wine');
  insert into public.reorder_recommendations(id,report_run_id,product_id,target_days,reorder_status,recommendation_status,approved_qty,recommended_qty_rounded,fob,order_path)
    values(added_recommendation,run,added_product,30,'LOW','rejected',0,6,20,'stateside');
  result := public.save_order_approvals(jsonb_build_array(jsonb_build_object('sourceType','recommendation','id',added_recommendation,
    'recommendationStatus','approved','approvedQty',6,'expectedLockVersion',1)));
  if not (result->>'ok')::boolean then raise exception 'Added wine approval failed: %',result; end if;
  select jsonb_agg(jsonb_build_object('sourceType','recommendation','sourceId',r.id,'recommendationStatus',r.recommendation_status,
    'approvedQty',r.approved_qty,'lockVersion',r.lock_version) order by r.id),
    jsonb_build_array(jsonb_build_object('supplier','Performance cost fixture','orderPath','stateside','orderingSource','report',
      'draftSnapshot','{}'::jsonb,'lines',jsonb_agg(jsonb_build_object('sourceType','recommendation','sourceId',r.id,
        'sourceLockVersion',r.lock_version,'productName',p.name,'productCode',p.product_code,'planningSku',p.planning_sku,
        'recommendedQty',r.recommended_qty_rounded,'approvedQty',r.approved_qty,'fob',r.fob,'truckingCostPerBottle',0,
        'isNewItem',false,'sourceSnapshot','{}'::jsonb) order by r.id)))
    into manifest,groups from public.reorder_recommendations r join public.products p on p.id=r.product_id where r.report_run_id=run;
  result := public.create_purchase_order_drafts_atomic(run,request_key,'add-wine-request',manifest,groups);
  if not (result->>'ok')::boolean or result->'updated' <> jsonb_build_array(draft_id) then
    raise exception 'Adding wine failed to update the existing draft: %',result;
  end if;
  if public.create_purchase_order_drafts_atomic(run,request_key,'add-wine-request',manifest,groups) <> result then
    raise exception 'Add-wine retry changed the result';
  end if;
  if (select count(*) from public.purchase_order_drafts where report_run_id=run) <> 1
    or (select count(*) from public.purchase_order_lines where purchase_order_draft_id=draft_id) <> 2
    or (select revision_no from public.purchase_order_drafts where id=draft_id) <> 2 then
    raise exception 'Add-wine update/retry duplicated drafts, lines, or revisions';
  end if;
  select summary into strict totals from public.purchase_order_draft_summaries where report_run_id=run;
  if (totals->>'approvedQty')::numeric <> 18 or (totals->>'wineCost')::numeric <> 240 then
    raise exception 'Updated draft totals do not include both wines: %',totals;
  end if;
end $$;
rollback;
