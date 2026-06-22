import { AccountPending, getAppContext } from "@/lib/auth";
import { fetchSettingsOverview } from "@/lib/settings-data";

function dateLabel(value: string | null) {
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

export default async function SettingsHistoryPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;
  const data = await fetchSettingsOverview(context);

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>History</h1>
        <p className="muted">Published versions are immutable. Restoring older logic should create a new draft based on that version.</p>
      </header>

      <section className="settings-panel">
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Summary</th>
                <th>Published</th>
                <th>Targets</th>
              </tr>
            </thead>
            <tbody>
              {data.recentVersions.map((version) => (
                <tr key={version.id}>
                  <td>v{version.version_number}</td>
                  <td>{version.status}</td>
                  <td>
                    <strong>{version.proposal_summary || "Ordering logic update"}</strong>
                    <small>{version.change_reason || "No reason recorded"}</small>
                  </td>
                  <td>{dateLabel(version.published_at)}</td>
                  <td>
                    Standard {version.values.standard_target_days} / Core {version.values.core_target_days} / BTG{" "}
                    {version.values.btg_target_days}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
