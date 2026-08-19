"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DatabaseOrderSummaryPreviewData,
  DatabaseOrderSummaryPreviewRow,
  DatabaseOrderSummaryPreviewSupplier
} from "@/lib/database-order-summary-preview";
import { formatCurrency, formatDecimal, formatInteger } from "@/lib/order-data";
import { MetricCard } from "./metric-card";

type LoadState =
  | { status: "loading"; data: null; error: "" }
  | { status: "ready"; data: DatabaseOrderSummaryPreviewData; error: "" }
  | { status: "error"; data: null; error: string };

export function DatabaseOrderSummaryPreviewView() {
  const [state, setState] = useState<LoadState>({ status: "loading", data: null, error: "" });
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState({ status: "loading", data: null, error: "" });
    fetch("/api/order-summary-preview", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load preview.");
        return body as DatabaseOrderSummaryPreviewData;
      })
      .then((data) => {
        if (!active) return;
        setState({ status: "ready", data, error: "" });
        setExpandedSupplier(data.suppliers[0]?.supplierName || null);
      })
      .catch((error) => {
        if (!active) return;
        setState({ status: "error", data: null, error: error instanceof Error ? error.message : "Could not load preview." });
      });

    return () => {
      active = false;
    };
  }, []);

  const supplierOptions = useMemo(
    () => ["All", ...(state.data?.suppliers.map((supplier) => supplier.supplierName) || [])],
    [state.data]
  );
  const visibleSuppliers = useMemo(() => {
    if (!state.data) return [];
    const needle = search.trim().toLowerCase();
    return state.data.suppliers
      .map((supplier) => ({
        ...supplier,
        rows: supplier.rows.filter((row) => {
          if (reviewOnly && row.sourceStatus === "ready") return false;
          if (!needle) return true;
          return [
            row.itemCode,
            row.productName,
            row.supplierName,
            row.supplierSource,
            row.blockers.join(" ")
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle);
        })
      }))
      .filter((supplier) => supplierFilter === "All" || supplier.supplierName === supplierFilter)
      .filter((supplier) => supplier.rows.length > 0);
  }, [reviewOnly, search, state.data, supplierFilter]);

  if (state.status === "loading") {
    return (
      <section className="panel database-preview-panel">
        <p className="eyebrow">Database Order Preview</p>
        <h1>Building preview...</h1>
        <p className="muted">Reading QuickBooks, Vinosmith available inventory, app markers, and Supplier Logistics.</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="panel database-preview-panel">
        <p className="eyebrow">Database Order Preview</p>
        <h1>Preview could not load</h1>
        <p className="error-text">{state.error}</p>
      </section>
    );
  }

  const data = state.data;

  return (
    <>
      <section className="metric-grid">
        <MetricCard label="Preview Rows" value={formatInteger(data.summary.previewRows)} detail="Active QB item codes" tone="ink" />
        <MetricCard label="Ready" value={formatInteger(data.summary.readyRows)} detail="Rows with source proof" tone="green" />
        <MetricCard label="Needs Review" value={formatInteger(data.summary.reviewRows)} detail="Missing source proof" tone="gold" />
        <MetricCard label="Suggested" value={formatInteger(data.summary.recommendedBottles)} detail="Database bottles" tone="blue" />
        <MetricCard label="Delta vs Report" value={formatSignedInteger(data.summary.recommendedBottleDelta)} detail="Bottles" tone="plum" />
        <MetricCard label="Value" value={formatCurrency(data.summary.suggestedValue)} detail="Landed estimate" tone="green" />
      </section>

      <section className="panel database-preview-panel">
        <div className="section-heading">
          <div>
            <h1>Database Order Summary Preview</h1>
            <p>
              Diagnostic only. This uses Vinosmith Available, QuickBooks sales/on-order/cost/pack, app Core/BTG markers,
              and Supplier Logistics.
            </p>
          </div>
          <span className="diagnostic-pill">Not Live</span>
        </div>

        <div className="preview-source-strip">
          <div>
            <span>Reference Date</span>
            <strong>{data.referenceDate}</strong>
          </div>
          <div>
            <span>VS Inventory</span>
            <strong>{formatDateTime(data.latestInventorySnapshotAt)}</strong>
          </div>
          <div>
            <span>Current Report</span>
            <strong>{data.latestReportRun?.report_date || "Latest completed"}</strong>
          </div>
        </div>

        <div className="preview-warning-list">
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>

        <div className="filter-bar">
          <label>
            Supplier
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              {supplierOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="search-field">
            Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Wine, item #, supplier, blocker" />
          </label>
          <label className="check-control">
            <input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} />
            Needs review only
          </label>
          <span>{formatInteger(visibleSuppliers.length)} suppliers shown</span>
        </div>

        <SupplierSummaryTable suppliers={visibleSuppliers} onSelectSupplier={setExpandedSupplier} />
      </section>

      <section className="supplier-stack database-preview-stack">
        {visibleSuppliers.map((supplier) => (
          <PreviewSupplierSection
            key={supplier.supplierName}
            supplier={supplier}
            open={expandedSupplier === supplier.supplierName || supplierFilter !== "All"}
            onToggle={() => setExpandedSupplier((current) => current === supplier.supplierName ? null : supplier.supplierName)}
          />
        ))}
      </section>
    </>
  );
}

function SupplierSummaryTable({
  suppliers,
  onSelectSupplier
}: {
  suppliers: DatabaseOrderSummaryPreviewSupplier[];
  onSelectSupplier: (supplier: string) => void;
}) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>Supplier</th>
            <th>Status</th>
            <th>Rows</th>
            <th>Suggested Qty</th>
            <th>Report Qty</th>
            <th>Delta</th>
            <th>Suggested Value</th>
          </tr>
        </thead>
        <tbody>
          {suppliers.slice(0, 30).map((supplier) => (
            <tr key={supplier.supplierName}>
              <td>
                <button className="text-link-button" onClick={() => onSelectSupplier(supplier.supplierName)} type="button">
                  {supplier.supplierName}
                </button>
              </td>
              <td><StatusPill status={supplier.sourceStatus} /></td>
              <td>{formatInteger(supplier.rowCount)} <span className="muted-cell">/ {formatInteger(supplier.reviewRows)} review</span></td>
              <td>{formatInteger(supplier.recommendedBottles)}</td>
              <td>{formatInteger(supplier.currentReportRecommendedBottles)}</td>
              <td>{formatSignedInteger(supplier.recommendedBottleDelta)}</td>
              <td>{formatCurrency(supplier.suggestedValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewSupplierSection({
  supplier,
  open,
  onToggle
}: {
  supplier: DatabaseOrderSummaryPreviewSupplier;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <details className="supplier-section database-preview-section" open={open} onToggle={onToggle}>
      <summary>
        <div>
          <span className="supplier-chip">{supplier.supplierName}</span>
          <StatusPill status={supplier.sourceStatus} />
          <strong>{formatInteger(supplier.recommendedBottles)} bottles</strong>
          <span>{formatCurrency(supplier.suggestedValue)} suggested</span>
          <span>{formatSignedInteger(supplier.recommendedBottleDelta)} vs report</span>
        </div>
        <div className="supplier-summary-actions">
          <span>{formatInteger(supplier.rowCount)} rows</span>
        </div>
      </summary>
      <div className="table-shell database-preview-lines-shell">
        <table className="database-preview-lines">
          <thead>
            <tr>
              <th>Item</th>
              <th>Status</th>
              <th>Suggested</th>
              <th>Report</th>
              <th>VS Available</th>
              <th>QB On Hand</th>
              <th>QB On Order</th>
              <th>Sales 30/60/90</th>
              <th>FOB</th>
              <th>Pack</th>
              <th>Core / BTG</th>
              <th>Proof</th>
            </tr>
          </thead>
          <tbody>
            {supplier.rows.map((row) => (
              <PreviewLineRow key={row.itemCode} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function PreviewLineRow({ row }: { row: DatabaseOrderSummaryPreviewRow }) {
  return (
    <tr>
      <td>
        <strong>{row.itemCode}</strong>
        <span className="muted-cell">{row.productName}</span>
      </td>
      <td><StatusPill status={row.sourceStatus} /></td>
      <td>
        <strong>{formatInteger(row.recommendedQty)}</strong>
        <span className="muted-cell">{formatSignedInteger(row.recommendedQtyDelta ?? 0)} delta</span>
      </td>
      <td>{row.currentReportRecommendedQty === null ? "-" : formatInteger(row.currentReportRecommendedQty)}</td>
      <td>
        <strong>{formatInteger(row.vinosmithAvailable)}</strong>
        <span className="muted-cell">Hold {formatInteger(row.vinosmithHold)} / Future {formatInteger(row.vinosmithFuture)}</span>
      </td>
      <td>{formatInteger(row.quickBooksOnHand)}</td>
      <td>{formatInteger(row.quickBooksOnOrder)}</td>
      <td>{formatInteger(row.sales30)} / {formatInteger(row.sales60)} / {formatInteger(row.sales90)}</td>
      <td>{formatCurrency(row.fob)}</td>
      <td>
        {formatInteger(row.packSize)}
        <span className="muted-cell">{row.packSizeSource}</span>
      </td>
      <td>{[row.isCore ? "Core" : "", row.isBtg ? "BTG" : ""].filter(Boolean).join(" / ") || "-"}</td>
      <td>
        <span>{row.supplierSource}</span>
        {row.blockers.length ? <span className="blocker-list">{row.blockers.join("; ")}</span> : null}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: "ready" | "needs_review" }) {
  return (
    <span className={status === "ready" ? "status-pill status-good" : "status-pill status-progress"}>
      {status === "ready" ? "Ready" : "Needs Review"}
    </span>
  );
}

function formatSignedInteger(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatInteger(value)}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Missing";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
