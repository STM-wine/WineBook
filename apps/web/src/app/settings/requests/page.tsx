import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";
import { fetchSettingsOverview } from "@/lib/settings-data";
import { resolveLogicChangeRequest } from "@/app/settings/actions";

function dateLabel(value: string | null) {
  if (!value) return "Open";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default async function SettingsRequestsPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;
  const data = await fetchSettingsOverview(context);
  const canResolve = hasPermission(context.permissions, "draft_logic_changes");

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>Change Requests</h1>
        <p className="muted">Buyer requests are review items. They do not change active logic unless an admin proposal is published.</p>
      </header>

      <section className="settings-panel">
        <div className="settings-list">
          {data.changeRequests.map((request) => (
            <article key={request.id}>
              <div className="settings-panel-header">
                <div>
                  <strong>{String(request.requested_changes.setting_key || "Logic setting")} · {request.status}</strong>
                  <span>{request.explanation}</span>
                  <small>{dateLabel(request.created_at)}</small>
                </div>
              </div>
              <dl className="settings-definition-list">
                <div>
                  <dt>Requested value</dt>
                  <dd>{String(request.requested_changes.requested_value || "Not specified")}</dd>
                </div>
                <div>
                  <dt>Current value</dt>
                  <dd>{String(request.requested_changes.current_value || "Not specified")}</dd>
                </div>
                <div>
                  <dt>Example</dt>
                  <dd>{String(request.requested_changes.example || "None")}</dd>
                </div>
              </dl>
              {request.admin_response ? <p className="muted">{request.admin_response}</p> : null}
              {canResolve && request.status === "open" ? (
                <form action={resolveLogicChangeRequest} className="settings-publish-form">
                  <input name="request_id" type="hidden" value={request.id} />
                  <label>
                    Admin response
                    <input name="admin_response" />
                  </label>
                  <label>
                    Status
                    <select name="status" defaultValue="accepted">
                      <option value="accepted">Accepted</option>
                      <option value="declined">Declined</option>
                      <option value="implemented">Implemented</option>
                    </select>
                  </label>
                  <button className="button button-small" type="submit">
                    Update Request
                  </button>
                </form>
              ) : null}
            </article>
          ))}
          {data.changeRequests.length === 0 ? <p className="muted">No settings change requests yet.</p> : null}
        </div>
      </section>
    </>
  );
}
