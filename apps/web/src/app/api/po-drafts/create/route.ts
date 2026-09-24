import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { applyDiContainerRecommendations, diCapacityViolations, orderPath } from "@/lib/di-planning";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { applyVinosmithAvailability, asNumber, formatInteger, mergeSupplierCatalogRows } from "@/lib/order-data";
import { fetchAllRecommendationsForRun, fetchQuickBooksOnOrderItems } from "@/lib/supabase/recommendations";
import { fetchAllExact } from "@/lib/supabase/fetch-all-exact";
import { applyQuickBooksOnOrderToRecommendations } from "@/lib/quickbooks-on-order";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchLiveVinosmithAvailability } from "@/lib/supabase/vinosmith-availability";
import { fetchSourceBackedOrderingData } from "@/lib/source-backed-ordering-server";
import { isSourceBackedRun, overlayCurrentSourceRows, type OrderingRun } from "@/lib/source-backed-ordering-runs";
import { buildOrderingDraftSourceSnapshot, buildOrderingLineSourceSnapshot } from "@/lib/po-source-snapshot";
import type { ApprovalConflict, PurchaseOrderDraftWithLines, PurchaseOrderLineNote, Recommendation, SupplierCatalogWine, SupplierLogistics } from "@/lib/types";

const WRITE_ROLES = new Set(["buyer", "admin"]);

type DraftRpcResult = {
  ok: boolean;
  created?: string[];
  updated?: string[];
  skipped?: string[];
  conflicts?: ApprovalConflict[];
};

function normalizeSupplier(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function draftGroupKey(supplier: string, path: "stateside" | "di") {
  return `${normalizeSupplier(supplier)}::${path}`;
}

function orderPathLabel(path: "stateside" | "di") {
  return path === "di" ? "Direct Import" : "Stateside";
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function requireWriteAccess() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in required.", status: 401 as const };

  const { data: profile } = await supabase
    .from("app_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (!profile || !WRITE_ROLES.has(profile.role)) {
    return { error: "Buyer or admin access required.", status: 403 as const };
  }
  return { supabase, user };
}

function approvalSource(row: Recommendation) {
  if (row.supplier_catalog_wine_id) {
    if (!row.supplier_catalog_workbench_item_id) {
      throw new Error(`${row.product_name || row.supplier_catalog_wine_id} has not finished saving. Wait a moment and retry.`);
    }
    return { sourceType: "catalog_workbench" as const, sourceId: row.supplier_catalog_workbench_item_id };
  }
  return { sourceType: "recommendation" as const, sourceId: row.id };
}

async function loadDrafts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reportRunId: string
) {
  const draftsPromise = supabase
    .from("purchase_order_drafts")
    .select(`
      id, report_run_id, ordering_source, source_snapshot, supplier_name, order_path,
      status, po_number, notes, revision_no, content_hash, last_exported_at,
      last_exported_by, created_by, reviewed_by, created_at, updated_at,
      revisions:purchase_order_draft_revisions (
        id, purchase_order_draft_id, revision_no, created_by, created_at
      ),
      lines:purchase_order_lines (
        id, purchase_order_draft_id, recommendation_id, supplier_catalog_wine_id,
        producer_name, product_name, product_code, planning_sku, recommended_qty,
        approved_qty, fob, line_cost, trucking_cost_per_bottle, wine_cost,
        laid_in_cost, landed_cost, is_new_item, new_item_warning, source_snapshot,
        source_type, source_id, source_lock_version
      )
    `)
    .eq("report_run_id", reportRunId)
    .order("created_at", { ascending: false })
    .returns<PurchaseOrderDraftWithLines[]>();
  const notesPromise = fetchAllExact<PurchaseOrderLineNote>("PO line collaboration notes", (from, to) => supabase
    .from("purchase_order_line_notes")
    .select("id,report_run_id,purchase_order_draft_id,line_key,product_code_snapshot,product_name_snapshot,body,created_by,created_at", { count: "exact" })
    .eq("report_run_id", reportRunId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to)
    .returns<PurchaseOrderLineNote[]>() as never);
  const [draftResult, notes] = await Promise.all([draftsPromise, notesPromise]);
  if (draftResult.error) return draftResult;
  const notesByDraft = new Map<string, PurchaseOrderLineNote[]>();
  for (const note of notes) {
    const group = notesByDraft.get(note.purchase_order_draft_id);
    if (group) group.push(note);
    else notesByDraft.set(note.purchase_order_draft_id, [note]);
  }
  return {
    ...draftResult,
    data: (draftResult.data || []).map((draft) => ({
      ...draft,
      line_notes: notesByDraft.get(draft.id) || []
    }))
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    reportRunId?: string;
    idempotencyKey?: string;
  } | null;
  const reportRunId = body?.reportRunId;
  const idempotencyKey = body?.idempotencyKey;
  if (!reportRunId || !idempotencyKey) {
    return NextResponse.json({ error: "Report run and idempotency key are required." }, { status: 400 });
  }

  const access = await requireWriteAccess();
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { supabase } = access;
  const integrationSupabase = createServiceRoleClient();

  const { data: orderingRun, error: orderingRunError } = await integrationSupabase
    .from("report_runs")
    .select("id,run_type,report_date,completed_at,diagnostics,configuration_version_id,configuration_snapshot,source_file_ids")
    .eq("id", reportRunId)
    .maybeSingle<OrderingRun>();
  if (orderingRunError || !orderingRun) {
    return NextResponse.json({ error: orderingRunError?.message || "Ordering run not found." }, { status: 404 });
  }

  const sourceBacked = isSourceBackedRun(orderingRun);
  const orderingSource = sourceBacked ? "database" as const : "report" as const;
  let recommendations: Recommendation[];
  let supplierCatalogWines: SupplierCatalogWine[];
  try {
    const [fetchedRecommendations, quickBooksOnOrderItems, liveAvailability, catalogResult] = await Promise.all([
      fetchAllRecommendationsForRun(supabase, reportRunId),
      fetchQuickBooksOnOrderItems(integrationSupabase),
      fetchLiveVinosmithAvailability(),
      fetchAllExact<SupplierCatalogWine>("supplier catalog wines for PO draft", (from, to) => supabase
        .from("supplier_catalog_wines")
        .select(`*, workbench_items:supplier_catalog_workbench_items (*)`, { count: "exact" })
        .order("id", { ascending: true })
        .range(from, to) as never)
    ]);
    supplierCatalogWines = catalogResult;

    const currentSourceData = sourceBacked
      ? await fetchSourceBackedOrderingData(integrationSupabase, {
          referenceDate: orderingRun.report_date || undefined,
          liveAvailability
        })
      : null;
    const currentRecommendations = sourceBacked
      ? overlayCurrentSourceRows(fetchedRecommendations, currentSourceData?.rows || [])
      : applyVinosmithAvailability(fetchedRecommendations, liveAvailability.byProductCode);
    recommendations = applyQuickBooksOnOrderToRecommendations(
      mergeSupplierCatalogRows(currentRecommendations, supplierCatalogWines, reportRunId),
      quickBooksOnOrderItems
    );
    orderingRun.diagnostics = {
      ...(orderingRun.diagnostics || {}),
      vinosmith_available_as_of: liveAvailability.snapshotAt,
      quickbooks_as_of: currentSourceData?.diagnostics.quickbooks_as_of || orderingRun.diagnostics?.quickbooks_as_of || null
    };
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load recommendations." }, { status: 500 });
  }

  const { data: commitmentRows, error: commitmentError } = await supabase
    .from("approval_commitments")
    .select("source_type,source_id")
    .eq("report_run_id", reportRunId)
    .returns<Array<{ source_type: string; source_id: string }>>();
  if (commitmentError) return NextResponse.json({ error: commitmentError.message }, { status: 500 });
  const committedSources = new Set((commitmentRows || []).map((row) => `${row.source_type}:${row.source_id}`));
  const poRows = applyDiContainerRecommendations(recommendations).filter((row) => {
    let source;
    try {
      source = approvalSource(row);
    } catch {
      return false;
    }
    const currentlyApproved = ["approved", "edited"].includes(row.recommendation_status || "") && Math.round(asNumber(row.approved_qty)) > 0;
    return currentlyApproved || committedSources.has(`${source.sourceType}:${source.sourceId}`);
  });
  const capacityViolations = diCapacityViolations(poRows.filter(
    (row) => ["approved", "edited"].includes(row.recommendation_status || "") && asNumber(row.approved_qty) > 0
  ));
  if (capacityViolations.length > 0) {
    return NextResponse.json({
      error: capacityViolations.map((violation) =>
        `Unable to submit ${violation.containerGroup} / ${violation.originPort}: ${formatInteger(violation.totalBottles)} bottles exceeds ${formatInteger(violation.capacityBottles)} bottle container capacity by ${formatInteger(violation.overByBottles)}.`
      ).join(" ")
    }, { status: 400 });
  }

  const { data: supplierRows, error: supplierError } = await supabase
    .from("suppliers")
    .select("name,trucking_cost_per_bottle,pick_up_location,eta_days,freight_forwarder,notes")
    .returns<SupplierLogistics[]>();
  if (supplierError) return NextResponse.json({ error: supplierError.message }, { status: 500 });
  const supplierMetadata = new Map((supplierRows || []).map((row) => [normalizeSupplier(row.name), row]));
  const catalogProducersById = new Map(supplierCatalogWines.map((wine) => [wine.id, wine.producer?.trim() || null]));

  let approvalManifest: Array<Record<string, unknown>>;
  try {
    approvalManifest = poRows.map((row) => {
      const source = approvalSource(row);
      return {
        ...source,
        recommendationStatus: row.recommendation_status,
        approvedQty: Math.max(0, Math.round(asNumber(row.approved_qty))),
        lockVersion: Math.max(0, Math.round(asNumber(row.lock_version)))
      };
    }).sort((a, b) => `${a.sourceType}:${a.sourceId}`.localeCompare(`${b.sourceType}:${b.sourceId}`));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "An approval is still saving." }, { status: 409 });
  }

  const grouped = new Map<string, { supplier: string; path: "stateside" | "di"; rows: Recommendation[] }>();
  for (const row of poRows) {
    const supplier = row.supplier_name?.trim() || "Unassigned";
    const path = orderPath(row);
    const key = draftGroupKey(supplier, path);
    const group = grouped.get(key) || { supplier, path, rows: [] };
    group.rows.push(row);
    grouped.set(key, group);
  }

  const groups = Array.from(grouped.values())
    .sort((a, b) => draftGroupKey(a.supplier, a.path).localeCompare(draftGroupKey(b.supplier, b.path)))
    .map(({ supplier, path, rows }) => {
      const metadata = supplierMetadata.get(normalizeSupplier(supplier));
      const lines = rows
        .map((row) => {
          const source = approvalSource(row);
          const approvedQty = Math.max(0, Math.round(asNumber(row.approved_qty)));
          const recommendedQty = Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)));
          const fob = asNumber(row.fob);
          const trucking = asNumber(row.trucking_cost_per_bottle) || asNumber(metadata?.trucking_cost_per_bottle);
          return {
            ...source,
            sourceLockVersion: Math.max(0, Math.round(asNumber(row.lock_version))),
            supplierCatalogWineId: row.supplier_catalog_wine_id || null,
            producerName: row.supplier_catalog_wine_id ? catalogProducersById.get(row.supplier_catalog_wine_id) || null : null,
            productName: row.product_name,
            productCode: row.product_code,
            planningSku: row.planning_sku,
            recommendedQty,
            approvedQty,
            fob,
            truckingCostPerBottle: trucking,
            isNewItem: Boolean(row.is_new_item),
            newItemWarning: row.new_item_warning || null,
            sourceSnapshot: buildOrderingLineSourceSnapshot({
              row, reportRunId, approvedQty, recommendedQty, trucking, orderingSource,
              vinosmithAvailableAsOf: String(orderingRun.diagnostics?.vinosmith_available_as_of || new Date().toISOString()),
              runDiagnostics: orderingRun.diagnostics || null
            })
          };
        })
        .sort((a, b) => `${a.sourceType}:${a.sourceId}`.localeCompare(`${b.sourceType}:${b.sourceId}`));
      const snapshotLines = lines.map((line) => ({
        recommended_qty: line.recommendedQty,
        approved_qty: line.approvedQty,
        wine_cost: line.fob * line.approvedQty,
        laid_in_cost: line.truckingCostPerBottle * line.approvedQty,
        landed_cost: (line.fob + line.truckingCostPerBottle) * line.approvedQty
      }));
      const draftSnapshot = buildOrderingDraftSourceSnapshot({
        supplier, reportRunId, path, metadata, lines: snapshotLines, orderingSource,
        vinosmithAvailableAsOf: String(orderingRun.diagnostics?.vinosmith_available_as_of || new Date().toISOString()),
        runDiagnostics: orderingRun.diagnostics || null
      });
      return {
        supplier,
        orderPath: path,
        orderingSource,
        notes: [
          "Created from global PO Drafts action.",
          `Order path: ${orderPathLabel(path)}.`,
          metadata?.pick_up_location ? `Pickup: ${metadata.pick_up_location}.` : "",
          metadata?.eta_days ? `ETA: ${metadata.eta_days} days.` : ""
        ].filter(Boolean).join(" "),
        draftSnapshot,
        lines
      };
    });

  const requestPayload = { reportRunId, approvalManifest, groups };
  const { data: rpcData, error: rpcError } = await supabase.rpc("create_purchase_order_drafts_atomic", {
    p_report_run_id: reportRunId,
    p_idempotency_key: idempotencyKey,
    p_request_hash: stableHash(requestPayload),
    p_approval_manifest: approvalManifest,
    p_groups: groups
  });
  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 });
  const result = rpcData as DraftRpcResult;
  if (!result.ok) {
    return NextResponse.json({ error: "Approvals changed while drafts were being prepared.", conflicts: result.conflicts || [] }, { status: 409 });
  }

  const { data: drafts, error: draftsError } = await loadDrafts(supabase, reportRunId);
  if (draftsError) return NextResponse.json({ error: draftsError.message }, { status: 500 });

  revalidateTag(CACHE_TAGS.dashboard);
  return NextResponse.json({
    created: result.created || [],
    updated: result.updated || [],
    skipped: result.skipped || [],
    errors: [],
    drafts: drafts || []
  });
}
