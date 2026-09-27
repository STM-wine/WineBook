"use client";
import { flushAllApprovals } from "@/lib/approval-navigation";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import type { OrderingSnapshotSummary } from "@/lib/ordering-snapshot";
import type { OrderingPageData } from "@/lib/ordering-page-data";
import { formatCurrency, formatInteger } from "@/lib/order-data";
import { AppTopbar } from "./app-topbar";
import { WineLoadingProgress } from "./wine-loading-progress";
import { OrderDashboard } from "./order-dashboard";
import { FreightView } from "./freight-view";
import { unavailableVinosmithExplorerData } from "@/lib/vinosmith-explorer-empty";

export function OrderingSnapshotHome({ view, canViewSettings }: { view: "order-review" | "freight"; canViewSettings: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<OrderingSnapshotSummary | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("Loading supplier summaries");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setStage("Loading supplier summaries");
    waitForOrdering<OrderingSnapshotSummary>("", controller.signal, setStage)
      .then((result) => { if (!controller.signal.aborted) { setData(result); setStage(""); performance.mark("winebook:ordering-usable"); } })
      .catch((error) => { if (!controller.signal.aborted) { setError(error.message); setStage(""); } });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!data?.reportRun.id) return;
    const db = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => { clearTimeout(timer); timer = setTimeout(() => setRetry((n) => n + 1), 500); };
    const channel = db.channel(`ordering-summary:${data.reportRun.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "approval_events", filter: `report_run_id=eq.${data.reportRun.id}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_order_drafts", filter: `report_run_id=eq.${data.reportRun.id}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "ordering_item_markers" }, invalidate)
      .subscribe();
    return () => { clearTimeout(timer); void db.removeChannel(channel); };
  }, [data?.reportRun.id]);
  return <main className="app-shell">
    <AppTopbar activeView={view} canViewSettings={canViewSettings} onSelectView={(next) => {
      void flushAllApprovals().then(() => router.push(next === "company-dashboard" ? "/" : `/?view=${next}`, { scroll: false })).catch((error) => setError(error.message));
    }} />
    {!data ? <h1>{view === "freight" ? "Freight" : "Order Summary"}</h1> : null}
    {stage && data ? <p role="status">Refreshing; totals below are from the previous snapshot shown.</p> : null}
    {stage ? <WineLoadingProgress inline message={stage} detail="Navigation remains available. Source checks run in the shared worker." /> : null}
    {error ? <p role="alert">{error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button></p> : null}
    {data ? <>
      <p>Verified snapshot {new Date(data.generatedAt).toLocaleString()} · sales through {data.salesReferenceDate} <button onClick={() => setRetry((n) => n + 1)}>Refresh summaries</button></p>
      {data.warning ? <p role="status">{data.warning}</p> : null}
      {view === "freight" ? <FreightView rows={[]} suppliers={[]} readModel={data.freight} /> : <section className="panel">
        <h1>Order Summary</h1>
        <p>All suppliers: {formatInteger(data.metrics.recommendedBottles)} recommended bottles · {formatInteger(data.metrics.approvedBottles)} outstanding approved bottles · {formatCurrency(data.metrics.poValue)} approved value.</p>
        <p>Expand a supplier to review and edit its complete row set. Row filters and bulk approval actions apply to that supplier. Create PO Drafts uses all saved approvals in this report run.</p>
        <label>Find supplier <input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {data.groups.map((group) => <SupplierExpansion hidden={!group.supplier.toLowerCase().includes(search.toLowerCase())} snapshotId={data.snapshotId} key={group.supplier} supplier={group.supplier} label={`${group.supplier} · ${group.skuCount} SKUs · ${formatInteger(group.recommendedBottles)} suggested bottles · ${formatCurrency(group.suggestedValue)}`} />)}
      </section>}
    </> : null}
  </main>;
}

function SupplierExpansion({ supplier, label, hidden, snapshotId }: { supplier: string; label: string; hidden: boolean; snapshotId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<(OrderingPageData & { generatedAt?: string }) | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(""); setStage("Loading supplier rows");
    waitForOrdering<OrderingPageData & { generatedAt?: string }>(`supplier=${encodeURIComponent(supplier)}`, controller.signal, setStage)
      .then((result) => { if (!controller.signal.aborted) { setData(result); setStage(""); } })
      .catch((error) => { if (!controller.signal.aborted) { setError(error.message); setStage(""); } });
    return () => controller.abort();
  }, [open, supplier, retry, snapshotId]);
  return <details hidden={hidden} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{label}</summary>
    {stage ? <WineLoadingProgress inline message={stage} /> : null}
    {error ? <p role="alert">{error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button></p> : null}
    {data?.generatedAt ? <p>Supplier rows verified {new Date(data.generatedAt).toLocaleString()}; live approvals are merged below.</p> : null}
    {data?.latestRun ? <OrderDashboard embedded reportRun={data.latestRun} recommendations={data.recommendations}
      approvalEvents={data.approvalEvents} approvalCommitments={data.approvalCommitments} auditActorNames={data.auditActorNames}
      poDrafts={[]} suppliers={data.suppliers} supplierCatalogWines={data.supplierCatalogWines}
      wineRequests={[]} priceChangeEvents={[]} quickBooksSupplierMatches={[]} initialView="order-review"
      quickBooksLastSyncAt={data.quickBooksLastSyncAt} vinosmithLastSyncAt={data.vinosmithLastSyncAt}
      salesReferenceDate={data.salesReferenceDate} orderingDataWarning={data.orderingDataWarning}
      vinosmithExplorer={unavailableVinosmithExplorerData("Open Data Health for diagnostics.")} /> : null}
  </details>;
}

async function waitForOrdering<T>(query: string, signal: AbortSignal, onStage: (stage: string) => void): Promise<T> {
  for (;;) {
    const response = await fetch(`/api/ordering/snapshot?${query}`, { cache: "no-store", signal });
    const result = await response.json();
    signal.throwIfAborted();
    if (response.status !== 202) {
      if (!response.ok) throw new Error(result.error || "Ordering could not load.");
      return result;
    }
    onStage(result.stage);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Stopped waiting", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
