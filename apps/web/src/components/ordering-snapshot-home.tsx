"use client";
import { flushAllApprovals } from "@/lib/approval-navigation";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import type { OrderingSnapshotSummary } from "@/lib/ordering-snapshot";
import type { OrderingPageData } from "@/lib/ordering-page-data";
import { formatCurrency, formatInteger } from "@/lib/order-data";
import { OrderSummaryMetrics, SummaryTable } from "./order-summary-overview";
import type { SupplierGroup } from "@/lib/types";
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
    waitForOrdering<OrderingSnapshotSummary>("", controller.signal, setStage, (previous) => {
      if (!controller.signal.aborted) setData((current) => !current || current.isStale ? previous : current);
    })
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
    {stage && data ? <p role="status">Updating totals. Showing the last verified summary below.{data.isStale ? " Supplier editing will be available when current data is ready." : ""}</p> : null}
    {stage ? <WineLoadingProgress inline message={stage} detail="Navigation remains available. Source checks run in the shared worker." /> : null}
    {error ? <p role="alert">{error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button></p> : null}
    {data ? <>
      <div className="ordering-snapshot-status"><span>Verified {new Date(data.generatedAt).toLocaleString()} · sales through {data.salesReferenceDate}</span><button className="ghost-button" onClick={() => setRetry((n) => n + 1)}>Refresh summaries</button></div>
      {data.warning ? <p role="status">{data.warning}</p> : null}
      {view === "freight" ? <FreightView rows={[]} suppliers={[]} readModel={data.freight} /> : <>
        <OrderSummaryMetrics metrics={data.metrics} />
        <section className="panel">
          <div className="section-heading"><div>
            <h1>Order Summary</h1>
            <p>Review supplier totals below, then expand a supplier to work with its wines and approvals.</p>
          </div></div>
          <div className="filter-bar">
            <label className="search-field">Find supplier
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search suppliers" />
            </label>
          </div>
          <SummaryTable groups={data.groups.filter((group) => group.supplier.toLowerCase().includes(search.toLowerCase()))} />
          {!data.groups.some((group) => group.supplier.toLowerCase().includes(search.toLowerCase())) ? <p className="empty-inline">No suppliers match your search.</p> : null}
        </section>
        <section className="supplier-stack" aria-label="Supplier workbenches">
          {data.groups.map((group) => <SupplierExpansion unavailable={Boolean(data.isStale)} hidden={!group.supplier.toLowerCase().includes(search.toLowerCase())} snapshotId={data.snapshotId} key={group.supplier} group={group} />)}
        </section>
      </>}
    </> : null}
  </main>;
}

function SupplierExpansion({ group, hidden, snapshotId, unavailable }: { group: Omit<SupplierGroup, "rows">; hidden: boolean; snapshotId: string; unavailable: boolean }) {
  const { supplier } = group;
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<(OrderingPageData & { generatedAt?: string }) | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || unavailable) return;
    const controller = new AbortController();
    setError(""); setStage("Loading supplier rows");
    waitForOrdering<OrderingPageData & { generatedAt?: string }>(`supplier=${encodeURIComponent(supplier)}`, controller.signal, setStage)
      .then((result) => { if (!controller.signal.aborted) { setData(result); setStage(""); } })
      .catch((error) => { if (!controller.signal.aborted) { setError(error.message); setStage(""); } });
    return () => controller.abort();
  }, [open, supplier, retry, snapshotId, unavailable]);
  return <details className="supplier-section ordering-supplier-section" hidden={hidden} open={open && !unavailable} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary aria-disabled={unavailable} onClick={(event) => { if (unavailable) event.preventDefault(); }}>
      <div className="ordering-supplier-totals">
        <span className="supplier-chip">{supplier}</span>
        <strong>{formatInteger(group.recommendedBottles)} bottles</strong>
        <span>{formatCurrency(group.suggestedValue)} suggested</span>
        <span className={group.approvedBottles !== 0 ? "supplier-approved-value" : "supplier-approved-value is-empty"}>{formatCurrency(group.approvedValue)} approved</span>
        {group.freeGoodProgramCount > 0 ? <span className="free-goods-chip">{formatInteger(group.freeGoodProgramCount)} free-goods</span> : null}
      </div>
      <div className="supplier-summary-actions"><span>{formatInteger(group.skuCount)} SKUs</span>{unavailable ? <span>Updating</span> : <span className="ordering-supplier-chevron" aria-hidden="true">⌄</span>}</div>
    </summary>
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

async function waitForOrdering<T>(query: string, signal: AbortSignal, onStage: (stage: string) => void, onPrevious?: (previous: T) => void): Promise<T> {
  for (;;) {
    const response = await fetch(`/api/ordering/snapshot?${query}`, { cache: "no-store", signal });
    const result = await response.json();
    signal.throwIfAborted();
    if (response.status !== 202) {
      if (!response.ok) throw new Error(result.error || "Ordering could not load.");
      return result;
    }
    onStage(result.stage);
    if (result.previousSummary) onPrevious?.(result.previousSummary);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Stopped waiting", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
