"use client";

import { useEffect, useMemo, useState } from "react";
import { formatInteger } from "@/lib/order-data";
import { MetricCard } from "./metric-card";

type QuickBooksItemMasterSummary = {
  statusCounts: {
    total: number;
    active: number;
    inactive: number;
    unknown: number;
  };
  fieldCoverage: Array<{
    field: string;
    present: number;
    activePresent: number;
  }>;
  itemTypes: Array<{
    itemType: string;
    count: number;
  }>;
  inventorySnapshots: number;
  itemCheckpoint: {
    checkpoint_key: string;
    status: string;
    diagnostics: Record<string, unknown> | null;
    last_synced_at: string | null;
    updated_at: string | null;
  } | null;
};

type LoadState =
  | { status: "loading"; data: null; error: null }
  | { status: "loaded"; data: QuickBooksItemMasterSummary; error: null }
  | { status: "error"; data: null; error: string };

const FIELD_LABELS: Record<string, string> = {
  quantity_on_hand: "Qty On Hand",
  quantity_on_order: "Qty On Order",
  quantity_on_sales_order: "Qty On Sales Order",
  average_cost: "Average Cost",
  purchase_cost: "Purchase Cost",
  sales_price: "Sales Price"
};

export function QuickBooksItemMasterView() {
  const [state, setState] = useState<LoadState>({ status: "loading", data: null, error: null });

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setState({ status: "loading", data: null, error: null });
      try {
        const response = await fetch("/api/quickbooks/item-master/summary", { cache: "no-store" });
        const body = await response.json().catch(() => null) as QuickBooksItemMasterSummary | { error?: string } | null;

        if (!response.ok) {
          throw new Error(body && "error" in body && body.error ? body.error : "Could not load QuickBooks item master summary.");
        }
        if (!body || !("statusCounts" in body)) {
          throw new Error("QuickBooks item master summary response was incomplete.");
        }
        if (!cancelled) {
          setState({ status: "loaded", data: body, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Could not load QuickBooks item master summary."
          });
        }
      }
    }

    loadSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>QuickBooks Item Master</h1>
            <p>Loading item-master health...</p>
          </div>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>QuickBooks Item Master</h1>
            <p>{state.error}</p>
          </div>
        </div>
      </section>
    );
  }

  return <QuickBooksItemMasterSummaryView summary={state.data} />;
}

function QuickBooksItemMasterSummaryView({ summary }: { summary: QuickBooksItemMasterSummary }) {
  const checkpointDiagnostics = summary.itemCheckpoint?.diagnostics || {};
  const itemPullStatus = summary.itemCheckpoint?.status || "Unknown";
  const itemPullFreshness = formatDateTime(summary.itemCheckpoint?.last_synced_at || summary.itemCheckpoint?.updated_at);
  const recordCount = numberValue(checkpointDiagnostics.recordCount);
  const completedPages = numberValue(checkpointDiagnostics.completedPages);
  const lastStatus = objectValue(checkpointDiagnostics.lastStatus);
  const remainingCount = numberValue(lastStatus.iteratorRemainingCount);
  const statusMessage = stringValue(lastStatus.statusMessage);
  const activeMissingAny = useMemo(
    () => summary.fieldCoverage.reduce((max, row) => Math.max(max, summary.statusCounts.active - row.activePresent), 0),
    [summary.fieldCoverage, summary.statusCounts.active]
  );

  return (
    <>
      <section className="metric-grid">
        <MetricCard label="QB Items" value={formatInteger(summary.statusCounts.total)} detail="Rows mirrored from QuickBooks" tone="ink" />
        <MetricCard label="Active" value={formatInteger(summary.statusCounts.active)} detail="Available to normal matching" tone="green" />
        <MetricCard label="Inactive" value={formatInteger(summary.statusCounts.inactive)} detail="Stored for duplicate checks" tone="gold" />
        <MetricCard label="Snapshots" value={formatInteger(summary.inventorySnapshots)} detail="Inventory history rows" tone={summary.inventorySnapshots > 0 ? "blue" : "red"} />
        <MetricCard label="Missing Fields" value={formatInteger(activeMissingAny)} detail="Max active-item gap" tone={activeMissingAny > 0 ? "gold" : "green"} />
        <MetricCard label="Pull Status" value={itemPullStatus} detail={itemPullFreshness || "No checkpoint time"} tone={itemPullStatus === "completed" ? "blue" : "red"} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>QuickBooks Item Master</h1>
            <p>Read-only health check for the item roster that will become the product brain.</p>
          </div>
        </div>
        <div className="inline-warning">
          QuickBooks items are not changing Order Review or PO Drafts yet. Current ordering remains report-driven while this view validates item-master readiness.
        </div>
        <div className="table-shell quickbooks-health-table">
          <table>
            <thead>
              <tr>
                <th>Signal</th>
                <th>Value</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Item pull</td>
                <td>{itemPullStatus}</td>
                <td>{statusMessage || "No QuickBooks status message"}</td>
              </tr>
              <tr>
                <td>Record count</td>
                <td>{recordCount ? formatInteger(recordCount) : "Unknown"}</td>
                <td>{completedPages ? `${formatInteger(completedPages)} completed pages` : "Page count unavailable"}</td>
              </tr>
              <tr>
                <td>Iterator remaining</td>
                <td>{remainingCount === null ? "Unknown" : formatInteger(remainingCount)}</td>
                <td>Completed item pulls should be 0.</td>
              </tr>
              <tr>
                <td>Inactive duplicate checks</td>
                <td>{formatInteger(summary.statusCounts.inactive)}</td>
                <td>Inactive items are stored but excluded from normal matching.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>Ordering Field Coverage</h1>
            <p>Coverage for fields needed before QuickBooks can enrich ordering decisions.</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Total Present</th>
                <th>Active Present</th>
                <th>Active Missing</th>
              </tr>
            </thead>
            <tbody>
              {summary.fieldCoverage.map((row) => (
                <tr key={row.field}>
                  <td>{FIELD_LABELS[row.field] || row.field}</td>
                  <td>{formatInteger(row.present)}</td>
                  <td>{formatInteger(row.activePresent)}</td>
                  <td>{formatInteger(Math.max(0, summary.statusCounts.active - row.activePresent))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>Item Types</h1>
            <p>QuickBooks item categories in the mirrored roster.</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Item Type</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {summary.itemTypes.map((row) => (
                <tr key={row.itemType}>
                  <td>{row.itemType}</td>
                  <td>{formatInteger(row.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
