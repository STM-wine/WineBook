"use client";
import { flushAllApprovals } from "@/lib/approval-navigation";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import type { OrderingSnapshotSummary } from "@/lib/ordering-snapshot";
import type { OrderingPageData } from "@/lib/ordering-page-data";
import { formatCurrency, formatInteger } from "@/lib/order-data";
import { defaultOrderingFilters, type OrderingSummaryFilters } from "@/lib/ordering-summary-search";
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
  const [filters, setFilters] = useState<OrderingSummaryFilters>(defaultOrderingFilters);
  const [queryFilters, setQueryFilters] = useState(filters);
  const [creatingDrafts, setCreatingDrafts] = useState(false);
  const overviewRequestPending = useRef(false);
  const automaticRefresh = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => setQueryFilters(filters), 250);
    return () => clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    const controller = new AbortController();
    overviewRequestPending.current = true;
    setError(""); setStage(automaticRefresh.current ? "" : "Loading supplier summaries");
    automaticRefresh.current = false;
    const query = new URLSearchParams({ supplierFilter: queryFilters.supplier, tdm: queryFilters.brandManager,
      search: queryFilters.search, suggestedOnly: String(queryFilters.suggestedOnly) });
    waitForOrdering<OrderingSnapshotSummary>(query.toString(), controller.signal, setStage, (previous) => {
      if (!controller.signal.aborted) setData((current) => !current || current.isStale ? previous : current);
    })
      .then(async (result) => { await flushAllApprovals(); if (!controller.signal.aborted) { setData(result); setStage(""); performance.mark("winebook:ordering-usable"); } })
      .catch((error) => { if (!controller.signal.aborted) { setError(error.message); setStage(""); } })
      .finally(() => { if (!controller.signal.aborted) overviewRequestPending.current = false; });
    return () => controller.abort();
  }, [retry, queryFilters]);
  const hasSummary = Boolean(data);
  const hasSourceWarning = Boolean(data?.warning);
  useEffect(() => {
    if (!hasSummary) return;
    // A completed snapshot is a point-in-time read. Sync completion does not
    // emit an approval event, so keep open tabs from retaining old warnings.
    const refresh = () => {
      if (document.visibilityState !== "visible" || overviewRequestPending.current) return;
      overviewRequestPending.current = true;
      automaticRefresh.current = true;
      setRetry((n) => n + 1);
    };
    const timer = setInterval(refresh, hasSourceWarning ? 30_000 : 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasSummary, hasSourceWarning]);
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
  async function createDrafts() {
    if (!data || data.isStale || creatingDrafts) return;
    setCreatingDrafts(true); setError("");
    try {
      await flushAllApprovals();
      const response = await fetch("/api/po-drafts/create", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportRunId: data.reportRun.id, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create PO drafts. Refresh and review saved approvals.");
      if (result.errors?.length) throw new Error(result.errors.join("; "));
      router.push("/?view=po-drafts");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create PO drafts."); }
    finally { setCreatingDrafts(false); }
  }
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
          </div><button className="button" disabled={creatingDrafts || Boolean(data.isStale)} onClick={() => void createDrafts()}>{creatingDrafts ? "Creating PO drafts..." : "Create PO Drafts"}</button></div>
          <div className="filter-bar">
            <label>Supplier<select value={filters.supplier} onChange={(event) => setFilters({ ...filters, supplier: event.target.value })}>
              <option>All</option>{data.filterOptions?.suppliers.map((supplier) => <option key={supplier}>{supplier}</option>)}
            </select></label>
            <label>TDM<select value={filters.brandManager} onChange={(event) => setFilters({ ...filters, brandManager: event.target.value })}>
              <option>All</option>{data.filterOptions?.tdms.map((tdm) => <option key={tdm}>{tdm}</option>)}
            </select></label>
            <label className="search-field">Search<input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Wine, supplier, item #" /></label>
            <label className="check-control"><input type="checkbox" checked={filters.suggestedOnly} onChange={(event) => setFilters({ ...filters, suggestedOnly: event.target.checked })} />Suggested only</label>
          </div>
          <SummaryTable groups={data.groups} />
          {!data.groups.length ? <p className="empty-inline">No wines match these filters.</p> : null}
        </section>
        <section className="supplier-stack" aria-label="Supplier workbenches">
          {data.groups.map((group) => <SupplierExpansion filters={data.filters || defaultOrderingFilters} unavailable={Boolean(data.isStale)} snapshotId={data.snapshotId} key={group.supplier} group={group} />)}
        </section>
      </>}
    </> : null}
  </main>;
}

function SupplierExpansion({ group, filters, snapshotId, unavailable }: { group: Omit<SupplierGroup, "rows">; filters: OrderingSummaryFilters; snapshotId: string; unavailable: boolean }) {
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
      .then(async (result) => { await flushAllApprovals(); if (!controller.signal.aborted) { setData(result); setStage(""); } })
      .catch((error) => { if (!controller.signal.aborted) { setError(error.message); setStage(""); } });
    return () => controller.abort();
  }, [open, supplier, retry, snapshotId, unavailable]);
  return <details className="supplier-section ordering-supplier-section" open={open && !unavailable} onToggle={(event) => setOpen(event.currentTarget.open)}>
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
    {data?.latestRun ? <OrderDashboard embedded summaryFilters={filters} reportRun={data.latestRun} recommendations={data.recommendations}
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
