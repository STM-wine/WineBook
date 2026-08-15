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
  salesCoverage: {
    currentYear: QuickBooksSalesCoverageRange;
    priorYear: QuickBooksSalesCoverageRange;
    checkpointCoverage: Array<{
      resourceName: string;
      status: string;
      count: number;
    }>;
  };
  orderingShadow: {
    latestReport: {
      id: string;
      report_date: string | null;
      completed_at: string | null;
    } | null;
    recommendationRows: number;
    productCodeRows: number;
    missingProductCodeRows: number;
    exactMatchRows: number;
    noMatchRows: number;
    activeMatchRows: number;
    inactiveOnlyRows: number;
    duplicateActiveRows: number;
    duplicateInactiveRows: number;
    costMismatchRows: number;
    quantityMismatchRows: number;
    onOrderMismatchRows: number;
    examples: Array<{
      productCode: string | null;
      productName: string | null;
      supplierName: string | null;
      issue: string;
      currentValue: string | number | null;
      quickbooksValue: string | number | null;
    }>;
  };
};

type QuickBooksSalesCoverageRange = {
  label: string;
  from: string;
  to: string;
  invoices: {
    count: number;
    earliestTxnDate: string | null;
    latestTxnDate: string | null;
  };
  creditMemos: {
    count: number;
    earliestTxnDate: string | null;
    latestTxnDate: string | null;
  };
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
        <MetricCard label="2025 QB Sales" value={formatInteger(summary.salesCoverage.priorYear.invoices.count)} detail={`${formatInteger(summary.salesCoverage.priorYear.creditMemos.count)} credit memos`} tone={summary.salesCoverage.priorYear.invoices.count > 0 ? "green" : "red"} />
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
            <h1>QuickBooks Sales Coverage</h1>
            <p>Backfill coverage needed before YOY ordering recommendations can be compared against QuickBooks sales truth.</p>
          </div>
        </div>
        <div className="inline-warning">
          Ordering should continue to use the current report workflow until 2025 QuickBooks invoices and credit memos are complete enough for year-over-year comparisons.
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Range</th>
                <th>Invoices</th>
                <th>Invoice Dates</th>
                <th>Credit Memos</th>
                <th>Credit Memo Dates</th>
              </tr>
            </thead>
            <tbody>
              {[summary.salesCoverage.currentYear, summary.salesCoverage.priorYear].map((range) => (
                <tr key={range.label}>
                  <td>{range.label}</td>
                  <td>{formatInteger(range.invoices.count)}</td>
                  <td>{dateSpan(range.invoices.earliestTxnDate, range.invoices.latestTxnDate)}</td>
                  <td>{formatInteger(range.creditMemos.count)}</td>
                  <td>{dateSpan(range.creditMemos.earliestTxnDate, range.creditMemos.latestTxnDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-shell quickbooks-health-table">
          <table>
            <thead>
              <tr>
                <th>2025 Backfill Queue</th>
                <th>Pending</th>
                <th>Running</th>
                <th>Completed</th>
                <th>Failed / Repair</th>
              </tr>
            </thead>
            <tbody>
              {["quickbooks_invoices", "quickbooks_credit_memos"].map((resourceName) => (
                <tr key={resourceName}>
                  <td>{resourceName.replace("quickbooks_", "").replace("_", " ")}</td>
                  <td>{formatInteger(checkpointCount(summary, resourceName, "pending"))}</td>
                  <td>{formatInteger(checkpointCount(summary, resourceName, "running"))}</td>
                  <td>{formatInteger(checkpointCount(summary, resourceName, "completed"))}</td>
                  <td>{formatInteger(checkpointCount(summary, resourceName, "failed") + checkpointCount(summary, resourceName, "needs_repair"))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>Ordering Shadow Comparison</h1>
            <p>Read-only comparison of current report recommendation rows against exact QuickBooks item matches.</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Signal</th>
                <th>Rows</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Recommendations</td>
                <td>{formatInteger(summary.orderingShadow.recommendationRows)}</td>
                <td>Rows from latest completed report.</td>
              </tr>
              <tr>
                <td>Exact QB matches</td>
                <td>{formatInteger(summary.orderingShadow.exactMatchRows)}</td>
                <td>Matched by current product code to QB item name/full name/custom item code.</td>
              </tr>
              <tr>
                <td>No QB match</td>
                <td>{formatInteger(summary.orderingShadow.noMatchRows)}</td>
                <td>Needs identity review before QuickBooks can become item truth.</td>
              </tr>
              <tr>
                <td>Inactive-only matches</td>
                <td>{formatInteger(summary.orderingShadow.inactiveOnlyRows)}</td>
                <td>Current ordering row maps only to inactive QuickBooks items.</td>
              </tr>
              <tr>
                <td>Cost mismatches</td>
                <td>{formatInteger(summary.orderingShadow.costMismatchRows)}</td>
                <td>Current FOB differs from QB purchase/average cost.</td>
              </tr>
              <tr>
                <td>Inventory mismatches</td>
                <td>{formatInteger(summary.orderingShadow.quantityMismatchRows + summary.orderingShadow.onOrderMismatchRows)}</td>
                <td>Current available/on-order differs from QB item quantities.</td>
              </tr>
            </tbody>
          </table>
        </div>
        {summary.orderingShadow.examples.length > 0 ? (
          <div className="table-shell quickbooks-health-table">
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Item</th>
                  <th>Supplier</th>
                  <th>Current</th>
                  <th>QuickBooks</th>
                </tr>
              </thead>
              <tbody>
                {summary.orderingShadow.examples.map((example, index) => (
                  <tr key={`${example.issue}-${example.productCode || index}`}>
                    <td>{example.issue}</td>
                    <td>{example.productCode ? `${example.productCode} - ${example.productName || "Unnamed"}` : example.productName || "Unnamed"}</td>
                    <td>{example.supplierName || "Unknown"}</td>
                    <td>{displayValue(example.currentValue)}</td>
                    <td>{displayValue(example.quickbooksValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
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

function dateSpan(earliest: string | null, latest: string | null) {
  if (!earliest && !latest) return "No rows";
  if (earliest === latest) return earliest || latest || "";
  return `${earliest || "?"} to ${latest || "?"}`;
}

function checkpointCount(summary: QuickBooksItemMasterSummary, resourceName: string, status: string) {
  return summary.salesCoverage.checkpointCoverage.find((row) => row.resourceName === resourceName && row.status === status)?.count || 0;
}

function displayValue(value: string | number | null) {
  if (value === null || value === "") return "-";
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}
