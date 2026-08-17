"use client";

import { useMemo, useState } from "react";
import { updateVinosmithPlumbingIssueWorkflow } from "@/app/settings/actions";
import type { VinosmithProductHealth, VinosmithProductHealthIssue } from "@/lib/types";

export type VinosmithPlumbingWorkflowRow = {
  issue_key: string;
  issue_type: string | null;
  issue_title: string | null;
  item_code: string | null;
  product_name: string | null;
  source_of_truth: string | null;
  status: string;
  assigned_to: string | null;
  admin_note: string | null;
  last_reviewed_at: string | null;
  updated_at: string | null;
};

type WorkflowQueueProps = {
  productHealth: VinosmithProductHealth;
  recentResolved: VinosmithPlumbingWorkflowRow[];
  workflowStorageAvailable: boolean;
  workflowWarning: string | null;
  workflows: VinosmithPlumbingWorkflowRow[];
};

type IssueGroup = {
  issueType: string;
  rows: VinosmithProductHealthIssue[];
  title: string;
};

const PLUMBING_STATUS_OPTIONS = [
  { value: "needs_review", label: "Needs Review" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_on_qb", label: "Waiting on QB" },
  { value: "waiting_on_vs", label: "Waiting on VS" },
  { value: "fixed_needs_resync", label: "Fixed - needs re-sync" },
  { value: "ignored", label: "Ignored" },
  { value: "resolved", label: "Resolved" }
];

export function VinosmithPlumbingWorkflowQueue({
  productHealth,
  recentResolved,
  workflowStorageAvailable,
  workflowWarning,
  workflows
}: WorkflowQueueProps) {
  const [statusFilter, setStatusFilter] = useState("All");
  const [fixInFilter, setFixInFilter] = useState("All");
  const [issueTypeFilter, setIssueTypeFilter] = useState("All");
  const [ownerFilter, setOwnerFilter] = useState("All");
  const [search, setSearch] = useState("");

  const workflowByKey = useMemo(() => new Map(workflows.map((workflow) => [workflow.issue_key, workflow])), [workflows]);
  const issueGroups = useMemo(() => issueGroupsForHealth(productHealth), [productHealth]);
  const allIssues = useMemo(
    () => issueGroups.flatMap((group) => group.rows.map((row) => enrichIssue(group, row, workflowByKey))),
    [issueGroups, workflowByKey]
  );
  const statusCounts = useMemo(() => countBy(allIssues.map((issue) => issue.status)), [allIssues]);
  const fixInOptions = useMemo(() => ["All", ...uniqueSorted(allIssues.map((issue) => issue.sourceOfTruth))], [allIssues]);
  const issueTypeOptions = useMemo(() => ["All", ...issueGroups.map((group) => group.title)], [issueGroups]);
  const ownerOptions = useMemo(
    () => ["All", ...uniqueSorted(allIssues.map((issue) => issue.workflow?.assigned_to || "Unassigned"))],
    [allIssues]
  );
  const query = search.trim().toLowerCase();
  const filteredIssueGroups = useMemo(
    () => issueGroups.map((group) => ({
      ...group,
      rows: group.rows.filter((row) => {
        const enriched = enrichIssue(group, row, workflowByKey);
        if (statusFilter !== "All" && enriched.status !== statusFilter) return false;
        if (fixInFilter !== "All" && enriched.sourceOfTruth !== fixInFilter) return false;
        if (issueTypeFilter !== "All" && group.title !== issueTypeFilter) return false;
        if (ownerFilter !== "All" && (enriched.workflow?.assigned_to || "Unassigned") !== ownerFilter) return false;
        if (!query) return true;
        return [
          row.itemCode,
          row.productName,
          row.supplierName,
          row.quickBooksStatus,
          row.vinosmithStatus,
          row.issue,
          enriched.sourceOfTruth,
          enriched.workflow?.assigned_to,
          enriched.workflow?.admin_note
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
    })),
    [fixInFilter, issueGroups, issueTypeFilter, ownerFilter, query, statusFilter, workflowByKey]
  );
  const visibleCount = filteredIssueGroups.reduce((total, group) => total + group.rows.length, 0);

  return (
    <div className="plumbing-queue">
      <section className="settings-panel plumbing-workflow-summary-panel">
        <div className="settings-panel-header">
          <div>
            <h2>Workflow Queue</h2>
            <p className="muted">Filter the current findings and track Stem-side review status.</p>
          </div>
          <span className="data-pill">{visibleCount.toLocaleString("en-US")} shown</span>
        </div>

        <div className="plumbing-status-rollups">
          {PLUMBING_STATUS_OPTIONS.map((status) => (
            <button
              key={status.value}
              className={statusFilter === status.value ? "active" : undefined}
              onClick={() => setStatusFilter(statusFilter === status.value ? "All" : status.value)}
              type="button"
            >
              <span>{status.label}</span>
              <strong>{(statusCounts.get(status.value) || 0).toLocaleString("en-US")}</strong>
            </button>
          ))}
        </div>

        <div className="plumbing-filters">
          <label>
            <span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code, wine, supplier, note" />
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option>All</option>
              {PLUMBING_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Fix in</span>
            <select value={fixInFilter} onChange={(event) => setFixInFilter(event.target.value)}>
              {fixInOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span>Issue type</span>
            <select value={issueTypeFilter} onChange={(event) => setIssueTypeFilter(event.target.value)}>
              {issueTypeOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span>Owner</span>
            <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
              {ownerOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </section>

      {workflowWarning ? <p className="warning-banner plumbing-workflow-warning">{workflowWarning}</p> : null}

      {filteredIssueGroups.map((group) => (
        <IssueSection
          group={group}
          key={group.issueType}
          workflowByKey={workflowByKey}
          workflowStorageAvailable={workflowStorageAvailable}
        />
      ))}

      <RecentlyResolvedSection recentResolved={recentResolved} />
    </div>
  );
}

function IssueSection({
  group,
  workflowByKey,
  workflowStorageAvailable
}: {
  group: IssueGroup;
  workflowByKey: Map<string, VinosmithPlumbingWorkflowRow>;
  workflowStorageAvailable: boolean;
}) {
  return (
    <section className="settings-panel plumbing-issue-panel">
      <div className="settings-panel-header">
        <div>
          <h2>{group.title}</h2>
          <p className="muted">{group.rows.length.toLocaleString("en-US")} examples shown for review.</p>
        </div>
      </div>
      <div className="plumbing-issue-list">
        {group.rows.map((row) => {
          const issueKey = workflowKeyForIssue(row);
          const sourceOfTruth = sourceOfTruthForIssue(row);
          const workflow = workflowByKey.get(issueKey);
          return (
            <article className="plumbing-issue-row" key={row.id}>
              <div className="plumbing-issue-main">
                <div>
                  <strong>{row.itemCode || "-"}</strong>
                  <span>{row.productName}</span>
                  <p>{row.issue}</p>
                </div>
                <small>Seen {dateTimeLabel(row.lastSeenAt)}</small>
              </div>

              <div className="plumbing-source-summary" aria-label="Source status">
                <span><b>Supplier</b>{row.supplierName || "-"}</span>
                <span><b>QB</b>{row.quickBooksStatus}</span>
                <span><b>VS</b>{row.vinosmithStatus}</span>
              </div>

              <div className="plumbing-fix-summary">
                <span className="source-of-truth-chip">{sourceOfTruth}</span>
                <p>{nextStepForIssue(row)}</p>
              </div>

              <div className="plumbing-workflow-cell">
                {workflowStorageAvailable ? (
                  <form action={updateVinosmithPlumbingIssueWorkflow} className="plumbing-workflow-form">
                    <input name="issue_key" type="hidden" value={issueKey} />
                    <input name="issue_type" type="hidden" value={group.issueType} />
                    <input name="issue_title" type="hidden" value={group.title} />
                    <input name="item_code" type="hidden" value={row.itemCode || ""} />
                    <input name="product_name" type="hidden" value={row.productName} />
                    <input name="source_of_truth" type="hidden" value={sourceOfTruth} />
                    <label>
                      <span>Status</span>
                      <select name="status" defaultValue={workflow?.status || "needs_review"}>
                        {PLUMBING_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Owner</span>
                      <input name="assigned_to" defaultValue={workflow?.assigned_to || ""} placeholder="Name or team" />
                    </label>
                    <label>
                      <span>Note</span>
                      <textarea name="admin_note" defaultValue={workflow?.admin_note || ""} placeholder="What changed or what is blocking this?" rows={2} />
                    </label>
                    <button className="button button-small button-outline" type="submit">Save</button>
                    {workflow?.last_reviewed_at ? <small>Reviewed {dateTimeLabel(workflow.last_reviewed_at)}</small> : null}
                  </form>
                ) : (
                  <span className="data-pill is-warning">Migration needed</span>
                )}
              </div>
            </article>
          );
        })}
        {group.rows.length === 0 ? <p className="muted plumbing-empty">No issues match the current filters.</p> : null}
      </div>
    </section>
  );
}

function RecentlyResolvedSection({ recentResolved }: { recentResolved: VinosmithPlumbingWorkflowRow[] }) {
  if (recentResolved.length === 0) return null;

  return (
    <section className="settings-panel plumbing-resolved-panel">
      <div className="settings-panel-header">
        <div>
          <h2>Recently Resolved After Re-sync</h2>
          <p className="muted">These workflow items no longer appear in current diagnostics.</p>
        </div>
      </div>
      <div className="plumbing-resolved-list">
        {recentResolved.map((workflow) => (
          <article key={workflow.issue_key}>
            <strong>{workflow.item_code || "No code"} · {workflow.product_name || workflow.issue_title || "Resolved issue"}</strong>
            <span>{workflow.source_of_truth || "Source reviewed"} · {workflow.issue_title || workflow.issue_type || "Vinosmith plumbing"}</span>
            <small>Updated {dateTimeLabel(workflow.updated_at || workflow.last_reviewed_at)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function issueGroupsForHealth(productHealth: VinosmithProductHealth): IssueGroup[] {
  return [
    {
      issueType: "qb_active_vs_inactive_or_missing_vs",
      title: "Active in QB, inactive or missing in VS",
      rows: productHealth.examples.qbActiveVsInactiveOrMissingVs
    },
    {
      issueType: "vs_active_orderable_vs_inactive_or_missing_qb",
      title: "Active/orderable in VS, inactive or missing in QB",
      rows: productHealth.examples.vsActiveOrderableVsInactiveOrMissingQb
    },
    {
      issueType: "missing_supplier_importer_or_brand",
      title: "Missing supplier/importer/brand data",
      rows: productHealth.examples.metadataGaps
    },
    {
      issueType: "unmatched_item_codes",
      title: "Unmatched item codes",
      rows: productHealth.examples.unmatchedItemCodes
    }
  ];
}

function enrichIssue(group: IssueGroup, row: VinosmithProductHealthIssue, workflowByKey: Map<string, VinosmithPlumbingWorkflowRow>) {
  const workflow = workflowByKey.get(workflowKeyForIssue(row));
  return {
    group,
    row,
    sourceOfTruth: sourceOfTruthForIssue(row),
    status: workflow?.status || "needs_review",
    workflow
  };
}

function workflowKeyForIssue(row: VinosmithProductHealthIssue) {
  return `${normalizeWorkflowKey(row.issue)}:${row.id}`;
}

function normalizeWorkflowKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function sourceOfTruthForIssue(row: VinosmithProductHealthIssue) {
  const issue = row.issue.toLowerCase();
  if (issue.includes("qb active / no vs")) return "Vinosmith, or QuickBooks if stale";
  if (issue.includes("qb active / vs inactive")) return "Vinosmith status";
  if (issue.includes("vs active/orderable / no qb")) return "QuickBooks item";
  if (issue.includes("vs active/orderable / qb inactive")) return "QuickBooks status";
  if (issue.includes("supplier/importer") || issue.includes("brand/producer")) return "Vinosmith wine metadata";
  if (issue.includes("missing")) return "Source record, then re-sync";
  return "Source owner review";
}

function nextStepForIssue(row: VinosmithProductHealthIssue) {
  const issue = row.issue.toLowerCase();
  if (issue.includes("qb active / no vs")) {
    return "Match/create the Vinosmith wine, or deactivate the QB item if it should not sell.";
  }
  if (issue.includes("qb active / vs inactive")) {
    return "Confirm lifecycle, then reactivate/orderable in VS or deactivate in QB.";
  }
  if (issue.includes("vs active/orderable / no qb")) {
    return "Create/link the QB item, or mark the VS wine inactive/not orderable.";
  }
  if (issue.includes("vs active/orderable / qb inactive")) {
    return "Reactivate/link QB, or make the VS wine inactive/not orderable.";
  }
  if (issue.includes("missing")) {
    return "Fill the missing source fields, then re-sync Vinosmith.";
  }
  return "Review source ownership, correct the source record, then re-sync.";
}

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

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return counts;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}
