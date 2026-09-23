import { OrderDashboard } from "@/components/order-dashboard";
import { CompanyHome } from "@/components/company-home";
import { ProductWorkspaceHome } from "@/components/product-workspace-home";
import { DEFAULT_VIEW, isActiveView, type ActiveView } from "@/components/dashboard-types";
import { refreshOrderingDataFromForm } from "@/app/actions";
import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";
import { fetchCompanyDashboardData, unavailableCompanyDashboardData } from "@/lib/company-dashboard-data";
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
import { createServiceRoleClient } from "@/lib/supabase/server";
import { fetchSourceBackedOrderingData } from "@/lib/source-backed-ordering-server";
import {
  fetchActiveOrderingRun,
  orderingSourceMode,
  overlayCurrentSourceRows,
  sourceRunNeedsCurrentOverlay
} from "@/lib/source-backed-ordering-runs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const context = await getAppContext();
  if ("pendingEmail" in context) {
    return <AccountPending email={context.pendingEmail} />;
  }
  const { permissions } = context;
  const params = await searchParams;
  const requestedView = singleParam(params.view);
  const initialView: ActiveView = isActiveView(requestedView) ? requestedView : DEFAULT_VIEW;

  if (initialView === DEFAULT_VIEW) {
    const companyDashboard = await fetchCompanyDashboardData(createServiceRoleClient(), "mtd", {
      includeBreakdowns: false
    }).catch((error) =>
      unavailableCompanyDashboardData(
        error instanceof Error ? error.message : "Company Dashboard is not configured.",
        "mtd"
      )
    );

    return (
      <CompanyHome
        companyDashboard={companyDashboard}
        canViewSettings={hasPermission(permissions, "view_settings")}
      />
    );
  }

  if (initialView === "product-workspace") {
    return <ProductWorkspaceHome canViewSettings={hasPermission(permissions, "view_settings")} />;
  }

  const data = await loadOrderingPageData();
  const latestRun = data.latestRun;

  if (!latestRun) {
    return (
      <main className="empty-state">
        <section>
          <p className="eyebrow">Stem Intelligence</p>
          <h1>No completed ordering data yet</h1>
          <p className="muted">Generate a source-backed ordering run from QuickBooks, Vinosmith Available, and Stem data.</p>
          <form action={refreshOrderingDataFromForm}>
            <button className="button" type="submit">Generate Ordering Data</button>
          </form>
        </section>
      </main>
    );
  }

  const vinosmithExplorer = unavailableVinosmithExplorerData("Open Settings > Data Health for Vinosmith diagnostics.");

  return (
    <OrderDashboard
      reportRun={latestRun}
      recommendations={data.recommendations}
      approvalEvents={data.approvalEvents}
      auditActorNames={data.auditActorNames}
      approvalCommitments={data.approvalCommitments}
      poDrafts={data.poDraftRows}
      suppliers={data.suppliers}
      supplierCatalogWines={data.supplierCatalogWines}
      vinosmithExplorer={vinosmithExplorer}
      wineRequests={data.wineRequests}
      priceChangeEvents={data.priceChangeEvents}
      quickBooksSupplierMatches={data.quickBooksSupplierMatches}
      initialView={initialView}
      quickBooksLastSyncAt={data.quickBooksLastSyncAt}
      vinosmithLastSyncAt={data.vinosmithLastSyncAt}
      orderingDataWarning={data.orderingDataWarning}
      canViewSettings={hasPermission(permissions, "view_settings")}
    />
  );
}

type OrderingPageData = {
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
};

async function loadOrderingPageData(): Promise<OrderingPageData> {
  const serviceRoleSupabase = createServiceRoleClient();
  const appProfilesPromise = serviceRoleSupabase
    .from("app_profiles")
    .select("id,email,full_name,position,role")
    .order("email", { ascending: true })
    .returns<AppProfile[]>();
  const reportRunsPromise = serviceRoleSupabase
    .from("report_runs")
    .select("id,run_type,report_date,completed_at,diagnostics,configuration_version_id,configuration_snapshot,source_file_ids")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(10)
    .returns<ReportRun[]>();

  const supplierCatalogPromise = serviceRoleSupabase
    .from("supplier_catalog_wines")
    .select(`
      *,
      price_levels:supplier_catalog_price_levels (*),
      free_goods:supplier_catalog_free_goods (*),
      workbench_items:supplier_catalog_workbench_items (*)
    `)
    .order("updated_at", { ascending: false })
    .returns<SupplierCatalogWine[]>();

  const wineRequestsPromise = serviceRoleSupabase
    .from("wine_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<WineRequest[]>();

  const priceChangeEventsPromise = serviceRoleSupabase
    .from("price_change_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<PriceChangeEvent[]>();

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
        .select("status,started_at,completed_at,error_message")
        .eq("source_system", "quickbooks_desktop")
        .eq("worker_name", "quickbooks_web_connector")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ status: string; started_at: string; completed_at: string | null; error_message: string | null }>();
      if (error || !data || data.status === "completed") return null;
      if (data.status === "running") {
        return "QuickBooks refresh is still in progress. Items and purchase orders are not considered current until every page finishes.";
      }
      return `The latest QuickBooks refresh ${data.status}. The last complete item and purchase-order data remains in use. ${data.error_message || "Run Web Connector again before relying on On Order."}`;
    } catch {
      return null;
    }
  })();

  const vinosmithLastSyncPromise = fetchLatestVinosmithPullAt(serviceRoleSupabase);
  const configuredOrderingSourceMode = orderingSourceMode(process.env.ORDERING_SOURCE_MODE);
  const activeOrderingRunPromise = fetchActiveOrderingRun(serviceRoleSupabase, configuredOrderingSourceMode);
  const vinosmithAvailabilityPromise = fetchLiveVinosmithAvailability()
    .then((data) => ({ data, error: null as string | null }))
    .catch((error) => ({ data: null, error: error instanceof Error ? error.message : "Vinosmith Get Available failed." }));

  const [
    { data: reportRuns },
    { data: supplierCatalogWines },
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
      orderingDataWarning: null
    };
  }

  const reportRecommendationsPromise = fetchAllRecommendationsForRun(serviceRoleSupabase, latestRun.id);
  const approvalEventsPromise = fetchAllExact<ApprovalEvent>("approval events", (from, to) => serviceRoleSupabase
    .from("approval_events")
    .select("id,report_run_id,source_type,source_id,recommendation_status,approved_qty,source_lock_version,actor_id,created_at", { count: "exact" })
    .eq("report_run_id", latestRun.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to)
    .returns<ApprovalEvent[]>() as never);
  const quickBooksOnOrderItemsPromise = fetchQuickBooksOnOrderItems(serviceRoleSupabase);
  const currentSourceOverlayPromise = sourceRunNeedsCurrentOverlay(latestRun) && vinosmithAvailabilityResult.data
    ? fetchSourceBackedOrderingData(serviceRoleSupabase, {
        referenceDate: latestRun.report_date || undefined,
        liveAvailability: vinosmithAvailabilityResult.data
      })
        .then((data) => ({ rows: data.rows, error: null as string | null }))
        .catch((error) => ({
          rows: null,
          error: error instanceof Error ? error.message : "Current QuickBooks sales could not be loaded."
        }))
    : Promise.resolve({ rows: null, error: null as string | null });

  const poDraftRowsPromise = serviceRoleSupabase
    .from("purchase_order_drafts")
    .select(`
        id,
        report_run_id,
        ordering_source,
        source_snapshot,
        supplier_name,
        order_path,
        status,
        po_number,
        notes,
        revision_no,
        content_hash,
        last_exported_at,
        last_exported_by,
        created_by,
        reviewed_by,
        created_at,
        updated_at,
        revisions:purchase_order_draft_revisions (
          id,
          purchase_order_draft_id,
          revision_no,
          created_by,
          created_at
        ),
        lines:purchase_order_lines (
          id,
          purchase_order_draft_id,
          recommendation_id,
          supplier_catalog_wine_id,
          producer_name,
          product_name,
          product_code,
          planning_sku,
          recommended_qty,
          approved_qty,
          fob,
          line_cost,
          trucking_cost_per_bottle,
          wine_cost,
          laid_in_cost,
          landed_cost,
          is_new_item,
          new_item_warning,
          source_snapshot,
          source_type,
          source_id,
          source_lock_version
        )
      `)
    .eq("report_run_id", latestRun.id)
    .order("created_at", { ascending: false })
    .returns<PurchaseOrderDraftWithLines[]>();

  const suppliersPromise = serviceRoleSupabase
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
      `)
    .order("name", { ascending: true })
    .returns<SupplierLogistics[]>();
  const approvalCommitmentsPromise = serviceRoleSupabase
    .from("approval_commitments")
    .select("id,report_run_id,source_type,source_id,source_lock_version,purchase_order_draft_id,draft_revision_no,quantity,actor_id,created_at")
    .eq("report_run_id", latestRun.id)
    .returns<ApprovalCommitment[]>();

  const [
    reportRecommendations,
    approvalEvents,
    { data: appProfiles },
    { data: poDraftRows },
    { data: suppliers },
    quickBooksSupplierMatches,
    quickBooksOnOrderItems,
    currentSourceOverlayResult,
    { data: approvalCommitments }
  ] = await Promise.all([
    reportRecommendationsPromise,
    approvalEventsPromise,
    appProfilesPromise,
    poDraftRowsPromise,
    suppliersPromise,
    fetchQuickBooksSupplierMatches(serviceRoleSupabase),
    quickBooksOnOrderItemsPromise,
    currentSourceOverlayPromise,
    approvalCommitmentsPromise
  ]);
  const sourceRecommendations = currentSourceOverlayResult.rows
    ? overlayCurrentSourceRows(reportRecommendations || [], currentSourceOverlayResult.rows)
    : vinosmithAvailabilityResult.data
      ? applyVinosmithAvailability(reportRecommendations || [], vinosmithAvailabilityResult.data.byProductCode)
      : reportRecommendations || [];

  const recommendations = applyQuickBooksOnOrderToRecommendations(
    mergeSupplierCatalogRows(
      sourceRecommendations,
      supplierCatalogWines || [],
      latestRun.id
    ),
    quickBooksOnOrderItems
  ).sort((a, b) => Number(b.last_30_day_sales || 0) - Number(a.last_30_day_sales || 0));
  const orderingWarnings = [
    configuredOrderingSourceMode === "legacy"
      ? "Order Summary is intentionally pinned to the legacy RB6/RADs rollback path by ORDERING_SOURCE_MODE."
      : null,
    latestRun.run_type !== "quickbooks_sync"
      ? "Ordering data is using the legacy RB6/RADs fallback because no completed source-backed run is available."
      : null,
    vinosmithAvailabilityResult.error
      ? `Vinosmith Get Available could not be refreshed. Ordering data is showing the saved availability snapshot from the active run. ${vinosmithAvailabilityResult.error}`
      : null,
    currentSourceOverlayResult.error
      ? `This ordering run predates the complete QuickBooks sales pagination fix, and its corrected sales could not be reloaded. Refresh Ordering Data before relying on sales or suggested quantities. ${currentSourceOverlayResult.error}`
      : null,
    quickBooksSyncWarning,
    latestRun.run_type === "quickbooks_sync" && latestRun.diagnostics?.quickbooks_fresh === false
      ? `QuickBooks source data was stale when this ordering run was generated (${Math.round(Number(latestRun.diagnostics.quickbooks_freshness_hours) || 0)} hours old). Refresh the QuickBooks mirror before relying on quantities, costs, or sales.`
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
    poDraftRows: poDraftRows || [],
    suppliers: suppliers || [],
    supplierCatalogWines: supplierCatalogWines || [],
    wineRequests: wineRequests || [],
    priceChangeEvents: priceChangeEvents || [],
    quickBooksSupplierMatches,
    quickBooksLastSyncAt,
    vinosmithLastSyncAt: vinosmithAvailabilityResult.data?.snapshotAt || vinosmithLastSyncAt,
    orderingDataWarning: orderingWarnings.join(" ") || null
  };
}

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

async function fetchLatestVinosmithPullAt(supabase: ReturnType<typeof createServiceRoleClient>) {
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

async function fetchQuickBooksSupplierMatches(supabase: ReturnType<typeof createServiceRoleClient>): Promise<SupplierQuickBooksVendorMatch[]> {
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
