import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";
import {
  ORDERING_LOGIC_FIELD_GROUPS,
  settingValueLabel,
  type ConfigurationVersion,
  type OrderingLogicSettings
} from "@/lib/ordering-logic";
import { previewOrderingLogicImpact } from "@/lib/ordering-preview";
import { fetchSettingsOverview } from "@/lib/settings-data";
import {
  createLogicChangeRequest,
  createLogicDraft,
  publishLogicProposal,
  submitLogicProposal
} from "@/app/settings/actions";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function inputName(key: keyof OrderingLogicSettings) {
  return String(key);
}

function settingInput(settings: OrderingLogicSettings, key: keyof OrderingLogicSettings) {
  const value = settings[key];
  if (typeof value === "boolean") {
    return <input name={inputName(key)} type="checkbox" defaultChecked={value} />;
  }
  if (typeof value === "number") {
    return <input name={inputName(key)} type="number" step={Number.isInteger(value) ? 1 : 0.01} defaultValue={value} />;
  }
  if (key === "recommendation_default_status") {
    return <input name={inputName(key)} value="rejected" readOnly />;
  }
  return null;
}

function ProposalPreview({ version, rows }: { version: ConfigurationVersion; rows: Parameters<typeof previewOrderingLogicImpact>[0] }) {
  const preview = previewOrderingLogicImpact(rows, version.values);
  return (
    <div className="settings-preview">
      <div>
        <span>Changed SKUs</span>
        <strong>{formatNumber(preview.changedSkus)}</strong>
      </div>
      <div>
        <span>Bottle Delta</span>
        <strong>{formatNumber(preview.totalBottleDelta)}</strong>
      </div>
      <div>
        <span>Estimated FOB Delta</span>
        <strong>{formatMoney(preview.estimatedCostDelta)}</strong>
      </div>
      <div>
        <span>Zero To Positive</span>
        <strong>{formatNumber(preview.zeroToPositive)}</strong>
      </div>
      <div>
        <span>Positive To Zero</span>
        <strong>{formatNumber(preview.positiveToZero)}</strong>
      </div>
      {preview.supplierImpacts.length ? (
        <div className="settings-preview-wide">
          <span>Most Affected Suppliers</span>
          <ul>
            {preview.supplierImpacts.map((supplier) => (
              <li key={supplier.supplier}>
                {supplier.supplier}: {formatNumber(supplier.bottleDelta)} bottles, {formatMoney(supplier.costDelta)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.warnings.length ? (
        <div className="settings-preview-wide warning">
          <span>Warnings</span>
          <ul>
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default async function LogicSettingsPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;
  const data = await fetchSettingsOverview(context);
  const canDraft = hasPermission(context.permissions, "draft_logic_changes");
  const canPublish = hasPermission(context.permissions, "publish_logic_changes");

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Logic Settings</p>
        <h1>Published Ordering Logic</h1>
        <p className="muted">
          Buyers can inspect effective logic and request changes. Admin proposals are drafts until a publisher confirms preview and publication.
        </p>
      </header>

      <section className="settings-panel">
        <div className="settings-panel-header">
          <div>
            <h2>Effective Version v{data.publishedVersion.version_number}</h2>
            <p className="muted">{data.publishedVersion.change_reason || data.publishedVersion.proposal_summary}</p>
          </div>
          <span className="status-pill">published</span>
        </div>

        {ORDERING_LOGIC_FIELD_GROUPS.map((group) => (
          <div className="settings-group" key={group.title}>
            <h3>{group.title}</h3>
            <div className="settings-field-grid">
              {group.fields.map((field) => (
                <article key={field.key} className="settings-field">
                  <span>{field.label}</span>
                  <strong>
                    {settingValueLabel(data.publishedVersion.values, field.key)}
                    {field.unit ? ` ${field.unit}` : ""}
                  </strong>
                  <p>{field.explanation}</p>
                  <small>{field.impact}</small>
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="settings-panel">
        <h2>Request A Logic Change</h2>
        <form action={createLogicChangeRequest} className="settings-form settings-form-grid">
          <label>
            Setting
            <select name="setting_key" required>
              {ORDERING_LOGIC_FIELD_GROUPS.flatMap((group) => group.fields).map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Current value
            <input name="current_value" placeholder="Current published value" />
          </label>
          <label>
            Requested value
            <input name="requested_value" required />
          </label>
          <label>
            Effective timing
            <input name="effective_timing" placeholder="Next report, next month, specific date" />
          </label>
          <label className="settings-form-wide">
            Example supplier or SKU
            <input name="example" />
          </label>
          <label className="settings-form-wide">
            Business reason
            <textarea name="explanation" required rows={4} />
          </label>
          <button className="button" type="submit">
            Submit Request
          </button>
        </form>
      </section>

      {canDraft ? (
        <section className="settings-panel">
          <h2>Create Admin Proposal</h2>
          <form action={createLogicDraft} className="settings-form">
            <div className="settings-form-grid">
              <label>
                Proposal summary
                <input name="proposal_summary" required placeholder="Increase Core coverage for summer" />
              </label>
              <label>
                Business reason
                <input name="change_reason" required />
              </label>
            </div>
            {ORDERING_LOGIC_FIELD_GROUPS.map((group) => (
              <div className="settings-group" key={group.title}>
                <h3>{group.title}</h3>
                <div className="settings-form-grid">
                  {group.fields.map((field) => (
                    <label key={field.key}>
                      {field.label}
                      {settingInput(data.publishedVersion.values, field.key)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="settings-group">
              <h3>Monthly Multipliers</h3>
              <div className="settings-month-grid">
                {Array.from({ length: 12 }, (_, index) => {
                  const month = String(index + 1);
                  const value = data.publishedVersion.values.monthly_multipliers[month];
                  return (
                    <div key={month}>
                      <span>{month}</span>
                      <input aria-label={`Month ${month} mode`} name={`month_${month}_mode`} defaultValue={value.mode} />
                      <input
                        aria-label={`Month ${month} multiplier`}
                        name={`month_${month}_multiplier`}
                        type="number"
                        step="0.01"
                        defaultValue={value.multiplier}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <button className="button" type="submit">
              Save Draft Proposal
            </button>
          </form>
        </section>
      ) : null}

      {data.pendingProposals.length ? (
        <section className="settings-panel">
          <h2>Pending Proposals</h2>
          <div className="settings-list">
            {data.pendingProposals.map((version) => (
              <article key={version.id}>
                <div className="settings-panel-header">
                  <div>
                    <strong>v{version.version_number} · {version.status}</strong>
                    <span>{version.proposal_summary}</span>
                  </div>
                  {version.status === "draft" && canDraft ? (
                    <form action={submitLogicProposal}>
                      <input name="version_id" type="hidden" value={version.id} />
                      <button className="button button-small button-outline" type="submit">
                        Submit
                      </button>
                    </form>
                  ) : null}
                </div>
                <ProposalPreview version={version} rows={data.latestRecommendations} />
                {canPublish ? (
                  <form action={publishLogicProposal} className="settings-publish-form">
                    <input name="version_id" type="hidden" value={version.id} />
                    <label>
                      Publication reason
                      <input name="publish_reason" required defaultValue={version.change_reason || ""} />
                    </label>
                    <label className="checkbox-row">
                      <input name="preview_confirmed" type="checkbox" required /> Preview completed
                    </label>
                    <label className="checkbox-row">
                      <input name="future_runs_confirmed" type="checkbox" required /> Changes apply to future report runs only
                    </label>
                    <button className="button" type="submit">
                      Publish
                    </button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
