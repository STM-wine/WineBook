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
  const [compareSupplier, setCompareSupplier] = useState<string | null>(null);

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
        setCompareSupplier(data.suppliers.find((supplier) => supplier.draftRowCount > 0)?.supplierName || data.suppliers[0]?.supplierName || null);
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
  const compareSupplierRow = useMemo(() => {
    if (!state.data) return null;
    return state.data.suppliers.find((supplier) => supplier.supplierName === compareSupplier) || state.data.suppliers[0] || null;
  }, [compareSupplier, state.data]);
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
            row.quickBooksPreferredVendorName || "",
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
        <MetricCard label="API-Ready" value={formatInteger(data.summary.readyRows)} detail="Full source match" tone="green" />
        <MetricCard label="Review Notes" value={formatInteger(data.summary.reviewRows)} detail="Cleanup visibility" tone="gold" />
        <MetricCard label="Suggested" value={formatInteger(data.summary.recommendedBottles)} detail="Database bottles" tone="blue" />
        <MetricCard label="Delta vs Report" value={formatSignedInteger(data.summary.recommendedBottleDelta)} detail="Bottles" tone="plum" />
        <MetricCard label="Value" value={formatCurrency(data.summary.suggestedValue)} detail="Landed estimate" tone="green" />
        <MetricCard
          label="QB Vendor Map"
          value={`${formatInteger(data.summary.quickBooksPreferredVendorMappedRows)} / ${formatInteger(data.summary.quickBooksPreferredVendorRows)}`}
          detail="Preferred vendor rows"
          tone="green"
        />
        <MetricCard
          label="Unmapped Vendors"
          value={formatInteger(data.summary.unmappedQuickBooksPreferredVendorRows)}
          detail="Need supplier match"
          tone={data.summary.unmappedQuickBooksPreferredVendorRows ? "gold" : "green"}
        />
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

        <PreferredVendorCleanupTable rows={data.topUnmappedPreferredVendorRows} count={data.summary.unmappedQuickBooksPreferredVendorRows} />

        <DraftComparePanel
          supplier={compareSupplierRow}
          suppliers={data.suppliers}
          selectedSupplier={compareSupplier}
          onSelectSupplier={(supplierName) => {
            setCompareSupplier(supplierName);
            setExpandedSupplier(supplierName);
          }}
        />

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
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Wine, item #, supplier, review note" />
          </label>
          <label className="check-control">
            <input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} />
            Review only
          </label>
          <span>{formatInteger(visibleSuppliers.length)} suppliers shown</span>
        </div>

        <SupplierSummaryTable
          suppliers={visibleSuppliers}
          onSelectSupplier={(supplierName) => {
            setExpandedSupplier(supplierName);
            setCompareSupplier(supplierName);
          }}
        />
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

function PreferredVendorCleanupTable({
  rows,
  count
}: {
  rows: DatabaseOrderSummaryPreviewRow[];
  count: number;
}) {
  if (count === 0) {
    return (
      <div className="preferred-vendor-cleanup preferred-vendor-cleanup-ready">
        <div>
          <p className="eyebrow">QB Preferred Vendor Cleanup</p>
          <h2>All active QB inventory rows have mapped supplier proof.</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="preferred-vendor-cleanup">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">QB Preferred Vendor Cleanup</p>
          <h2>{formatInteger(count)} active rows still need vendor-to-supplier mapping</h2>
          <p>These rows have a QB preferred vendor, but that vendor is not yet matched to Supplier Logistics.</p>
        </div>
      </div>
      <div className="table-shell preferred-vendor-cleanup-table-shell">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>QB Preferred Vendor</th>
              <th>Current Preview Group</th>
              <th>What To Fix</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.itemCode}>
                <td>
                  <strong>{row.itemCode}</strong>
                  <span className="muted-cell">{row.productName}</span>
                </td>
                <td>{row.quickBooksPreferredVendorName || "-"}</td>
                <td>{row.supplierName}</td>
                <td>{row.supplierSource}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
              <td>{formatInteger(supplier.rowCount)} <span className="muted-cell">/ {formatInteger(supplier.reviewRows)} noted</span></td>
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

function DraftComparePanel({
  supplier,
  suppliers,
  selectedSupplier,
  onSelectSupplier
}: {
  supplier: DatabaseOrderSummaryPreviewSupplier | null;
  suppliers: DatabaseOrderSummaryPreviewSupplier[];
  selectedSupplier: string | null;
  onSelectSupplier: (supplier: string) => void;
}) {
  if (!supplier) return null;
  const databaseValue = supplier.suggestedValue;
  const reportValue = supplier.draftRows.reduce(
    (sum, row) => sum + (row.currentReportRecommendedQty ?? 0) * row.landedBottleCost,
    0
  );

  return (
    <div className="draft-compare-panel">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Draft Compare</p>
          <h2>Side-by-side suggested draft output</h2>
          <p>Pick a supplier and compare the database recommendation against the current report recommendation.</p>
        </div>
        <div className="draft-compare-actions">
          <select value={selectedSupplier || supplier.supplierName} onChange={(event) => onSelectSupplier(event.target.value)}>
            {suppliers.map((option) => (
              <option key={option.supplierName} value={option.supplierName}>
                {option.supplierName}
              </option>
            ))}
          </select>
          <button className="button button-small button-outline" type="button" onClick={() => downloadDraftCompareCsv(supplier)}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="draft-compare-metrics">
        <div>
          <span>DB Suggested</span>
          <strong>{formatInteger(supplier.recommendedBottles)}</strong>
          <small>{formatInteger(supplier.databaseDraftLines)} lines / {formatCurrency(databaseValue)}</small>
        </div>
        <div>
          <span>Report Suggested</span>
          <strong>{formatInteger(supplier.currentReportRecommendedBottles)}</strong>
          <small>{formatInteger(supplier.reportDraftLines)} lines / {formatCurrency(reportValue)}</small>
        </div>
        <div>
          <span>Difference</span>
          <strong>{formatSignedInteger(supplier.recommendedBottleDelta)}</strong>
          <small>{formatSignedCurrency(supplier.suggestedValueDelta)}</small>
        </div>
      </div>

      <div className="table-shell draft-compare-table-shell">
        <table className="draft-compare-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>DB Draft</th>
              <th>Report Draft</th>
              <th>Delta</th>
              <th>DB Est.</th>
              <th>Available / On Order</th>
              <th>Sales 30/60/90</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {supplier.draftRows.length ? (
              supplier.draftRows.map((row) => <DraftCompareLine key={row.itemCode} row={row} />)
            ) : (
              <tr>
                <td colSpan={8}>No suggested lines for this supplier in either source.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DraftCompareLine({ row }: { row: DatabaseOrderSummaryPreviewRow }) {
  const reportQty = row.currentReportRecommendedQty ?? 0;
  return (
    <tr>
      <td>
        <strong>{row.itemCode}</strong>
        <span className="muted-cell">{row.productName}</span>
      </td>
      <td><strong>{formatInteger(row.recommendedQty)}</strong></td>
      <td>{formatInteger(reportQty)}</td>
      <td className={row.recommendedQtyDelta && row.recommendedQtyDelta !== 0 ? "delta-cell" : ""}>
        {formatSignedInteger(row.recommendedQtyDelta ?? row.recommendedQty - reportQty)}
      </td>
      <td>{formatCurrency(row.landedCost)}</td>
      <td>
        {formatInteger(row.vinosmithAvailable)} / {formatInteger(row.quickBooksOnOrder)}
        <span className="muted-cell">VS Available / QB PO</span>
      </td>
      <td>{formatInteger(row.sales30)} / {formatInteger(row.sales60)} / {formatInteger(row.sales90)}</td>
      <td>
        {[row.isCore ? "Core" : "", row.isBtg ? "BTG" : ""].filter(Boolean).join(" / ") || row.supplierSource}
        {row.blockers.length ? <span className="blocker-list">{row.blockers.join("; ")}</span> : null}
      </td>
    </tr>
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
        {row.quickBooksPreferredVendorName ? <span className="muted-cell">QB vendor: {row.quickBooksPreferredVendorName}</span> : null}
        {row.blockers.length ? <span className="blocker-list">{row.blockers.join("; ")}</span> : null}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: "ready" | "needs_review" }) {
  return (
    <span className={status === "ready" ? "status-pill status-good" : "status-pill status-progress"}>
      {status === "ready" ? "API-ready" : "Review"}
    </span>
  );
}

function formatSignedInteger(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatInteger(value)}`;
}

function formatSignedCurrency(value: number) {
  if (value === 0) return formatCurrency(0);
  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function csvEscape(value: string | number) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function downloadDraftCompareCsv(supplier: DatabaseOrderSummaryPreviewSupplier) {
  const headers = [
    "Supplier",
    "Item Code",
    "Product",
    "DB Suggested Qty",
    "Report Suggested Qty",
    "Delta",
    "DB Estimated Cost",
    "Vinosmith Available",
    "QB On Order",
    "Sales 30",
    "Sales 60",
    "Sales 90",
    "Notes"
  ];
  const rows = supplier.draftRows.map((row) => [
    supplier.supplierName,
    row.itemCode,
    row.productName,
    row.recommendedQty,
    row.currentReportRecommendedQty ?? 0,
    row.recommendedQtyDelta ?? row.recommendedQty - (row.currentReportRecommendedQty ?? 0),
    row.landedCost.toFixed(2),
    row.vinosmithAvailable,
    row.quickBooksOnOrder,
    row.sales30,
    row.sales60,
    row.sales90,
    [row.isCore ? "Core" : "", row.isBtg ? "BTG" : "", ...row.blockers].filter(Boolean).join("; ")
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const supplierSlug = supplier.supplierName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  link.href = url;
  link.download = `DB draft compare ${supplierSlug || "supplier"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
