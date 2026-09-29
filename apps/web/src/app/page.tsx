import { canManageOrderingMarkers } from "@/lib/ordering-marker-access";
import { OrderingSnapshotHome } from "@/components/ordering-snapshot-home";
import { fetchLastCompletedQuickBooksUpload } from "@/lib/supabase/quickbooks-upload";
import { OrderDashboard } from "@/components/order-dashboard";
import { Suspense } from "react";
import { AppTopbar } from "@/components/app-topbar";
import { CompanyDashboardView } from "@/components/company-dashboard-view";
import { SectionLoading } from "@/components/section-loading";
import { ProductWorkspaceHome } from "@/components/product-workspace-home";
import { DEFAULT_VIEW, isActiveView, type ActiveView } from "@/components/dashboard-types";
import { refreshOrderingDataFromForm } from "@/app/actions";
import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";
import { fetchCompanyDashboardData, unavailableCompanyDashboardData } from "@/lib/company-dashboard-data";
import { fetchLatestVinosmithPullAt, loadOrderingPageData } from "@/lib/ordering-page-data";
import { unavailableVinosmithExplorerData } from "@/lib/supabase/vinosmith-explorer";
import { createServiceRoleClient } from "@/lib/supabase/server";

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
  const canManageMarkers = canManageOrderingMarkers(context.profile.role, permissions.map((permission) => ({ permission })));
  const params = await searchParams;
  const requestedView = singleParam(params.view);
  const initialView: ActiveView = isActiveView(requestedView) ? requestedView : DEFAULT_VIEW;

  if (initialView === DEFAULT_VIEW) {
    return (
      <main className="app-shell">
        <AppTopbar activeView="company-dashboard" canViewSettings={hasPermission(permissions, "view_settings")} />
        <Suspense fallback={<SectionLoading title="Company Dashboard" message="Loading sales KPIs and date controls" />}>
          <HomeSales />
        </Suspense>
      </main>
    );
  }

  if (initialView === "product-workspace") {
    return <ProductWorkspaceHome canManageMarkers={canManageMarkers} canViewSettings={hasPermission(permissions, "view_settings")} />;
  }

  if (initialView === "order-review" || initialView === "freight") {
    const db = createServiceRoleClient();
    const [quickBooksLastSyncAt, vinosmithLastSyncAt] = await Promise.all([
      fetchLastCompletedQuickBooksUpload(db).catch(() => null),
      fetchLatestVinosmithPullAt(db)
    ]);
    return <OrderingSnapshotHome canClearApprovals={context.profile.role === "buyer" || context.profile.role === "admin"} canManageMarkers={canManageMarkers} view={initialView} initialQuickBooksLastSyncAt={quickBooksLastSyncAt} initialVinosmithLastSyncAt={vinosmithLastSyncAt} canViewSettings={hasPermission(permissions, "view_settings")} />;
  }

  return <Suspense fallback={<main className="app-shell"><AppTopbar activeView={initialView} canViewSettings={hasPermission(permissions, "view_settings")} /><SectionLoading title={initialView === "po-drafts" ? "PO Drafts" : initialView === "supplier-hub" ? "Supplier Hub" : "Ordering"} message="Loading this workspace" /></main>}>
    <OrderingScreen canManageMarkers={canManageMarkers} initialView={initialView} canViewSettings={hasPermission(permissions, "view_settings")} />
  </Suspense>;
}

async function OrderingScreen({ initialView, canViewSettings, canManageMarkers }: { initialView: ActiveView; canViewSettings: boolean; canManageMarkers: boolean }) {
  const data = await loadOrderingPageData(initialView, createServiceRoleClient());
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
      canManageMarkers={canManageMarkers}
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
      salesReferenceDate={data.salesReferenceDate}
      canViewSettings={canViewSettings}
    />
  );
}


async function HomeSales() {
  const data = await fetchCompanyDashboardData(createServiceRoleClient(), "mtd", {
    includeGrossProfit: false, includeBreakdowns: false, includeComparison: false
  }).catch((error) => unavailableCompanyDashboardData(
    error instanceof Error ? error.message : "Sales could not be loaded.", "mtd"
  ));
  return <CompanyDashboardView initialData={data} />;
}

function singleParam(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] || null : value || null; }
