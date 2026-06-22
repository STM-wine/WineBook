import Link from "next/link";
import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";
import { fetchSettingsOverview } from "@/lib/settings-data";

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export default async function SettingsOverviewPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;
  const data = await fetchSettingsOverview(context);
  const openRequests = data.changeRequests.filter((request) => request.status === "open");

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>Settings Overview</h1>
        <p className="muted">Published business logic applies to future report runs. Immediate recalculation remains a separate report refresh action.</p>
      </header>

      <div className="settings-metrics">
        <div>
          <span>Published Version</span>
          <strong>v{data.publishedVersion.version_number}</strong>
          <small>{dateLabel(data.publishedVersion.published_at)}</small>
        </div>
        <div>
          <span>Latest Report Config</span>
          <strong>{data.latestReportRun?.configuration_version_id ? "Snapshotted" : "Legacy"}</strong>
          <small>{data.latestReportRun ? dateLabel(data.latestReportRun.completed_at) : "No completed report"}</small>
        </div>
        <div>
          <span>Pending Proposals</span>
          <strong>{data.pendingProposals.length}</strong>
          <small>{hasPermission(context.permissions, "draft_logic_changes") ? "Admin queue" : "Awaiting admin review"}</small>
        </div>
        <div>
          <span>Open Requests</span>
          <strong>{openRequests.length}</strong>
          <small>Buyer-submitted changes</small>
        </div>
      </div>

      <div className="settings-grid-two">
        <section className="settings-panel">
          <div className="settings-panel-header">
            <h2>Current Logic</h2>
            <Link className="button button-small button-outline" href="/settings/logic">
              View Logic
            </Link>
          </div>
          <dl className="settings-definition-list">
            <div>
              <dt>Standard</dt>
              <dd>{data.publishedVersion.values.standard_target_days} days</dd>
            </div>
            <div>
              <dt>Core</dt>
              <dd>{data.publishedVersion.values.core_target_days} days</dd>
            </div>
            <div>
              <dt>BTG</dt>
              <dd>{data.publishedVersion.values.btg_target_days} days</dd>
            </div>
            <div>
              <dt>Default recommendation status</dt>
              <dd>{data.publishedVersion.values.recommendation_default_status}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-header">
            <h2>Recent Changes</h2>
            <Link className="button button-small button-outline" href="/settings/history">
              History
            </Link>
          </div>
          <div className="settings-list">
            {data.recentVersions.slice(0, 5).map((version) => (
              <article key={version.id}>
                <strong>v{version.version_number} · {version.status}</strong>
                <span>{version.proposal_summary || "Ordering logic update"}</span>
                <small>{dateLabel(version.published_at || version.created_at)}</small>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
