import { OrderDashboard } from "@/components/order-dashboard";
import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";
import { fetchCompanyDashboardData, unavailableCompanyDashboardData, type CompanyDashboardData } from "@/lib/company-dashboard-data";
import { unavailableVinosmithExplorerData } from "@/lib/supabase/vinosmith-explorer";
import { fetchAllRecommendationsForRun } from "@/lib/supabase/recommendations";
import type {
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
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) {
    return <AccountPending email={context.pendingEmail} />;
  }
  const { permissions } = context;

  const data = await loadHomePageData();
  const latestRun = data.latestRun;

  if (!latestRun) {
    return (
      <main className="empty-state">
        <section>
          <p className="eyebrow">Stem Intelligence</p>
          <h1>No completed reports yet</h1>
          <p className="muted">The app is connected, but Supabase does not have a completed report run to display.</p>
        </section>
      </main>
    );
  }

  const vinosmithExplorer = unavailableVinosmithExplorerData("Open Settings > Data Health for Vinosmith diagnostics.");

  return (
    <OrderDashboard
      reportRun={latestRun}
      recommendations={data.recommendations}
      poDrafts={data.poDraftRows}
      suppliers={data.suppliers}
      supplierCatalogWines={data.supplierCatalogWines}
      vinosmithExplorer={vinosmithExplorer}
      wineRequests={data.wineRequests}
      priceChangeEvents={data.priceChangeEvents}
      quickBooksSupplierMatches={data.quickBooksSupplierMatches}
      companyDashboard={data.companyDashboard}
      quickBooksLastSyncAt={data.quickBooksLastSyncAt}
      vinosmithLastSyncAt={data.vinosmithLastSyncAt}
      canViewSettings={hasPermission(permissions, "view_settings")}
    />
  );
}

type HomePageData = {
  reportRuns: ReportRun[];
  latestRun: ReportRun | null;
  recommendations: Recommendation[];
  poDraftRows: PurchaseOrderDraftWithLines[];
  suppliers: SupplierLogistics[];
  supplierCatalogWines: SupplierCatalogWine[];
  wineRequests: WineRequest[];
  priceChangeEvents: PriceChangeEvent[];
  quickBooksSupplierMatches: SupplierQuickBooksVendorMatch[];
  companyDashboard: CompanyDashboardData;
  quickBooksLastSyncAt: string | null;
  vinosmithLastSyncAt: string | null;
};

async function loadHomePageData(): Promise<HomePageData> {
  const serviceRoleSupabase = createServiceRoleClient();
  const reportRunsPromise = serviceRoleSupabase
    .from("report_runs")
    .select("id,report_date,completed_at,diagnostics")
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

  const vinosmithLastSyncPromise = fetchLatestVinosmithPullAt(serviceRoleSupabase);

  const companyDashboardPromise = (() => {
    try {
      return fetchCompanyDashboardData(serviceRoleSupabase, "mtd");
    } catch (error) {
      return Promise.resolve(
        unavailableCompanyDashboardData(error instanceof Error ? error.message : "Company Dashboard is not configured.", "mtd")
      );
    }
  })();

  const [
    { data: reportRuns },
    { data: supplierCatalogWines },
    { data: wineRequests },
    { data: priceChangeEvents },
    companyDashboard,
    quickBooksLastSyncAt,
    vinosmithLastSyncAt
  ] = await Promise.all([
    reportRunsPromise,
    supplierCatalogPromise,
    wineRequestsPromise,
    priceChangeEventsPromise,
    companyDashboardPromise,
    quickBooksLastSyncPromise,
    vinosmithLastSyncPromise
  ]);
  const latestRun = reportRuns?.[0] || null;

  if (!latestRun) {
    return {
      reportRuns: reportRuns || [],
      latestRun: null,
      recommendations: [],
      poDraftRows: [],
      suppliers: [],
      supplierCatalogWines: supplierCatalogWines || [],
      wineRequests: wineRequests || [],
      priceChangeEvents: priceChangeEvents || [],
      quickBooksSupplierMatches: [],
      companyDashboard,
      quickBooksLastSyncAt,
      vinosmithLastSyncAt
    };
  }

  const recommendationsPromise = fetchAllRecommendationsForRun(serviceRoleSupabase, latestRun.id).then((rows) =>
    rows.sort((a, b) => Number(b.last_30_day_sales || 0) - Number(a.last_30_day_sales || 0))
  );

  const poDraftRowsPromise = serviceRoleSupabase
    .from("purchase_order_drafts")
    .select(`
        id,
        report_run_id,
        ordering_source,
        source_snapshot,
        supplier_name,
        status,
        po_number,
        notes,
        created_at,
        updated_at,
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
          source_snapshot
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

  const [
    recommendations,
    { data: poDraftRows },
    { data: suppliers },
    quickBooksSupplierMatches
  ] = await Promise.all([
    recommendationsPromise,
    poDraftRowsPromise,
    suppliersPromise,
    fetchQuickBooksSupplierMatches(serviceRoleSupabase)
  ]);

  return {
    reportRuns: reportRuns || [],
    latestRun,
    recommendations: recommendations || [],
    poDraftRows: poDraftRows || [],
    suppliers: suppliers || [],
    supplierCatalogWines: supplierCatalogWines || [],
    wineRequests: wineRequests || [],
    priceChangeEvents: priceChangeEvents || [],
    quickBooksSupplierMatches,
    companyDashboard,
    quickBooksLastSyncAt,
    vinosmithLastSyncAt
  };
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
