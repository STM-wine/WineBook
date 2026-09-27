-- Verify server aggregates against the existing PO cost fallback rules using guarded writes.
begin;
do $$
declare buyer uuid := gen_random_uuid(); run uuid := gen_random_uuid(); product uuid := gen_random_uuid();
  recommendation uuid := gen_random_uuid(); supplier uuid := gen_random_uuid(); result jsonb; version bigint; totals jsonb;
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
end $$;
rollback;
