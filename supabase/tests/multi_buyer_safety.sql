-- Run with `supabase test db` after applying all migrations.
-- The test is transactional and leaves no business data behind.

begin;

do $$
declare
    buyer_a constant uuid := '10000000-0000-0000-0000-000000000001';
    buyer_b constant uuid := '10000000-0000-0000-0000-000000000002';
    run_id constant uuid := '20000000-0000-0000-0000-000000000001';
    product_1 constant uuid := '30000000-0000-0000-0000-000000000001';
    product_2 constant uuid := '30000000-0000-0000-0000-000000000002';
    rec_1 constant uuid := '40000000-0000-0000-0000-000000000001';
    rec_2 constant uuid := '40000000-0000-0000-0000-000000000002';
    first_key constant uuid := '50000000-0000-0000-0000-000000000001';
    delta_key constant uuid := '50000000-0000-0000-0000-000000000002';
    add_group_key constant uuid := '50000000-0000-0000-0000-000000000003';
    remove_group_key constant uuid := '50000000-0000-0000-0000-000000000004';
    result jsonb;
    draft_id uuid;
    version bigint;
    quantity integer;
begin
    insert into auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values
        (buyer_a, 'authenticated', 'authenticated', 'buyer-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
        (buyer_b, 'authenticated', 'authenticated', 'buyer-b@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
    on conflict (id) do nothing;

    insert into public.app_profiles (id, email, full_name, role)
    values
        (buyer_a, 'buyer-a@example.test', 'Buyer A', 'buyer'),
        (buyer_b, 'buyer-b@example.test', 'Buyer B', 'buyer')
    on conflict (id) do update set role = excluded.role;

    insert into public.report_runs (id, run_type, status)
    values (run_id, 'manual_upload', 'completed');
    insert into public.products (id, planning_sku, product_code, name)
    values
        (product_1, 'multi-buyer-test-1', 'MB1', 'Multi Buyer Test 1'),
        (product_2, 'multi-buyer-test-2', 'MB2', 'Multi Buyer Test 2');
    insert into public.reorder_recommendations (
        id, report_run_id, product_id, target_days, reorder_status,
        recommendation_status, approved_qty, recommended_qty_rounded,
        fob, order_path
    ) values
        (rec_1, run_id, product_1, 30, 'LOW', 'rejected', 0, 12, 10, 'stateside'),
        (rec_2, run_id, product_2, 30, 'LOW', 'rejected', 0, 6, 20, 'stateside');

    perform set_config('request.jwt.claim.sub', buyer_a::text, true);
    result := public.save_order_approvals(jsonb_build_array(jsonb_build_object(
        'sourceType', 'recommendation', 'id', rec_1,
        'recommendationStatus', 'approved', 'approvedQty', 12,
        'expectedLockVersion', 1
    )));
    if not (result->>'ok')::boolean then raise exception 'first approval save unexpectedly failed: %', result; end if;

    perform set_config('request.jwt.claim.sub', buyer_b::text, true);
    result := public.save_order_approvals(jsonb_build_array(jsonb_build_object(
        'sourceType', 'recommendation', 'id', rec_1,
        'recommendationStatus', 'edited', 'approvedQty', 18,
        'expectedLockVersion', 1
    )));
    if (result->>'ok')::boolean or result->'conflicts'->0->>'updatedByName' <> 'Buyer A' then
        raise exception 'stale write did not return the expected structured conflict: %', result;
    end if;

    -- A stale row makes the whole batch fail; rec_2 must remain untouched.
    result := public.save_order_approvals(jsonb_build_array(
        jsonb_build_object(
            'sourceType', 'recommendation', 'id', rec_1,
            'recommendationStatus', 'edited', 'approvedQty', 18,
            'expectedLockVersion', 2
        ),
        jsonb_build_object(
            'sourceType', 'recommendation', 'id', rec_2,
            'recommendationStatus', 'approved', 'approvedQty', 6,
            'expectedLockVersion', 999
        )
    ));
    if (result->>'ok')::boolean then raise exception 'stale bulk save unexpectedly succeeded'; end if;
    select approved_qty into quantity from public.reorder_recommendations where id = rec_1;
    if quantity <> 12 then raise exception 'failed bulk save partially changed rec_1'; end if;
    select approved_qty into quantity from public.reorder_recommendations where id = rec_2;
    if quantity <> 0 then raise exception 'failed bulk save partially changed rec_2'; end if;

    -- A different buyer editing a different row succeeds independently.
    perform set_config('request.jwt.claim.sub', buyer_b::text, true);
    result := public.save_order_approvals(jsonb_build_array(jsonb_build_object(
        'sourceType', 'recommendation', 'id', rec_2,
        'recommendationStatus', 'approved', 'approvedQty', 6,
        'expectedLockVersion', 1
    )));
    if not (result->>'ok')::boolean then raise exception 'different-row save unexpectedly failed: %', result; end if;
    version := (result->'saved'->0->>'lockVersion')::bigint;
    result := public.save_order_approvals(jsonb_build_array(jsonb_build_object(
        'sourceType', 'recommendation', 'id', rec_2,
        'recommendationStatus', 'rejected', 'approvedQty', 0,
        'expectedLockVersion', version
    )));
    if not (result->>'ok')::boolean then raise exception 'different-row reset unexpectedly failed: %', result; end if;

    select lock_version into version from public.reorder_recommendations where id = rec_1;
    perform set_config('request.jwt.claim.sub', buyer_a::text, true);
    result := public.create_purchase_order_drafts_atomic(
        run_id,
        first_key,
        'request-hash-1',
        jsonb_build_array(jsonb_build_object(
            'sourceType', 'recommendation', 'sourceId', rec_1,
            'recommendationStatus', 'approved', 'approvedQty', 12,
            'lockVersion', version
        )),
        jsonb_build_array(jsonb_build_object(
            'supplier', 'Concurrency Test Supplier',
            'orderPath', 'stateside',
            'orderingSource', 'report',
            'notes', 'Integration test',
            'draftSnapshot', '{}'::jsonb,
            'lines', jsonb_build_array(jsonb_build_object(
                'sourceType', 'recommendation', 'sourceId', rec_1,
                'sourceLockVersion', version, 'supplierCatalogWineId', null,
                'productName', 'Multi Buyer Test 1', 'productCode', 'MB1',
                'planningSku', 'multi-buyer-test-1', 'recommendedQty', 12,
                'approvedQty', 12, 'fob', 10, 'truckingCostPerBottle', 1,
                'isNewItem', false, 'sourceSnapshot', '{}'::jsonb
            ))
        ))
    );
    if not (result->>'ok')::boolean then raise exception 'draft creation failed: %', result; end if;

    -- Reusing the same key returns the original result and creates nothing else.
    if public.create_purchase_order_drafts_atomic(
        run_id, first_key, 'request-hash-1',
        jsonb_build_array(jsonb_build_object(
            'sourceType', 'recommendation', 'sourceId', rec_1,
            'recommendationStatus', 'approved', 'approvedQty', 12, 'lockVersion', version
        )),
        '[]'::jsonb
    ) <> result then
        raise exception 'idempotent retry returned a different result';
    end if;
    if (select count(*) from public.purchase_order_drafts where report_run_id = run_id and status in ('draft', 'ready_for_entry')) <> 1 then
        raise exception 'idempotent request created duplicate active drafts';
    end if;
    if (select count(*) from public.purchase_order_lines line join public.purchase_order_drafts draft on draft.id = line.purchase_order_draft_id where draft.report_run_id = run_id) <> 1 then
        raise exception 'idempotent request created duplicate lines';
    end if;

    select id into draft_id from public.purchase_order_drafts where report_run_id = run_id and status = 'draft';
    perform public.set_purchase_order_draft_status(draft_id, 'entered_in_quickbooks');
    if (select coalesce(sum(commitment.quantity), 0) from public.approval_commitments commitment where commitment.source_id = rec_1) <> 12 then
        raise exception 'QuickBooks entry did not preserve the committed quantity';
    end if;

    -- A later approval is a delta, not a rewrite of the entered draft.
    select lock_version into version from public.reorder_recommendations where id = rec_1;
    result := public.save_order_approvals(jsonb_build_array(jsonb_build_object(
        'sourceType', 'recommendation', 'id', rec_1,
        'recommendationStatus', 'edited', 'approvedQty', 18,
        'expectedLockVersion', version
    )));
    version := (result->'saved'->0->>'lockVersion')::bigint;
    result := public.create_purchase_order_drafts_atomic(
        run_id,
        delta_key,
        'request-hash-2',
        jsonb_build_array(jsonb_build_object(
            'sourceType', 'recommendation', 'sourceId', rec_1,
            'recommendationStatus', 'edited', 'approvedQty', 18, 'lockVersion', version
        )),
        jsonb_build_array(jsonb_build_object(
            'supplier', 'Concurrency Test Supplier', 'orderPath', 'stateside',
            'orderingSource', 'report', 'notes', 'Delta test', 'draftSnapshot', '{}'::jsonb,
            'lines', jsonb_build_array(jsonb_build_object(
                'sourceType', 'recommendation', 'sourceId', rec_1,
                'sourceLockVersion', version, 'supplierCatalogWineId', null,
                'productName', 'Multi Buyer Test 1', 'productCode', 'MB1',
                'planningSku', 'multi-buyer-test-1', 'recommendedQty', 18,
                'approvedQty', 18, 'fob', 10, 'truckingCostPerBottle', 1,
                'isNewItem', false, 'sourceSnapshot', '{}'::jsonb
            ))
        ))
    );
    select approved_qty into quantity
    from public.purchase_order_lines line
    join public.purchase_order_drafts draft on draft.id = line.purchase_order_draft_id
    where draft.report_run_id = run_id and draft.status = 'draft';
    if quantity <> 6 then raise exception 'post-entry approval was not drafted as a delta'; end if;

    -- Removing the final approval for a supplier must cancel the old active
    -- draft even though that supplier is absent from the next request groups.
    select lock_version into version from public.reorder_recommendations where id = rec_2;
    result := public.save_order_approvals(jsonb_build_array(jsonb_build_object(
        'sourceType', 'recommendation', 'id', rec_2,
        'recommendationStatus', 'approved', 'approvedQty', 6,
        'expectedLockVersion', version
    )));
    if not (result->>'ok')::boolean then raise exception 'rec_2 approval failed: %', result; end if;

    result := public.create_purchase_order_drafts_atomic(
        run_id, add_group_key, 'request-hash-3',
        jsonb_build_array(
            jsonb_build_object(
                'sourceType', 'recommendation', 'sourceId', rec_1,
                'recommendationStatus', 'edited', 'approvedQty', 18,
                'lockVersion', (select lock_version from public.reorder_recommendations where id = rec_1)
            ),
            jsonb_build_object(
                'sourceType', 'recommendation', 'sourceId', rec_2,
                'recommendationStatus', 'approved', 'approvedQty', 6,
                'lockVersion', (select lock_version from public.reorder_recommendations where id = rec_2)
            )
        ),
        jsonb_build_array(
            jsonb_build_object(
                'supplier', 'Concurrency Test Supplier', 'orderPath', 'stateside',
                'orderingSource', 'report', 'notes', 'Retained group', 'draftSnapshot', '{}'::jsonb,
                'lines', jsonb_build_array(jsonb_build_object(
                    'sourceType', 'recommendation', 'sourceId', rec_1,
                    'sourceLockVersion', (select lock_version from public.reorder_recommendations where id = rec_1),
                    'supplierCatalogWineId', null, 'productName', 'Multi Buyer Test 1',
                    'productCode', 'MB1', 'planningSku', 'multi-buyer-test-1',
                    'recommendedQty', 18, 'approvedQty', 18, 'fob', 10,
                    'truckingCostPerBottle', 1, 'isNewItem', false, 'sourceSnapshot', '{}'::jsonb
                ))
            ),
            jsonb_build_object(
                'supplier', 'Supplier To Remove', 'orderPath', 'stateside',
                'orderingSource', 'report', 'notes', 'Temporary group', 'draftSnapshot', '{}'::jsonb,
                'lines', jsonb_build_array(jsonb_build_object(
                    'sourceType', 'recommendation', 'sourceId', rec_2,
                    'sourceLockVersion', (select lock_version from public.reorder_recommendations where id = rec_2),
                    'supplierCatalogWineId', null, 'productName', 'Multi Buyer Test 2',
                    'productCode', 'MB2', 'planningSku', 'multi-buyer-test-2',
                    'recommendedQty', 6, 'approvedQty', 6, 'fob', 20,
                    'truckingCostPerBottle', 1, 'isNewItem', false, 'sourceSnapshot', '{}'::jsonb
                ))
            )
        )
    );
    if not (result->>'ok')::boolean then raise exception 'temporary supplier draft failed: %', result; end if;

    select lock_version into version from public.reorder_recommendations where id = rec_2;
    result := public.save_order_approvals(jsonb_build_array(jsonb_build_object(
        'sourceType', 'recommendation', 'id', rec_2,
        'recommendationStatus', 'rejected', 'approvedQty', 0,
        'expectedLockVersion', version
    )));
    result := public.create_purchase_order_drafts_atomic(
        run_id, remove_group_key, 'request-hash-4',
        jsonb_build_array(jsonb_build_object(
            'sourceType', 'recommendation', 'sourceId', rec_1,
            'recommendationStatus', 'edited', 'approvedQty', 18,
            'lockVersion', (select lock_version from public.reorder_recommendations where id = rec_1)
        )),
        jsonb_build_array(jsonb_build_object(
            'supplier', 'Concurrency Test Supplier', 'orderPath', 'stateside',
            'orderingSource', 'report', 'notes', 'Retained group', 'draftSnapshot', '{}'::jsonb,
            'lines', jsonb_build_array(jsonb_build_object(
                'sourceType', 'recommendation', 'sourceId', rec_1,
                'sourceLockVersion', (select lock_version from public.reorder_recommendations where id = rec_1),
                'supplierCatalogWineId', null, 'productName', 'Multi Buyer Test 1',
                'productCode', 'MB1', 'planningSku', 'multi-buyer-test-1',
                'recommendedQty', 18, 'approvedQty', 18, 'fob', 10,
                'truckingCostPerBottle', 1, 'isNewItem', false, 'sourceSnapshot', '{}'::jsonb
            ))
        ))
    );
    if exists (
        select 1 from public.purchase_order_drafts
        where report_run_id = run_id and supplier_name = 'Supplier To Remove'
          and status in ('draft', 'ready_for_entry')
    ) then
        raise exception 'removed approval group left a stale active draft';
    end if;

    perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);
    begin
        perform public.save_order_approvals(jsonb_build_array(jsonb_build_object(
            'sourceType', 'recommendation', 'id', rec_1,
            'recommendationStatus', 'approved', 'approvedQty', 12,
            'expectedLockVersion', version
        )));
        raise exception 'unauthorized approval function call unexpectedly succeeded';
    exception when insufficient_privilege then
        null;
    end;
end;
$$;

rollback;
