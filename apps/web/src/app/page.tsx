import { redirect } from "next/navigation";
import { OrderDashboard } from "@/components/order-dashboard";
import { loadImporterDefaults, mergeSupplierDefaults } from "@/lib/supplier-defaults";
import { fetchAllRecommendationsForRun } from "@/lib/supabase/recommendations";
import type {
  AppProfile,
  PurchaseOrderDraftWithLines,
  Recommendation,
  ReportRun,
  SupplierLogistics
} from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("app_profiles")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .maybeSingle<AppProfile>();

  if (!profile) {
    return (
      <main className="empty-state">
        <section>
          <p className="eyebrow">Stem Intelligence</p>
          <h1>Account pending</h1>
          <p className="muted">
            You are signed in as {user.email}, but this account is not enabled in Stem Intelligence yet.
            Add a matching row to Supabase app_profiles to grant access.
          </p>
        </section>
      </main>
    );
  }

  const { data: reportRuns } = await supabase
    .from("report_runs")
    .select("id,report_date,completed_at,diagnostics")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(10)
    .returns<ReportRun[]>();

  const latestRun = reportRuns?.[0] || null;

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

  const recommendations = (await fetchAllRecommendationsForRun(supabase, latestRun.id)).sort(
    (a, b) => Number(b.last_30_day_sales || 0) - Number(a.last_30_day_sales || 0)
  );

  const { data: poDraftRows } = await supabase
    .from("purchase_order_drafts")
    .select(`
      id,
      report_run_id,
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
        landed_cost
      )
    `)
    .eq("report_run_id", latestRun.id)
    .order("created_at", { ascending: false })
    .returns<PurchaseOrderDraftWithLines[]>();

  const { data: suppliers } = await supabase
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
  const supplierDefaults = await loadImporterDefaults();
  const mergedSuppliers = mergeSupplierDefaults(suppliers || [], supplierDefaults);

  return (
    <OrderDashboard
      profile={profile}
      reportRun={latestRun}
      recommendations={recommendations || []}
      poDrafts={poDraftRows || []}
      suppliers={mergedSuppliers}
    />
  );
}
