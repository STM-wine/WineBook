"use client";

import { useMemo, useState, useTransition } from "react";

type SortKey = "name" | "date" | "type" | "priority" | "premise" | "sourceName" | "assignedRep";
type SortState = {
  key: SortKey;
  direction: "asc" | "desc";
};

export type LeadIntelligenceLead = {
  id: string;
  name: string;
  date: string | null;
  type: string;
  licenseSeries: number | null;
  licenseNumber: string | null;
  address: string | null;
  hot: boolean;
  priority: "hot" | "watch" | "low" | "noise";
  premise: string;
  channel: "on_premise" | "off_premise" | "hybrid" | "production" | "wholesale" | "event" | "unknown";
  bucket: string;
  team: string | null;
  sourceName: string;
  sourceUrl: string | null;
  suggestedRepId: string | null;
  suggestedRepReason: string | null;
  assignedRepId: string | null;
  filterReason: string | null;
  isPreview: boolean;
};

export type LeadIntelligenceRep = {
  id: string;
  label: string;
  initials: string | null;
};

type LeadIntelligenceViewProps = {
  leads: LeadIntelligenceLead[];
  reps: LeadIntelligenceRep[];
  sourceUnavailableReason: string | null;
  canAssign: boolean;
};

export function LeadIntelligenceView({ leads, reps, sourceUnavailableReason, canAssign }: LeadIntelligenceViewProps) {
  const [rows, setRows] = useState(leads);
  const [windowDays, setWindowDays] = useState<30 | 90>(30);
  const [sort, setSort] = useState<SortState>({ key: "date", direction: "desc" });
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visibleRows = useMemo(() => {
    return rows
      .filter((row) => isWithinWindow(row.date, windowDays))
      .sort((a, b) => compareLeads(a, b, sort, reps));
  }, [reps, rows, sort, windowDays]);

  const summary = useMemo(() => {
    return {
      hot: visibleRows.filter((row) => row.priority === "hot").length,
      offPremise: visibleRows.filter((row) => row.channel === "off_premise").length,
      assigned: visibleRows.filter((row) => row.assignedRepId).length,
      noise: visibleRows.filter((row) => row.priority === "noise").length
    };
  }, [visibleRows]);

  function handleAssign(lead: LeadIntelligenceLead, repId: string) {
    setMessage(null);
    setErrorMessage(null);

    if (lead.isPreview) {
      setRows((currentRows) => currentRows.map((row) => (row.id === lead.id ? { ...row, assignedRepId: repId || null } : row)));
      setMessage(repId ? "Preview assignment selected." : "Preview assignment cleared.");
      return;
    }

    setSavingLeadId(lead.id);
    startTransition(async () => {
      try {
        const response = await fetch("/api/modules/lead-intelligence/assign-rep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id, repId: repId || null })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(result?.error || "Could not save assignment.");
        }
        setRows((currentRows) => currentRows.map((row) => (row.id === lead.id ? { ...row, assignedRepId: repId || null } : row)));
        setMessage(repId ? "Rep assigned." : "Assignment cleared.");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not save assignment.");
      } finally {
        setSavingLeadId(null);
      }
    });
  }

  function changeSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  }

  return (
    <section className="lead-intelligence-view" aria-label="Lead Intelligence">
      {sourceUnavailableReason ? <div className="status-card warning">{sourceUnavailableReason}</div> : null}
      {message ? <div className="status-card success">{message}</div> : null}
      {errorMessage ? <div className="status-card error">{errorMessage}</div> : null}

      <div className="lead-intelligence-summary" aria-label="Lead summary">
        <div>
          <span>Hot</span>
          <strong>{summary.hot}</strong>
        </div>
        <div>
          <span>Off-premise</span>
          <strong>{summary.offPremise}</strong>
        </div>
        <div>
          <span>Assigned</span>
          <strong>{summary.assigned}</strong>
        </div>
        <div>
          <span>Noise</span>
          <strong>{summary.noise}</strong>
        </div>
      </div>

      <div className="lead-table-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">New Account Signals</p>
            <h2>{windowDays === 30 ? "30-day alerts" : "90-day lead history"}</h2>
          </div>
          <div className="lead-table-controls">
            {rows.some((row) => row.isPreview) ? <span className="lead-preview-pill">Preview data</span> : <span className="lead-preview-pill live">Live data</span>}
            <div className="lead-window-toggle" aria-label="Lead window">
              <button className={windowDays === 30 ? "active" : ""} onClick={() => setWindowDays(30)} type="button">
                30 days
              </button>
              <button className={windowDays === 90 ? "active" : ""} onClick={() => setWindowDays(90)} type="button">
                90 days
              </button>
            </div>
            <span className="lead-count">{visibleRows.length} rows</span>
          </div>
        </div>

        <div className="lead-table-scroll">
          <table className="lead-intelligence-table">
            <thead>
              <tr>
                <SortableHeader label="New Account Name" sortKey="name" sort={sort} onSort={changeSort} />
                <SortableHeader label="Date" sortKey="date" sort={sort} onSort={changeSort} />
                <SortableHeader label="Type" sortKey="type" sort={sort} onSort={changeSort} />
                <SortableHeader label="Hot" sortKey="priority" sort={sort} onSort={changeSort} />
                <SortableHeader label="Premise" sortKey="premise" sort={sort} onSort={changeSort} />
                <SortableHeader label="Source" sortKey="sourceName" sort={sort} onSort={changeSort} />
                <SortableHeader label="Assign Rep" sortKey="assignedRep" sort={sort} onSort={changeSort} />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((lead) => (
                <tr key={lead.id} className={lead.priority === "noise" ? "is-muted" : ""}>
                  <td>
                    <div className="lead-name-cell">
                      <strong>{lead.name}</strong>
                      {lead.address ? <small>{lead.address}</small> : null}
                      <span>
                        {lead.isPreview ? "Preview - " : ""}
                        {lead.team ? teamLabel(lead.team) : bucketLabel(lead.bucket)}
                      </span>
                      {lead.filterReason ? <small>{lead.filterReason}</small> : null}
                    </div>
                  </td>
                  <td>{lead.date ? formatDate(lead.date) : "TBD"}</td>
                  <td>
                    <div className="lead-type-cell">
                      <span>{lead.type}</span>
                      {lead.licenseSeries ? <small>Series {lead.licenseSeries}</small> : null}
                      {lead.licenseNumber ? <small>Lic. {lead.licenseNumber}</small> : null}
                    </div>
                  </td>
                  <td>
                    <span className={`lead-priority-pill priority-${lead.priority}`}>{priorityLabel(lead.priority)}</span>
                  </td>
                  <td>{lead.premise}</td>
                  <td>
                    {lead.sourceUrl ? (
                      <a href={lead.sourceUrl} target="_blank" rel="noreferrer">
                        {shortSourceName(lead.sourceName)}
                      </a>
                    ) : (
                      shortSourceName(lead.sourceName)
                    )}
                  </td>
                  <td>
                    <div className="lead-rep-cell">
                      <select
                        aria-label={`Assign rep for ${lead.name}`}
                        value={lead.assignedRepId || ""}
                        disabled={!canAssign || savingLeadId === lead.id || isPending || reps.length === 0}
                        onChange={(event) => handleAssign(lead, event.target.value)}
                      >
                        <option value="">{reps.length ? "Unassigned" : "No reps loaded"}</option>
                        {reps.map((rep) => (
                          <option key={rep.id} value={rep.id}>
                            {rep.label}
                          </option>
                        ))}
                      </select>
                      {lead.suggestedRepReason ? <small title={suggestionText(lead, reps) || undefined}>{suggestionText(lead, reps)}</small> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!visibleRows.length ? (
                <tr>
                  <td colSpan={7}>
                    <div className="lead-empty-row">No leads in this window.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SortableHeader({
  label,
  onSort,
  sort,
  sortKey
}: {
  label: string;
  onSort: (key: SortKey) => void;
  sort: SortState;
  sortKey: SortKey;
}) {
  const active = sort.key === sortKey;
  return (
    <th>
      <button className="table-sort-button" onClick={() => onSort(sortKey)} type="button">
        {label}
        <span>{active ? (sort.direction === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function compareLeads(a: LeadIntelligenceLead, b: LeadIntelligenceLead, sort: SortState, reps: LeadIntelligenceRep[]) {
  const direction = sort.direction === "asc" ? 1 : -1;
  const left = sortValue(a, sort.key, reps);
  const right = sortValue(b, sort.key, reps);

  if (typeof left === "number" && typeof right === "number") {
    return (left - right) * direction || a.name.localeCompare(b.name);
  }

  return String(left).localeCompare(String(right)) * direction || a.name.localeCompare(b.name);
}

function sortValue(lead: LeadIntelligenceLead, key: SortKey, reps: LeadIntelligenceRep[]) {
  if (key === "date") return dateValue(lead.date);
  if (key === "priority") return priorityRank(lead.priority);
  if (key === "premise") return lead.premise;
  if (key === "sourceName") return shortSourceName(lead.sourceName);
  if (key === "assignedRep") return repLabel(lead.assignedRepId, reps);
  return lead[key] || "";
}

function dateValue(value: string | null) {
  if (!value) return 0;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function priorityRank(priority: LeadIntelligenceLead["priority"]) {
  if (priority === "hot") return 0;
  if (priority === "watch") return 1;
  if (priority === "low") return 2;
  return 3;
}

function repLabel(repId: string | null, reps: LeadIntelligenceRep[]) {
  if (!repId) return "Unassigned";
  return reps.find((rep) => rep.id === repId)?.label || repId;
}

function priorityLabel(priority: LeadIntelligenceLead["priority"]) {
  if (priority === "hot") return "Hot";
  if (priority === "noise") return "No";
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function teamLabel(team: string) {
  return team.replaceAll("_", "-");
}

function bucketLabel(bucket: string) {
  return bucket.replaceAll("_", " ");
}

function suggestionText(lead: LeadIntelligenceLead, reps: LeadIntelligenceRep[]) {
  const suggestedRep = reps.find((rep) => rep.id === lead.suggestedRepId);
  if (!suggestedRep) return lead.suggestedRepReason;
  return `Suggested: ${suggestedRep.label} - ${lead.suggestedRepReason}`;
}

function isWithinWindow(value: string | null, days: number) {
  if (!value) return true;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return true;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

function shortSourceName(value: string) {
  return value
    .replace("City of Phoenix Newly Received Liquor License Applications", "Phoenix Licenses")
    .replace("Arizona Department of Liquor Licenses and Control License Search", "AZ DLLC")
    .replace("Phoenix New Times Food & Drink", "Phoenix New Times");
}
