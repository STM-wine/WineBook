import { AccountPending, getAppContext } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { fetchVinosmithProductHealthData } from "@/lib/supabase/vinosmith-explorer";
import type { VinosmithProductHealth, VinosmithProductHealthIssue } from "@/lib/types";
import { VinosmithResyncButton } from "@/components/vinosmith-resync-button";
import { VinosmithPlumbingWorkflowQueue, type VinosmithPlumbingWorkflowRow } from "@/components/vinosmith-plumbing-workflow-queue";
import { DataHealthSourceLookup } from "@/components/data-health-source-lookup";

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

type VinosmithPlumbingWorkflowState = {
  recentResolved: VinosmithPlumbingWorkflowRow[];
  warning: string | null;
  workflows: VinosmithPlumbingWorkflowRow[];
};

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

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

  return {
    runs,
    checkpoints,
    latestRun,
    latestCompleted,
    latestVinosmithCheckpoint,
    quickBooksItemCheckpoint,
    productHealth,
    workflowState,
    counts: {
      wines: wineCount,
      prices: priceCount,
      orders: orderCount,
      orderLines: lineCount
    }
  };
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
  const selectColumns = "issue_key,issue_type,issue_title,item_code,product_name,source_of_truth,status,assigned_to,admin_note,last_reviewed_at,updated_at";

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
    if (errorCode === "42P01" || error.message.includes("source_health_issue_workflows")) {
      return {
        recentResolved: [],
        warning: "Workflow tracking is ready in the code, but the source_health_issue_workflows migration still needs to be applied before saves will work.",
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
    ...productHealth.examples.metadataGaps,
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
              </article>
              <article>
                <strong>Vinosmith wine fixes</strong>
                <span>Rows like MW000542 clear only after the Vinosmith wines mirror updates.</span>
                <b>Current proof: {dateTimeLabel(data.latestVinosmithCheckpoint?.last_synced_at)}</b>
              </article>
            </div>
          </section>

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
          </div>
          <div>
            <span>VS Active Issues</span>
            <strong>{productHealth.activeOrderableVsVsInactiveOrMissingQb.toLocaleString("en-US")}</strong>
            <small>{productHealth.activeOrderableVsVsInactiveQb.toLocaleString("en-US")} inactive QB / {productHealth.activeOrderableVsVsMissingQb.toLocaleString("en-US")} missing QB</small>
          </div>
          <div>
            <span>Metadata Gaps</span>
            <strong>{productHealth.missingSupplierImporterOrBrand.toLocaleString("en-US")}</strong>
            <small>Missing supplier/importer or brand</small>
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
            <p className="muted">Admin fix queue based on the current source-health findings.</p>
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

  if (productHealth.missingSupplierImporterOrBrand > 0) {
    steps.push({
      priority: "P2",
      title: "Fill supplier and brand metadata",
      nextAction: "Add missing importer/supplier and producer/brand values in Vinosmith, then re-sync. These fields drive supplier grouping, laid-in matching, and review confidence.",
      countLabel: `${productHealth.missingSupplierImporterOrBrand.toLocaleString("en-US")} metadata gaps`,
      sourceOfTruth: "Vinosmith wine record"
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
