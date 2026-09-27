import "server-only";
import type { ActiveView } from "@/components/dashboard-types";
import { fetchDraftSummaries } from "./ordering-draft-reads";
import { applyQuickBooksOnOrderToRecommendations } from "@/lib/quickbooks-on-order";
import { unavailableVinosmithExplorerData } from "@/lib/supabase/vinosmith-explorer";
import { fetchLiveVinosmithAvailability } from "@/lib/supabase/vinosmith-availability";
import {
  fetchAllRecommendationsForRun,
  fetchQuickBooksOnOrderItems
} from "@/lib/supabase/recommendations";
import type {
  AppProfile,
  ApprovalCommitment,
  ApprovalEvent,
  PriceChangeEvent,
  PurchaseOrderDraftWithLines,
  PurchaseOrderLineNote,
  Recommendation,
  ReportRun,
  SupplierCatalogWine,
  SupplierQuickBooksVendorMatch,
  WineRequest,
  SupplierLogistics,
  QuickBooksVendor,
  QuickBooksVendorMapping
} from "@/lib/types";
import { fetchAllExact } from "@/lib/supabase/fetch-all-exact";
import { applyVinosmithAvailability, mergeSupplierCatalogRows } from "@/lib/order-data";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCurrentOrderingOverlay } from "@/lib/source-backed-ordering-server";
import {
  isQuickBooksSyncActivelyRunning,
  isQuickBooksSyncNonMaterialFailure,
  quickBooksSyncProgressMessage,
  quickBooksSyncCompletedRequestCount
} from "@/lib/quickbooks-sync-state";
import {
  fetchActiveOrderingRun,
  isSourceBackedRun,
  orderingSourceMode
} from "@/lib/source-backed-ordering-runs";

export type OrderingPageData = {
  reportRuns: ReportRun[];
  latestRun: ReportRun | null;
  recommendations: Recommendation[];
  approvalEvents: ApprovalEvent[];
  auditActorNames: Record<string, string>;
  approvalCommitments: ApprovalCommitment[];
  poDraftRows: PurchaseOrderDraftWithLines[];
  suppliers: SupplierLogistics[];
  supplierCatalogWines: SupplierCatalogWine[];
  wineRequests: WineRequest[];
  priceChangeEvents: PriceChangeEvent[];
  quickBooksSupplierMatches: SupplierQuickBooksVendorMatch[];
  quickBooksLastSyncAt: string | null;
  vinosmithLastSyncAt: string | null;
  orderingDataWarning: string | null;
  salesReferenceDate: string | null;
};

export async function loadOrderingPageData(view: ActiveView, serviceRoleSupabase: SupabaseClient, catalogSupplier: string | null = null): Promise<OrderingPageData> {
  const needsRows = view === "order-review" || view === "freight" || view === "supplier-board";
  const needsHub = view === "supplier-hub";
  const needsDrafts = view === "po-drafts";
  const needsAudit = view === "order-review";
  const appProfilesPromise = !(needsAudit || needsDrafts) ? Promise.resolve({ data: [] as AppProfile[] }) : fetchAllExact<AppProfile> ("appProfilesPromise", (from, to) => serviceRoleSupabase
    .from("app_profiles")
    .select("id,email,full_name,position,role", { count: "exact" })
    .order("email", { ascending: true })
    .order("id", { ascending: true }).range(from, to) as never).then((data) => ({ data }));
  const reportRunsPromise = serviceRoleSupabase
    .from("report_runs")
    .select("id,run_type,report_date,completed_at,diagnostics,configuration_version_id,configuration_snapshot,source_file_ids")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(10)
    .returns<ReportRun[]>();

  const supplierCatalogPromise = !(needsRows || (needsHub && catalogSupplier)) ? Promise.resolve([] as SupplierCatalogWine[]) : fetchAllExact<SupplierCatalogWine>("supplier catalog wines", (from, to) => {
    const query = serviceRoleSupabase
    .from("supplier_catalog_wines")
    .select(`
      *,
      price_levels:supplier_catalog_price_levels (*),
      free_goods:supplier_catalog_free_goods (*),
      workbench_items:supplier_catalog_workbench_items (*)
    `, { count: "exact" })
    .order("id", { ascending: true });
    return (needsHub && catalogSupplier ? query.eq("supplier_name", catalogSupplier) : query).range(from, to) as never;
  });

  const wineRequestsPromise = !(needsHub && catalogSupplier) ? Promise.resolve({ data: [] as WineRequest[] }) : fetchAllExact<WineRequest> ("wineRequestsPromise", (from, to) => serviceRoleSupabase
    .from("wine_requests")
    .select("*", { count: "exact" })
    .eq("supplier_name", catalogSupplier!)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true }).range(from, to) as never).then((data) => ({ data }));

  const priceChangeEventsPromise = !(needsHub && catalogSupplier) ? Promise.resolve({ data: [] as PriceChangeEvent[] }) : fetchAllExact<PriceChangeEvent> ("priceChangeEventsPromise", (from, to) => serviceRoleSupabase
    .from("price_change_events")
    .select("*", { count: "exact" })
    .eq("supplier", catalogSupplier!)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true }).range(from, to) as never).then((data) => ({ data }));

  const quickBooksLastSyncPromise = (async () => {
    try {
      const { data: completedRun, error: runError } = await serviceRoleSupabase
        .from("source_sync_runs")
        .select("completed_at")
        .eq("source_system", "quickbooks_desktop")
        .eq("worker_name", "quickbooks_web_connector")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ completed_at: string | null }>();
      if (!runError && completedRun?.completed_at) return completedRun.completed_at;

      const { data, error } = await serviceRoleSupabase
        .from("source_api_responses")
        .select("fetched_at")
        .eq("source_system", "quickbooks_desktop")
        .in("endpoint", ["InvoiceQueryRq", "CreditMemoQueryRq"])
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ fetched_at: string | null }>();
      if (error) return null;
      return data?.fetched_at || null;
    } catch {
      return null;
    }
  })();
  const quickBooksSyncWarningPromise = (async () => {
    try {
      const { data, error } = await serviceRoleSupabase
        .from("source_sync_runs")
        .select("status,started_at,completed_at,error_message,diagnostics")
        .eq("source_system", "quickbooks_desktop")
        .eq("worker_name", "quickbooks_web_connector")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ status: string; started_at: string; completed_at: string | null; error_message: string | null; diagnostics: Record<string, unknown> | null }>();
      if (error || !data || data.status === "completed") return null;
      if (data.status === "running") {
        if (isQuickBooksSyncActivelyRunning(data)) {
          return quickBooksSyncProgressMessage(data);
        }
        return quickBooksSyncCompletedRequestCount(data) === 0
          ? null
          : "The latest QuickBooks refresh stopped without finishing. Order Summary is showing the last verified snapshot; creating or refreshing PO drafts remains blocked until a successful refresh completes.";
      }
      if (isQuickBooksSyncNonMaterialFailure(data)) return null;
      return `The latest QuickBooks refresh ${data.status}. The last complete item and purchase-order data remains in use. ${data.error_message || "Run Web Connector again before relying on On Order."}`;
    } catch {
      return null;
    }
  })();

  const vinosmithLastSyncPromise = fetchLatestVinosmithPullAt(serviceRoleSupabase);
  const configuredOrderingSourceMode = orderingSourceMode(process.env.ORDERING_SOURCE_MODE);
  const activeOrderingRunPromise = fetchActiveOrderingRun(serviceRoleSupabase, configuredOrderingSourceMode);
  const vinosmithAvailabilityPromise = !needsRows ? Promise.resolve({ data: null, error: null }) : fetchLiveVinosmithAvailability()
    .then((data) => ({ data, error: null as string | null }))
    .catch((error) => ({ data: null, error: error instanceof Error ? error.message : "Vinosmith Get Available failed." }));

  const [
    { data: reportRuns },
    supplierCatalogWines,
    { data: wineRequests },
    { data: priceChangeEvents },
    quickBooksLastSyncAt,
    quickBooksSyncWarning,
    vinosmithLastSyncAt,
    activeOrderingRun,
    vinosmithAvailabilityResult
  ] = await Promise.all([
    reportRunsPromise,
    supplierCatalogPromise,
    wineRequestsPromise,
    priceChangeEventsPromise,
    quickBooksLastSyncPromise,
    quickBooksSyncWarningPromise,
    vinosmithLastSyncPromise,
    activeOrderingRunPromise,
    vinosmithAvailabilityPromise
  ]);
  const latestRun = activeOrderingRun || reportRuns?.[0] || null;

  if (!latestRun) {
    return {
      reportRuns: reportRuns || [],
      latestRun: null,
      recommendations: [],
      approvalEvents: [],
      auditActorNames: {},
      approvalCommitments: [],
      poDraftRows: [],
      suppliers: [],
      supplierCatalogWines: supplierCatalogWines || [],
      wineRequests: wineRequests || [],
      priceChangeEvents: priceChangeEvents || [],
      quickBooksSupplierMatches: [],
      quickBooksLastSyncAt,
      vinosmithLastSyncAt,
      orderingDataWarning: null,
      salesReferenceDate: null
    };
  }

  const reportRecommendationsPromise = !needsRows ? Promise.resolve([] as Recommendation[]) : fetchAllRecommendationsForRun(serviceRoleSupabase, latestRun.id);
  const approvalEventsPromise = !needsAudit ? Promise.resolve([] as ApprovalEvent[]) : fetchAllExact<ApprovalEvent>("approval events", (from, to) => serviceRoleSupabase
    .from("approval_events")
    .select("id,report_run_id,source_type,source_id,recommendation_status,approved_qty,source_lock_version,actor_id,created_at", { count: "exact" })
    .eq("report_run_id", latestRun.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to)
    .returns<ApprovalEvent[]>() as never);
  const sourceBackedRun = !needsRows || isSourceBackedRun(latestRun);
  const quickBooksOnOrderItemsPromise = sourceBackedRun
    ? Promise.resolve([])
    : fetchQuickBooksOnOrderItems(serviceRoleSupabase);
  const currentSourceOverlayPromise = sourceBackedRun && needsRows
    ? reportRecommendationsPromise.then((recommendations) => fetchCurrentOrderingOverlay(
        serviceRoleSupabase,
        recommendations,
        {
          liveAvailability: vinosmithAvailabilityResult.data,
          allowVerifiedFallbackDuringRefresh: true,
          verifiedReferenceDate: latestRun.report_date
        }
      ))
        .then((data) => ({
          rows: data.rows,
          diagnostics: data.diagnostics,
          error: null as string | null
        }))
        .catch((error) => ({
          rows: null,
          diagnostics: null,
          error: error instanceof Error ? error.message : "Current QuickBooks sales could not be loaded."
        }))
    : Promise.resolve({ rows: null, diagnostics: null, error: null as string | null });

  const poDraftRowsPromise = needsDrafts
    ? fetchDraftSummaries(serviceRoleSupabase, latestRun.id).then((data) => ({ data }))
    : Promise.resolve({ data: [] as PurchaseOrderDraftWithLines[] });
  const poLineNotesPromise = Promise.resolve([] as PurchaseOrderLineNote[]);

  const suppliersPromise = fetchAllExact<SupplierLogistics> ("suppliersPromise", (from, to) => serviceRoleSupabase
    .from("suppliers")
    .select(`
        id,
        importer_id,
        name,
        eta_days,
        pick_up_location,
        freight_forwarder,
        order_frequency,
        tdm,
        trucking_cost_per_bottle,
        notes,
        active
      `, { count: "exact" })
    .order("name", { ascending: true })
    .order("id", { ascending: true }).range(from, to) as never).then((data) => ({ data }));
  const approvalCommitmentsPromise = !needsRows ? Promise.resolve({ data: [] as ApprovalCommitment[] }) : fetchAllExact<ApprovalCommitment> ("approvalCommitmentsPromise", (from, to) => serviceRoleSupabase
    .from("approval_commitments")
    .select("id,report_run_id,source_type,source_id,source_lock_version,purchase_order_draft_id,draft_revision_no,quantity,actor_id,created_at", { count: "exact" })
    .eq("report_run_id", latestRun.id)
    .order("id", { ascending: true }).range(from, to) as never).then((data) => ({ data }));

  const [
    reportRecommendations,
    approvalEvents,
    { data: appProfiles },
    { data: poDraftRows },
    { data: suppliers },
    quickBooksSupplierMatches,
    quickBooksOnOrderItems,
    currentSourceOverlayResult,
    { data: approvalCommitments },
    poLineNotes
  ] = await Promise.all([
    reportRecommendationsPromise,
    approvalEventsPromise,
    appProfilesPromise,
    poDraftRowsPromise,
    suppliersPromise,
    needsHub ? fetchQuickBooksSupplierMatches(serviceRoleSupabase) : Promise.resolve([]),
    quickBooksOnOrderItemsPromise,
    currentSourceOverlayPromise,
    approvalCommitmentsPromise,
    poLineNotesPromise
  ]);
  const lineNotesByDraft = new Map<string, PurchaseOrderLineNote[]>();
  for (const note of poLineNotes) {
    const group = lineNotesByDraft.get(note.purchase_order_draft_id);
    if (group) group.push(note);
    else lineNotesByDraft.set(note.purchase_order_draft_id, [note]);
  }
  const draftsWithLineNotes = (poDraftRows || []).map((draft) => ({
    ...draft,
    line_notes: lineNotesByDraft.get(draft.id) || []
  }));
  const sourceRecommendations = currentSourceOverlayResult.rows
    ? currentSourceOverlayResult.rows
    : sourceBackedRun
      ? []
      : vinosmithAvailabilityResult.data
      ? applyVinosmithAvailability(reportRecommendations || [], vinosmithAvailabilityResult.data.byProductCode)
      : reportRecommendations || [];

  const mergedRecommendations = mergeSupplierCatalogRows(
    sourceRecommendations,
    supplierCatalogWines || [],
    latestRun.id
  );
  const recommendations = (sourceBackedRun && !currentSourceOverlayResult.rows
    ? []
    : sourceBackedRun
      ? mergedRecommendations
      : applyQuickBooksOnOrderToRecommendations(mergedRecommendations, quickBooksOnOrderItems)
  ).sort((a, b) => Number(b.last_30_day_sales || 0) - Number(a.last_30_day_sales || 0));
  const orderingWarnings = [
    configuredOrderingSourceMode === "legacy"
      ? "Order Summary is intentionally pinned to the legacy RB6/RADs rollback path by ORDERING_SOURCE_MODE."
      : null,
    latestRun.run_type !== "quickbooks_sync"
      ? "Ordering data is using the legacy RB6/RADs fallback because no completed source-backed run is available."
      : null,
    vinosmithAvailabilityResult.error && (!sourceBackedRun || !currentSourceOverlayResult.diagnostics)
      ? `Vinosmith Get Available could not be refreshed. Ordering data is showing the saved availability snapshot from the active run. ${vinosmithAvailabilityResult.error}`
      : null,
    currentSourceOverlayResult.error
      ? `Current QuickBooks sales could not be verified, so Order Summary rows are hidden instead of showing stale sales or recommendations. Complete a QuickBooks refresh and reload. ${currentSourceOverlayResult.error}`
      : null,
    quickBooksSyncWarning,
    latestRun.run_type === "quickbooks_sync"
      && (currentSourceOverlayResult.diagnostics || latestRun.diagnostics)?.quickbooks_fresh === false
      ? `QuickBooks source data is stale (${Math.round(Number((currentSourceOverlayResult.diagnostics || latestRun.diagnostics)?.quickbooks_freshness_hours) || 0)} hours old). Refresh the QuickBooks mirror before relying on quantities, costs, or sales.`
      : null
  ].filter((warning): warning is string => Boolean(warning));

  return {
    reportRuns: reportRuns || [],
    latestRun,
    recommendations,
    approvalEvents,
    auditActorNames: Object.fromEntries((appProfiles || []).map((profile) => [
      profile.id,
      profile.full_name?.trim() || profile.email
    ])),
    approvalCommitments: approvalCommitments || [],
    poDraftRows: draftsWithLineNotes,
    suppliers: suppliers || [],
    supplierCatalogWines: supplierCatalogWines || [],
    wineRequests: wineRequests || [],
    priceChangeEvents: priceChangeEvents || [],
    quickBooksSupplierMatches,
    quickBooksLastSyncAt,
    vinosmithLastSyncAt: vinosmithAvailabilityResult.data?.snapshotAt || vinosmithLastSyncAt,
    orderingDataWarning: orderingWarnings.join(" ") || null,
    salesReferenceDate: currentSourceOverlayResult.diagnostics?.reference_date
      || (sourceBackedRun ? null : latestRun.report_date)
  };
}

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

async function fetchLatestVinosmithPullAt(supabase: SupabaseClient) {
  try {
    const { data: latestRun, error: runError } = await supabase
      .from("source_sync_runs")
      .select("started_at,completed_at")
      .eq("source_system", "vinosmith")
      .eq("status", "completed")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<{ started_at: string | null; completed_at: string | null }>();
    if (!runError && (latestRun?.completed_at || latestRun?.started_at)) {
      return latestRun.completed_at || latestRun.started_at;
    }

    const { data: latestCheckpoint, error: checkpointError } = await supabase
      .from("source_sync_checkpoints")
      .select("last_synced_at")
      .eq("source_system", "vinosmith")
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<{ last_synced_at: string | null }>();
    if (checkpointError) return null;
    return latestCheckpoint?.last_synced_at || null;
  } catch {
    return null;
  }
}

async function fetchQuickBooksSupplierMatches(supabase: SupabaseClient): Promise<SupplierQuickBooksVendorMatch[]> {
  const { data: mappings } = await supabase
    .from("quickbooks_vendor_mappings")
    .select("quickbooks_vendor_list_id,supplier_id,vendor_classification,notes,updated_by,updated_at")
    .not("supplier_id", "is", null)
    .returns<QuickBooksVendorMapping[]>();

  const vendorIds = Array.from(new Set((mappings || []).map((mapping) => mapping.quickbooks_vendor_list_id).filter(Boolean)));
  if (vendorIds.length === 0) return [];

  const { data: vendors } = await supabase
    .from("quickbooks_vendors")
    .select("list_id,name,full_name,is_active,account_number,terms_ref,raw_data,last_seen_at")
    .in("list_id", vendorIds)
    .returns<QuickBooksVendor[]>();

  const vendorById = new Map((vendors || []).map((vendor) => [vendor.list_id, vendor]));
  return (mappings || [])
    .filter((mapping): mapping is QuickBooksVendorMapping & { supplier_id: string } => Boolean(mapping.supplier_id))
    .map((mapping) => {
      const vendor = vendorById.get(mapping.quickbooks_vendor_list_id);
      return {
        supplier_id: mapping.supplier_id,
        quickbooks_vendor_list_id: mapping.quickbooks_vendor_list_id,
        vendor_name: vendor?.name || vendor?.full_name || mapping.quickbooks_vendor_list_id,
        vendor_classification: mapping.vendor_classification,
        vendor_is_active: vendor?.is_active ?? null,
        notes: mapping.notes
      };
    });
}
