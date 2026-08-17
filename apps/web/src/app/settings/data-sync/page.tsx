import { AccountPending, getAppContext } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { VinosmithResyncButton } from "@/components/vinosmith-resync-button";

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
  const [runsResult, checkpointsResult, wineCount, priceCount, orderCount, lineCount] = await Promise.all([
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
  const latestCheckpoint = checkpoints
    .filter((checkpoint) => checkpoint.last_synced_at)
    .sort((a, b) => new Date(b.last_synced_at || "").getTime() - new Date(a.last_synced_at || "").getTime())[0] || null;

  return {
    runs,
    checkpoints,
    latestRun,
    latestCompleted,
    latestCheckpoint,
    counts: {
      wines: wineCount,
      prices: priceCount,
      orders: orderCount,
      orderLines: lineCount
    }
  };
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
    errorMessage = error instanceof Error ? error.message : "Could not load sync status.";
  }

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>Data Sync</h1>
        <p className="muted">Review source freshness and queue intentional refreshes for source-system mirrors.</p>
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
              <span>Vinosmith Updated</span>
              <strong>{dateTimeLabel(data.latestCheckpoint?.last_synced_at)}</strong>
              <small>{data.latestCheckpoint?.resource_name || "Latest checkpoint"}</small>
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
                <p className="muted">Refresh queues the daily ingest workflow. Existing data remains visible until the workflow finishes.</p>
              </div>
              <VinosmithResyncButton configured={refreshConfigured} />
            </div>
          </section>

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
