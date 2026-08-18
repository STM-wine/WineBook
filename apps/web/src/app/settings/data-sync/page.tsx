import { AccountPending, getAppContext } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { fetchVinosmithProductHealthData } from "@/lib/supabase/vinosmith-explorer";
import type { VinosmithProductHealth, VinosmithProductHealthIssue } from "@/lib/types";
import { VinosmithResyncButton } from "@/components/vinosmith-resync-button";
import { VinosmithPlumbingWorkflowQueue, type VinosmithPlumbingWorkflowRow } from "@/components/vinosmith-plumbing-workflow-queue";
import { DataHealthSourceLookup } from "@/components/data-health-source-lookup";
import { queueQuickBooksItemMirrorRefresh } from "@/app/settings/actions";
import { dateTimeLabel } from "@/lib/date-labels";

type SyncRunRow = {
  id: string;
  sync_type: string | null;
  status: string | null;
  requested_start_date: string | null;
  requested_end_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
};

type CheckpointRow = {
  resource_name: string;
  checkpoint_key: string;
  status: string | null;
  last_synced_at: string | null;
  requested_start_date: string | null;
  requested_end_date: string | null;
};

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

type QuickBooksOrderingItemRow = {
  list_id: string;
  name: string | null;
  full_name: string | null;
  is_active: boolean | null;
  item_type: string | null;
  quantity_on_hand: number | string | null;
  quantity_on_order: number | string | null;
  purchase_cost: number | string | null;
  average_cost: number | string | null;
  custom_fields: Record<string, unknown> | null;
  last_seen_at: string | null;
};

type VinosmithOrderingWineRow = {
  wine_id: string;
  code: string | null;
  name: string | null;
  active: boolean | null;
  orderable: boolean | null;
  inventory_item: boolean | null;
  importer_name: string | null;
  last_seen_at: string | null;
};

type SupplierOrderingRow = {
  id: string;
  name: string;
  active: boolean | null;
  eta_days: number | string | null;
  trucking_cost_per_bottle: number | string | null;
};

type OrderingSourceReadiness = {
  requiredSalesStart: string;
  quickBooksLatestItemAt: string | null;
  quickBooksLatestInvoiceDate: string | null;
  quickBooksLatestCreditMemoDate: string | null;
  quickBooksInvoiceCount: number;
  quickBooksCreditMemoCount: number;
  quickBooksActiveProductItems: number;
  quickBooksMissingCost: number;
  quickBooksMissingInventory: number;
  vinosmithLatestInventoryAt: string | null;
  vinosmithInventorySnapshotRows: number;
  vinosmithActiveOrderableWines: number;
  exactMatchedActiveCodes: number;
  qbActiveMissingVs: number;
  vsActiveMissingQb: number;
  duplicateQbCodes: number;
  duplicateVsCodes: number;
  activeSuppliers: number;
  readySuppliers: number;
  supplierRows: OrderingSupplierReadinessRow[];
};

type OrderingSupplierReadinessRow = {
  name: string;
  activeVsWines: number;
  matchedCodes: number;
  missingQbCodes: number;
  logisticsReady: boolean;
};

type VinosmithPlumbingWorkflowState = {
  recentResolved: VinosmithPlumbingWorkflowRow[];
  warning: string | null;
  workflows: VinosmithPlumbingWorkflowRow[];
};

function statusTone(status: string | null | undefined) {
  const value = (status || "").toLowerCase();
  if (["completed", "success", "succeeded"].includes(value)) return "is-positive";
  if (["running", "queued", "pending"].includes(value)) return "is-warning";
  if (["failed", "error"].includes(value)) return "is-danger";
  return "";
}

async function countRows(table: string) {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }) as CountResult;
  if (error) throw new Error(error.message);
  return count || 0;
}

async function loadVinosmithSyncData() {
  const supabase = createServiceRoleClient();
  const [runsResult, checkpointsResult, productHealth, wineCount, priceCount, orderCount, lineCount] = await Promise.all([
    supabase
      .from("source_sync_runs")
      .select("id,sync_type,status,requested_start_date,requested_end_date,started_at,completed_at,error_message")
      .eq("source_system", "vinosmith")
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(8)
      .returns<SyncRunRow[]>(),
    supabase
      .from("source_sync_checkpoints")
      .select("resource_name,checkpoint_key,status,last_synced_at,requested_start_date,requested_end_date")
      .eq("source_system", "vinosmith")
      .order("resource_name", { ascending: true })
      .limit(80)
      .returns<CheckpointRow[]>(),
    fetchVinosmithProductHealthData(supabase),
    countRows("vinosmith_wines"),
    countRows("vinosmith_prices"),
    countRows("vinosmith_order_headers"),
    countRows("vinosmith_order_lines")
  ]);

  if (runsResult.error) throw new Error(runsResult.error.message);
  if (checkpointsResult.error) throw new Error(checkpointsResult.error.message);

  const runs = runsResult.data || [];
  const checkpoints = checkpointsResult.data || [];
  const latestCompleted = runs.find((run) => run.status === "completed") || null;
  const latestRun = runs[0] || null;
  const [quickBooksItemCheckpoint, latestVinosmithCheckpoint] = await Promise.all([
    fetchLatestSourceCheckpoint("quickbooks_desktop", "quickbooks_items"),
    fetchLatestSourceCheckpoint("vinosmith", "wines")
  ]);
  const workflowState = await fetchVinosmithPlumbingWorkflows(supabase, productHealth);
  const orderingReadiness = await fetchOrderingSourceReadiness(supabase);

  return {
    runs,
    checkpoints,
    latestRun,
    latestCompleted,
    latestVinosmithCheckpoint,
    quickBooksItemCheckpoint,
    productHealth,
    orderingReadiness,
    workflowState,
    counts: {
      wines: wineCount,
      prices: priceCount,
      orders: orderCount,
      orderLines: lineCount
    }
  };
}

async function fetchOrderingSourceReadiness(supabase: ReturnType<typeof createServiceRoleClient>): Promise<OrderingSourceReadiness> {
  const requiredSalesStart = "2025-01-01";
  const today = new Date().toISOString().slice(0, 10);
  const [
    quickBooksItems,
    vinosmithWines,
    suppliers,
    quickBooksLatestInvoiceDate,
    quickBooksLatestCreditMemoDate,
    quickBooksInvoiceCount,
    quickBooksCreditMemoCount,
    quickBooksLatestItemAt,
    vinosmithLatestInventoryAt,
    vinosmithInventorySnapshotRows
  ] = await Promise.all([
    fetchAll<QuickBooksOrderingItemRow>(supabase, "quickbooks_items", `
      list_id,
      name,
      full_name,
      is_active,
      item_type,
      quantity_on_hand,
      quantity_on_order,
      purchase_cost,
      average_cost,
      custom_fields,
      last_seen_at
    `, "list_id"),
    fetchAll<VinosmithOrderingWineRow>(supabase, "vinosmith_wines", "wine_id,code,name,active,orderable,inventory_item,importer_name,last_seen_at", "wine_id"),
    fetchAll<SupplierOrderingRow>(supabase, "suppliers", "id,name,active,eta_days,trucking_cost_per_bottle", "name"),
    latestDateForTable(supabase, "quickbooks_invoices", "txn_date", requiredSalesStart, today),
    latestDateForTable(supabase, "quickbooks_credit_memos", "txn_date", requiredSalesStart, today),
    countRowsInDateRange(supabase, "quickbooks_invoices", "txn_date", requiredSalesStart, today),
    countRowsInDateRange(supabase, "quickbooks_credit_memos", "txn_date", requiredSalesStart, today),
    latestDateForTable(supabase, "quickbooks_items", "last_seen_at"),
    latestDateForTable(supabase, "vinosmith_inventory_snapshots", "snapshot_at"),
    countRows("vinosmith_inventory_snapshots")
  ]);

  const activeQbItems = quickBooksItems
    .filter((item) => item.is_active !== false)
    .map((item) => ({ item, code: normalizeCode(itemCodeFromQuickBooks(item)) }))
    .filter((row) => isLikelyProductItemCode(row.code));
  const activeVsWines = vinosmithWines
    .filter((wine) => isVinosmithActive(wine) && wine.code)
    .map((wine) => ({ wine, code: normalizeCode(wine.code) }))
    .filter((row) => isLikelyProductItemCode(row.code));

  const qbByCode = groupByCode(activeQbItems);
  const vsByCode = groupByCode(activeVsWines);
  const qbCodes = new Set(qbByCode.keys());
  const vsCodes = new Set(vsByCode.keys());
  const exactMatchedActiveCodes = Array.from(qbCodes).filter((code) => vsCodes.has(code)).length;
  const activeSupplierRows = suppliers.filter((supplier) => supplier.active !== false);
  const supplierRows = activeSupplierRows
    .map((supplier) => supplierReadinessRow(supplier, activeVsWines, qbCodes))
    .sort((a, b) => b.missingQbCodes - a.missingQbCodes || b.activeVsWines - a.activeVsWines || a.name.localeCompare(b.name));

  return {
    requiredSalesStart,
    quickBooksLatestItemAt,
    quickBooksLatestInvoiceDate,
    quickBooksLatestCreditMemoDate,
    quickBooksInvoiceCount,
    quickBooksCreditMemoCount,
    quickBooksActiveProductItems: activeQbItems.length,
    quickBooksMissingCost: activeQbItems.filter(({ item }) => numberOrNull(item.purchase_cost) === null && numberOrNull(item.average_cost) === null).length,
    quickBooksMissingInventory: activeQbItems.filter(({ item }) => numberOrNull(item.quantity_on_hand) === null || numberOrNull(item.quantity_on_order) === null).length,
    vinosmithLatestInventoryAt,
    vinosmithInventorySnapshotRows,
    vinosmithActiveOrderableWines: activeVsWines.length,
    exactMatchedActiveCodes,
    qbActiveMissingVs: Array.from(qbCodes).filter((code) => !vsCodes.has(code)).length,
    vsActiveMissingQb: Array.from(vsCodes).filter((code) => !qbCodes.has(code)).length,
    duplicateQbCodes: Array.from(qbByCode.values()).filter((rows) => rows.length > 1).length,
    duplicateVsCodes: Array.from(vsByCode.values()).filter((rows) => rows.length > 1).length,
    activeSuppliers: activeSupplierRows.length,
    readySuppliers: supplierRows.filter((row) => row.logisticsReady && row.activeVsWines > 0 && row.missingQbCodes === 0).length,
    supplierRows: supplierRows.slice(0, 12)
  };
}

async function fetchAll<Row>(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: string,
  columns: string,
  orderBy: string
) {
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(from, from + pageSize - 1)
      .returns<Row[]>();

    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function latestDateForTable(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: string,
  field: string,
  from?: string,
  to?: string
) {
  let query = supabase
    .from(table)
    .select(field)
    .not(field, "is", null);
  if (from) query = query.gte(field, from);
  if (to) query = query.lte(field, to);
  const { data, error } = await query
    .order(field, { ascending: false })
    .limit(1)
    .maybeSingle<Record<string, string | null>>();

  if (error) throw new Error(error.message);
  return data?.[field] || null;
}

async function countRowsInDateRange(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: string,
  field: string,
  from: string,
  to: string
) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte(field, from)
    .lte(field, to) as CountResult;

  if (error) throw new Error(error.message);
  return count || 0;
}

async function fetchLatestSourceCheckpoint(sourceSystem: string, resourceName: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("source_sync_checkpoints")
    .select("resource_name,checkpoint_key,status,last_synced_at,requested_start_date,requested_end_date")
    .eq("source_system", sourceSystem)
    .eq("resource_name", resourceName)
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<CheckpointRow>();

  if (error) throw new Error(error.message);
  return data || null;
}

async function fetchVinosmithPlumbingWorkflows(
  supabase: ReturnType<typeof createServiceRoleClient>,
  productHealth: VinosmithProductHealth
) : Promise<VinosmithPlumbingWorkflowState> {
  const issueKeys = Array.from(new Set(allProductHealthIssues(productHealth).map(workflowKeyForIssue)));
  const selectColumns = "issue_key,issue_type,issue_title,item_code,product_name,source_of_truth,status,assigned_to,admin_note,last_reviewed_at,updated_at,source_updated_at,source_updated_by_name";

  const currentQuery = issueKeys.length > 0
    ? supabase
        .from("source_health_issue_workflows")
        .select(selectColumns)
        .in("issue_key", issueKeys)
        .returns<VinosmithPlumbingWorkflowRow[]>()
    : Promise.resolve({ data: [] as VinosmithPlumbingWorkflowRow[], error: null });
  const resolvedQuery = supabase
    .from("source_health_issue_workflows")
    .select(selectColumns)
    .eq("source_system", "vinosmith")
    .eq("status", "resolved")
    .order("updated_at", { ascending: false })
    .limit(30)
    .returns<VinosmithPlumbingWorkflowRow[]>();
  const [currentResult, resolvedResult] = await Promise.all([currentQuery, resolvedQuery]);
  const error = currentResult.error || resolvedResult.error;

  if (error) {
    const errorCode = "code" in error ? String(error.code) : "";
    if (errorCode === "42P01" || errorCode === "42703" || error.message.includes("source_health_issue_workflows")) {
      return {
        recentResolved: [],
        warning: "Workflow tracking is ready in the code, but the source-health workflow migrations still need to be applied before saves will work.",
        workflows: []
      };
    }
    throw new Error(error.message);
  }
  return {
    recentResolved: (resolvedResult.data || []).filter((row) => !issueKeys.includes(row.issue_key)),
    warning: null,
    workflows: currentResult.data || []
  };
}

function allProductHealthIssues(productHealth: VinosmithProductHealth) {
  return [
    ...productHealth.examples.qbActiveVsInactiveOrMissingVs,
    ...productHealth.examples.vsActiveOrderableVsInactiveOrMissingQb,
    ...productHealth.examples.unmatchedItemCodes
  ];
}

export default async function DataSyncSettingsPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;
  const refreshConfigured = Boolean(process.env.GITHUB_WORKFLOW_DISPATCH_TOKEN);

  let data: Awaited<ReturnType<typeof loadVinosmithSyncData>> | null = null;
  let errorMessage = "";
  try {
    data = await loadVinosmithSyncData();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Could not load data health status.";
  }

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>Data Health</h1>
        <p className="muted">Review source health, fix queues, and intentional refreshes for source-system mirrors.</p>
      </header>

      {errorMessage ? (
        <section className="settings-panel">
          <p className="error-banner">{errorMessage}</p>
        </section>
      ) : null}

      {data ? (
        <>
          <div className="settings-metrics data-sync-metrics">
            <div>
              <span>QB Items Updated</span>
              <strong>{dateTimeLabel(data.quickBooksItemCheckpoint?.last_synced_at)}</strong>
              <small>{data.quickBooksItemCheckpoint?.status || "QuickBooks item mirror"}</small>
            </div>
            <div>
              <span>VS Wines Updated</span>
              <strong>{dateTimeLabel(data.latestVinosmithCheckpoint?.last_synced_at)}</strong>
              <small>{data.latestVinosmithCheckpoint?.resource_name || "Vinosmith wine mirror"}</small>
            </div>
            <div>
              <span>Latest Run</span>
              <strong>{data.latestRun?.status || "Unknown"}</strong>
              <small>{dateTimeLabel(data.latestRun?.started_at || data.latestRun?.completed_at)}</small>
            </div>
            <div>
              <span>Wines</span>
              <strong>{data.counts.wines.toLocaleString("en-US")}</strong>
              <small>Vinosmith wine rows</small>
            </div>
            <div>
              <span>Prices</span>
              <strong>{data.counts.prices.toLocaleString("en-US")}</strong>
              <small>Price-level mirror rows</small>
            </div>
            <div>
              <span>Orders</span>
              <strong>{data.counts.orders.toLocaleString("en-US")}</strong>
              <small>{data.counts.orderLines.toLocaleString("en-US")} line rows</small>
            </div>
          </div>

          <section className="settings-panel">
            <div className="settings-panel-header">
              <div>
                <h2>Vinosmith</h2>
                <p className="muted">Refresh queues the daily ingest workflow. Vinosmith Plumbing stays read-only and does not change ordering logic.</p>
              </div>
              <VinosmithResyncButton configured={refreshConfigured} />
            </div>
          </section>

          <section className="settings-panel data-health-refresh-proof-panel">
            <div className="settings-panel-header">
              <div>
                <h2>Refresh Proof</h2>
                <p className="muted">Use these times to confirm Stem has imported the source-system changes before expecting rows to clear.</p>
              </div>
            </div>
            <div className="data-health-proof-grid">
              <article>
                <strong>QuickBooks item fixes</strong>
                <span>Rows like AST000024 and ARI000016 clear only after the QuickBooks item mirror updates.</span>
                <b>Current proof: {dateTimeLabel(data.quickBooksItemCheckpoint?.last_synced_at)}</b>
                <form action={queueQuickBooksItemMirrorRefresh}>
                  <button className="button button-small button-outline" type="submit">Queue QB item refresh</button>
                </form>
              </article>
              <article>
                <strong>Vinosmith wine fixes</strong>
                <span>Rows like MW000542 clear only after the Vinosmith wines mirror updates.</span>
                <b>Current proof: {dateTimeLabel(data.latestVinosmithCheckpoint?.last_synced_at)}</b>
              </article>
            </div>
          </section>

          <OrderingSourceReadinessPanel readiness={data.orderingReadiness} />

          <VinosmithPlumbingPanel productHealth={data.productHealth} workflowState={data.workflowState} />

          <DataHealthSourceLookup />

          <section className="settings-panel">
            <div className="settings-panel-header">
              <h2>Recent Runs</h2>
            </div>
            <div className="settings-table-wrap">
              <table className="settings-table data-sync-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Started</th>
                    <th>Completed</th>
                    <th>Range</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id}>
                      <td><span className={`data-pill ${statusTone(run.status)}`}>{run.status || "Unknown"}</span></td>
                      <td>{run.sync_type || "Sync"}</td>
                      <td>{dateTimeLabel(run.started_at)}</td>
                      <td>{dateTimeLabel(run.completed_at)}</td>
                      <td>{run.requested_start_date || "-"} to {run.requested_end_date || "-"}</td>
                      <td>{run.error_message || "-"}</td>
                    </tr>
                  ))}
                  {data.runs.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No Vinosmith sync runs recorded.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="settings-panel">
            <div className="settings-panel-header">
              <h2>Checkpoints</h2>
            </div>
            <div className="settings-table-wrap">
              <table className="settings-table data-sync-table">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Checkpoint</th>
                    <th>Status</th>
                    <th>Last Synced</th>
                    <th>Requested Range</th>
                  </tr>
                </thead>
                <tbody>
                  {data.checkpoints.map((checkpoint) => (
                    <tr key={`${checkpoint.resource_name}-${checkpoint.checkpoint_key}`}>
                      <td>{checkpoint.resource_name}</td>
                      <td>{checkpoint.checkpoint_key}</td>
                      <td><span className={`data-pill ${statusTone(checkpoint.status)}`}>{checkpoint.status || "Unknown"}</span></td>
                      <td>{dateTimeLabel(checkpoint.last_synced_at)}</td>
                      <td>{checkpoint.requested_start_date || "-"} to {checkpoint.requested_end_date || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}

function OrderingSourceReadinessPanel({ readiness }: { readiness: OrderingSourceReadiness }) {
  const blockers = orderingReadinessBlockers(readiness);
  const canStartBridge = blockers.length === 0;

  return (
    <section className="settings-panel ordering-source-readiness-panel">
      <div className="settings-panel-header">
        <div>
          <h2>Ordering Source Readiness</h2>
          <p className="muted">Proof that Stem can build ordering from database sources before removing Vinosmith report uploads.</p>
        </div>
        <span className={`data-pill ${canStartBridge ? "is-positive" : "is-warning"}`}>
          {canStartBridge ? "Ready for Bridge" : "Needs Proof"}
        </span>
      </div>

      <div className="ordering-source-truth-grid">
        <article>
          <strong>QuickBooks is the ordering math source</strong>
          <span>Sales history, on hand, on order, item active status, and FOB/cost.</span>
        </article>
        <article>
          <strong>Vinosmith is the live availability source</strong>
          <span>Available, hold, future, pending sync transfer, and unconfirmed line item context.</span>
        </article>
        <article>
          <strong>Stem supplier logistics completes the cost basis</strong>
          <span>Laid-in, freight, ETA, TDM, and supplier settings.</span>
        </article>
      </div>

      <div className="settings-metrics data-sync-metrics ordering-readiness-metrics">
        <div>
          <span>QB Sales History</span>
          <strong>{dateTimeLabel(readiness.quickBooksLatestInvoiceDate)}</strong>
          <small>{readiness.quickBooksInvoiceCount.toLocaleString("en-US")} invoices since {readiness.requiredSalesStart}</small>
          <small>{readiness.quickBooksCreditMemoCount.toLocaleString("en-US")} credit memos; latest {dateTimeLabel(readiness.quickBooksLatestCreditMemoDate)}</small>
        </div>
        <div>
          <span>QB Inventory</span>
          <strong>{readiness.quickBooksActiveProductItems.toLocaleString("en-US")}</strong>
          <small>Active product item codes</small>
          <small>{dateTimeLabel(readiness.quickBooksLatestItemAt)} item proof</small>
        </div>
        <div>
          <span>VS Availability</span>
          <strong>{readiness.vinosmithActiveOrderableWines.toLocaleString("en-US")}</strong>
          <small>Active/orderable wine codes</small>
          <small>{dateTimeLabel(readiness.vinosmithLatestInventoryAt)} inventory proof</small>
        </div>
        <div>
          <span>Exact Code Matches</span>
          <strong>{readiness.exactMatchedActiveCodes.toLocaleString("en-US")}</strong>
          <small>{readiness.qbActiveMissingVs.toLocaleString("en-US")} QB-only / {readiness.vsActiveMissingQb.toLocaleString("en-US")} VS-only</small>
          <small>{readiness.duplicateQbCodes + readiness.duplicateVsCodes} duplicate active codes</small>
        </div>
        <div>
          <span>Supplier Readiness</span>
          <strong>{readiness.readySuppliers.toLocaleString("en-US")} / {readiness.activeSuppliers.toLocaleString("en-US")}</strong>
          <small>Active suppliers ready by code/logistics</small>
        </div>
      </div>

      {blockers.length > 0 ? (
        <div className="ordering-readiness-blockers" aria-label="Ordering source blockers">
          {blockers.map((blocker) => (
            <article key={blocker.title}>
              <strong>{blocker.title}</strong>
              <span>{blocker.detail}</span>
            </article>
          ))}
        </div>
      ) : null}

      <div className="settings-table-wrap ordering-supplier-readiness-wrap">
        <table className="settings-table data-sync-table ordering-supplier-readiness-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>VS Active Codes</th>
              <th>Matched Codes</th>
              <th>Missing QB Codes</th>
              <th>Logistics</th>
            </tr>
          </thead>
          <tbody>
            {readiness.supplierRows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.activeVsWines.toLocaleString("en-US")}</td>
                <td>{row.matchedCodes.toLocaleString("en-US")}</td>
                <td>{row.missingQbCodes.toLocaleString("en-US")}</td>
                <td>
                  <span className={`data-pill ${row.logisticsReady ? "is-positive" : "is-warning"}`}>
                    {row.logisticsReady ? "Ready" : "Needs logistics"}
                  </span>
                </td>
              </tr>
            ))}
            {readiness.supplierRows.length === 0 ? (
              <tr>
                <td colSpan={5}>No active supplier readiness rows found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VinosmithPlumbingPanel({
  productHealth,
  workflowState
}: {
  productHealth: VinosmithProductHealth;
  workflowState: VinosmithPlumbingWorkflowState;
}) {
  const nextSteps = nextStepsForProductHealth(productHealth);
  const workflows = workflowState.workflows;

  return (
    <>
      <section className="settings-panel vinosmith-plumbing-panel">
        <div className="settings-panel-header">
          <div>
            <h2>Vinosmith Plumbing</h2>
            <p className="muted">Read-only source health for the Vinosmith mirror before any ordering migration work.</p>
          </div>
          <span className="data-pill">Diagnostic Only</span>
        </div>

        <div className="settings-metrics data-sync-metrics plumbing-metrics">
          <div>
            <span>Last Successful Pull</span>
            <strong>{dateTimeLabel(productHealth.latestSuccessfulPullAt)}</strong>
            <small>{productHealth.latestCompletedRunId ? "Completed run recorded" : "No completed run id"}</small>
          </div>
          <div>
            <span>Failed Syncs</span>
            <strong>{productHealth.failedRecentSyncs.toLocaleString("en-US")}</strong>
            <small>Recent Vinosmith runs</small>
          </div>
          <div>
            <span>QB Active Issues</span>
            <strong>{productHealth.activeQbVsInactiveOrMissingVs.toLocaleString("en-US")}</strong>
            <small>{productHealth.activeQbVsInactiveVs.toLocaleString("en-US")} inactive VS / {productHealth.activeQbVsMissingVs.toLocaleString("en-US")} missing VS</small>
            {productHealth.activeQbVsUnknownVs > 0 ? <small>{productHealth.activeQbVsUnknownVs.toLocaleString("en-US")} matched rows have unknown VS status</small> : null}
          </div>
          <div>
            <span>VS Active Issues</span>
            <strong>{productHealth.activeOrderableVsVsInactiveOrMissingQb.toLocaleString("en-US")}</strong>
            <small>{productHealth.activeOrderableVsVsInactiveQb.toLocaleString("en-US")} inactive QB / {productHealth.activeOrderableVsVsMissingQb.toLocaleString("en-US")} missing QB</small>
          </div>
          <div>
            <span>Changed Records</span>
            <strong>{productHealth.changedRecordsSinceLastSync === null ? "N/A" : productHealth.changedRecordsSinceLastSync.toLocaleString("en-US")}</strong>
            <small>{productHealth.changedRecordsWindowStart ? `Since ${dateTimeLabel(productHealth.changedRecordsWindowStart)}` : productHealth.changedRecordsNote}</small>
          </div>
        </div>
      </section>

      <section className="settings-panel plumbing-next-steps-panel">
        <div className="settings-panel-header">
          <div>
            <h2>What Needs To Happen Next</h2>
            <p className="muted">Admin fix queue based on source-system mismatches that can affect calculations.</p>
          </div>
        </div>
        <div className="plumbing-next-step-list">
          {nextSteps.map((step) => (
            <article key={step.title} className={`plumbing-next-step priority-${step.priority.toLowerCase()}`}>
              <span>{step.priority}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.nextAction}</p>
                <small>{step.countLabel}</small>
                <b>Fix in: {step.sourceOfTruth}</b>
              </div>
            </article>
          ))}
        </div>
      </section>

      <VinosmithPlumbingWorkflowQueue
        productHealth={productHealth}
        recentResolved={workflowState.recentResolved}
        workflowStorageAvailable={!workflowState.warning}
        workflowWarning={workflowState.warning}
        workflows={workflows}
      />

      <section className="settings-panel ordering-bridge-panel">
        <div className="settings-panel-header">
          <div>
            <h2>Ordering Logic Bridge</h2>
            <p className="muted">Next diagnostic step after plumbing is clear. This does not move Order Review yet.</p>
          </div>
        </div>
        <ol className="settings-ordered-list">
          <li>Freeze the current supplier-by-supplier ordering output from the latest Vinosmith report run.</li>
          <li>Generate a proposed output from Product Workspace foundations using the same demand, inventory, on-order, pack, and supplier settings.</li>
          <li>Compare row counts, recommended bottles, approved dollars, cost basis, new-item warnings, and missing-source reasons by supplier.</li>
          <li>Only migrate suppliers whose bridge results are reviewed and explainable.</li>
        </ol>
      </section>
    </>
  );
}

type PlumbingNextStep = {
  priority: "P1" | "P2" | "P3" | "Done";
  title: string;
  nextAction: string;
  countLabel: string;
  sourceOfTruth: string;
};

function nextStepsForProductHealth(productHealth: VinosmithProductHealth): PlumbingNextStep[] {
  const steps: PlumbingNextStep[] = [];

  if (productHealth.failedRecentSyncs > 0) {
    steps.push({
      priority: "P1",
      title: "Fix failed Vinosmith syncs first",
      nextAction: "Open Recent Runs, read the error, repair the workflow/API issue, then run Re-sync Vinosmith so every later diagnosis is based on fresh data.",
      countLabel: `${productHealth.failedRecentSyncs.toLocaleString("en-US")} failed recent syncs`,
      sourceOfTruth: "Vinosmith sync workflow"
    });
  }

  if (productHealth.activeQbVsInactiveOrMissingVs > 0) {
    steps.push({
      priority: "P1",
      title: "Resolve QuickBooks-active products that Vinosmith cannot sell",
      nextAction: "For each row, either reactivate/link it in Vinosmith or deactivate it in QuickBooks if it should not be sold. Active QB items with missing VS data are the biggest ordering risk.",
      countLabel: `${productHealth.activeQbVsInactiveOrMissingVs.toLocaleString("en-US")} QB active issues`,
      sourceOfTruth: "Vinosmith for sellable/orderable status; QuickBooks only if the item should be inactive"
    });
  }

  if (productHealth.activeQbVsUnknownVs > 0) {
    steps.push({
      priority: "P1",
      title: "Fix Vinosmith status visibility before assigning those rows",
      nextAction: "These QuickBooks items have matching Vinosmith wines, but the Vinosmith active/orderable fields are blank in Stem. Confirm the Vinosmith API or mirror mapping before treating them as bookkeeper cleanup.",
      countLabel: `${productHealth.activeQbVsUnknownVs.toLocaleString("en-US")} matched rows with unknown VS status`,
      sourceOfTruth: "Vinosmith API/mirror mapping"
    });
  }

  if (productHealth.activeOrderableVsVsInactiveOrMissingQb > 0) {
    steps.push({
      priority: "P1",
      title: "Resolve Vinosmith-orderable products that QuickBooks cannot invoice cleanly",
      nextAction: "For each row, either create/link/reactivate the QuickBooks item or make the Vinosmith wine inactive/not orderable if it should no longer be sold.",
      countLabel: `${productHealth.activeOrderableVsVsInactiveOrMissingQb.toLocaleString("en-US")} VS active issues`,
      sourceOfTruth: "QuickBooks for item identity/invoice readiness; Vinosmith only if the wine should stop being orderable"
    });
  }

  if (productHealth.unmatchedItemCodes > 0) {
    steps.push({
      priority: "P2",
      title: "Create item-code matches",
      nextAction: "Normalize the item code/name in the source system or add a Stem crosswalk before using Product Workspace as the ordering foundation.",
      countLabel: `${productHealth.unmatchedItemCodes.toLocaleString("en-US")} unmatched examples`,
      sourceOfTruth: "QuickBooks item number and Vinosmith code; Stem crosswalk when source names cannot be changed"
    });
  }

  if ((productHealth.changedRecordsSinceLastSync || 0) > 0) {
    steps.push({
      priority: "P3",
      title: "Review recently changed records",
      nextAction: "Spot-check changed Vinosmith rows against Product Workspace before building the ordering bridge, especially status and item-code changes.",
      countLabel: `${productHealth.changedRecordsSinceLastSync?.toLocaleString("en-US")} changed records`,
      sourceOfTruth: "Vinosmith first, then Product Workspace comparison"
    });
  }

  if (steps.length === 0) {
    steps.push({
      priority: "Done",
      title: "No blocking Vinosmith plumbing issues found",
      nextAction: "The next reviewable slice is the Ordering Logic Bridge: compare current report-driven output against Product Workspace output supplier by supplier.",
      countLabel: "Current diagnostics clear",
      sourceOfTruth: "Product Workspace bridge"
    });
  }

  return steps;
}

function workflowKeyForIssue(row: VinosmithProductHealthIssue) {
  return `${normalizeWorkflowKey(row.issue)}:${row.id}`;
}

function normalizeWorkflowKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function orderingReadinessBlockers(readiness: OrderingSourceReadiness) {
  const blockers: Array<{ title: string; detail: string }> = [];
  if (!readiness.quickBooksLatestInvoiceDate || readiness.quickBooksInvoiceCount === 0) {
    blockers.push({
      title: "QuickBooks sales history is not visible yet",
      detail: `Ordering velocity needs invoices from ${readiness.requiredSalesStart} forward, less credit memos.`
    });
  }
  if (!readiness.quickBooksLatestItemAt) {
    blockers.push({
      title: "QuickBooks item inventory proof is missing",
      detail: "Ordering needs QB on hand and on order before replacing report uploads."
    });
  }
  if (!readiness.vinosmithLatestInventoryAt || readiness.vinosmithInventorySnapshotRows === 0) {
    blockers.push({
      title: "Vinosmith live availability proof is missing",
      detail: "Ordering still needs VS available, hold, future, pending sync, and unconfirmed context."
    });
  }
  if (readiness.qbActiveMissingVs > 0 || readiness.vsActiveMissingQb > 0) {
    blockers.push({
      title: "Some active item codes do not match across systems",
      detail: `${readiness.qbActiveMissingVs.toLocaleString("en-US")} QB-only active codes and ${readiness.vsActiveMissingQb.toLocaleString("en-US")} VS-only active codes need review.`
    });
  }
  if (readiness.duplicateQbCodes > 0 || readiness.duplicateVsCodes > 0) {
    blockers.push({
      title: "Duplicate active item codes need cleanup",
      detail: `${readiness.duplicateQbCodes.toLocaleString("en-US")} QB duplicate codes and ${readiness.duplicateVsCodes.toLocaleString("en-US")} VS duplicate codes were found.`
    });
  }
  if (readiness.quickBooksMissingCost > 0 || readiness.quickBooksMissingInventory > 0) {
    blockers.push({
      title: "Some QuickBooks items are missing ordering fields",
      detail: `${readiness.quickBooksMissingCost.toLocaleString("en-US")} active product items are missing cost and ${readiness.quickBooksMissingInventory.toLocaleString("en-US")} are missing on-hand/on-order values.`
    });
  }
  return blockers;
}

function supplierReadinessRow(
  supplier: SupplierOrderingRow,
  activeVsWines: Array<{ wine: VinosmithOrderingWineRow; code: string }>,
  qbCodes: Set<string>
): OrderingSupplierReadinessRow {
  const supplierKey = normalizeKey(supplier.name);
  const supplierWines = activeVsWines.filter(({ wine }) => normalizeKey(wine.importer_name) === supplierKey);
  const matchedCodes = supplierWines.filter(({ code }) => qbCodes.has(code)).length;
  return {
    name: supplier.name,
    activeVsWines: supplierWines.length,
    matchedCodes,
    missingQbCodes: supplierWines.length - matchedCodes,
    logisticsReady: numberOrNull(supplier.trucking_cost_per_bottle) !== null && numberOrNull(supplier.eta_days) !== null
  };
}

function groupByCode<Row extends { code: string }>(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  rows.forEach((row) => {
    const existing = grouped.get(row.code) || [];
    existing.push(row);
    grouped.set(row.code, existing);
  });
  return grouped;
}

function itemCodeFromQuickBooks(item: QuickBooksOrderingItemRow) {
  return textFromCustomFields(item.custom_fields, [
    "item_number",
    "itemNumber",
    "ItemNumber",
    "sku",
    "SKU",
    "product_code",
    "productCode",
    "ProductCode"
  ]) || item.name || item.full_name || item.list_id;
}

function textFromCustomFields(customFields: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!customFields || typeof customFields !== "object") return "";
  for (const key of keys) {
    const value = customFields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function isVinosmithActive(wine: Pick<VinosmithOrderingWineRow, "active" | "orderable">) {
  return wine.active === true || wine.orderable === true;
}

function isLikelyProductItemCode(value: string) {
  return /^[A-Z]{2,}\d{5,6}$/i.test(value.trim());
}

function normalizeCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function normalizeKey(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
