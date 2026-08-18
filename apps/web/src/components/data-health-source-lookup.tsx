"use client";

import { useState, useTransition } from "react";

type LookupSourceRow = {
  source: "QuickBooks" | "Vinosmith";
  code: string | null;
  name: string;
  status: string;
  detail: string;
  supplierName: string | null;
  brandName: string | null;
  lastSeenAt: string | null;
};

type LookupGroup = {
  query: string;
  rows: LookupSourceRow[];
  guidance: string;
  tone: "good" | "warning" | "danger" | "neutral";
};

type LookupResponse = {
  groups: LookupGroup[];
  quickBooksItemsUpdatedAt: string | null;
  vinosmithWinesUpdatedAt: string | null;
  error?: string;
};

const DEFAULT_LOOKUP = "AST000024, ARI000016, MW000542";

export function DataHealthSourceLookup() {
  const [query, setQuery] = useState(DEFAULT_LOOKUP);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function verifyFixes() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/settings/data-health/product-lookup?q=${encodeURIComponent(trimmed)}`);
        const body = (await response.json()) as LookupResponse;
        if (!response.ok || body.error) {
          setError(body.error || "Could not verify source records.");
          setResult(null);
          return;
        }
        setResult(body);
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : "Could not verify source records.");
        setResult(null);
      }
    });
  }

  return (
    <section className="settings-panel data-health-lookup-panel">
      <div className="settings-panel-header">
        <div>
          <h2>Verify a Fix</h2>
          <p className="muted">Check the app mirror after changing QuickBooks or Vinosmith. Source changes only clear Data Health after that source has refreshed.</p>
        </div>
      </div>

      <div className="data-health-refresh-guide">
        <article>
          <strong>Changed QuickBooks?</strong>
          <span>Run QuickBooks Web Connector until QuickBooks Items shows a new updated time.</span>
        </article>
        <article>
          <strong>Changed Vinosmith?</strong>
          <span>Use Re-sync Vinosmith, wait for the workflow to finish, then reload Data Health.</span>
        </article>
      </div>

      <div className="data-health-lookup-form">
        <label>
          <span>Item codes or names</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="AST000024, ARI000016, MW000542" />
        </label>
        <button className="button button-small" disabled={isPending} onClick={verifyFixes} type="button">
          {isPending ? "Checking..." : "Check mirror"}
        </button>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {result ? (
        <div className="data-health-lookup-results">
          <div className="data-health-lookup-freshness">
            <span>QB Items: {dateTimeLabel(result.quickBooksItemsUpdatedAt)}</span>
            <span>VS Wines: {dateTimeLabel(result.vinosmithWinesUpdatedAt)}</span>
          </div>
          {result.groups.map((group) => (
            <article className={`data-health-lookup-group tone-${group.tone}`} key={group.query}>
              <div>
                <strong>{group.query}</strong>
                <span>{group.guidance}</span>
              </div>
              <div className="data-health-lookup-source-list">
                {group.rows.map((row, index) => (
                  <div key={`${row.source}-${row.code || row.name}-${index}`}>
                    <b>{row.source}</b>
                    <strong>{row.code || "-"}</strong>
                    <span>{row.name}</span>
                    <small>{row.status} · {row.detail}</small>
                    <small>{[row.supplierName, row.brandName].filter(Boolean).join(" · ") || "No supplier/brand shown"}</small>
                    <small>Seen {dateTimeLabel(row.lastSeenAt)}</small>
                  </div>
                ))}
                {group.rows.length === 0 ? <p className="muted">No matching QuickBooks or Vinosmith mirror rows found.</p> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
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
