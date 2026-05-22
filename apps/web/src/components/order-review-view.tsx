import { useState } from "react";
import type { DashboardMetrics, Recommendation, SupplierGroup } from "@/lib/types";
import { formatCurrency, formatInteger } from "@/lib/order-data";
import { MetricCard } from "./metric-card";
import { WorkbenchGrid } from "./workbench-grid";

export function OrderReviewView({
  brandManager,
  brandManagerOptions,
  expandAll,
  metrics,
  search,
  setBrandManager,
  setExpandAll,
  setSearch,
  setSuggestedOnly,
  setSupplier,
  suggestedOnly,
  supplier,
  supplierGroups,
  supplierOptions,
  visibleCount,
  onSaveApproval,
  onSaveWorkingQty,
  onSetWorkingQty
}: {
  brandManager: string;
  brandManagerOptions: string[];
  expandAll: boolean;
  metrics: DashboardMetrics;
  search: string;
  setBrandManager: (value: string) => void;
  setExpandAll: (value: boolean) => void;
  setSearch: (value: string) => void;
  setSuggestedOnly: (value: boolean) => void;
  setSupplier: (value: string) => void;
  suggestedOnly: boolean;
  supplier: string;
  supplierGroups: SupplierGroup[];
  supplierOptions: string[];
  visibleCount: number;
  onSaveApproval: (row: Recommendation, approved: boolean, qtyOverride?: number) => void;
  onSaveWorkingQty: (row: Recommendation, qty: number) => void;
  onSetWorkingQty: (row: Recommendation, qty: number) => void;
}) {
  return (
    <>
      <section className="metric-grid">
        <MetricCard label="Urgent" value={formatInteger(metrics.urgent)} detail="SKUs need action" tone="red" />
        <MetricCard label="Low" value={formatInteger(metrics.low)} detail="Below target" tone="gold" />
        <MetricCard label="Recommended" value={formatInteger(metrics.recommendedBottles)} detail="Bottles" tone="green" />
        <MetricCard label="Approved" value={formatInteger(metrics.approvedBottles)} detail="Bottles ready for PO" tone="blue" />
        <MetricCard label="PO Value" value={formatCurrency(metrics.poValue)} detail="Approved lines" tone="plum" />
        <MetricCard label="Suppliers" value={formatInteger(metrics.supplierCount)} detail="With suggested orders" tone="ink" />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>Order Summary</h1>
            <p>Supplier groups sorted by suggested order value. Rows are live from the latest completed report run.</p>
          </div>
        </div>
        <div className="filter-bar">
          <label>
            Supplier
            <select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
              {supplierOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Brand Manager
            <select value={brandManager} onChange={(event) => setBrandManager(event.target.value)}>
              {brandManagerOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="search-field">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Wine, supplier, item #"
            />
          </label>
          <label className="check-control">
            <input
              type="checkbox"
              checked={suggestedOnly}
              onChange={(event) => setSuggestedOnly(event.target.checked)}
            />
            Suggested only
          </label>
        </div>
        <SummaryTable groups={supplierGroups} />
      </section>

      <div className="workbench-controls">
        <label className="check-control">
          <input type="checkbox" checked={expandAll} onChange={(event) => setExpandAll(event.target.checked)} />
          Expand all supplier workbenches
        </label>
        <div className="workbench-control-buttons">
          <button className="ghost-button" onClick={() => setExpandAll(true)} type="button">
            Expand All
          </button>
          <button className="ghost-button" onClick={() => setExpandAll(false)} type="button">
            Collapse All
          </button>
        </div>
        <span>{formatInteger(visibleCount)} visible SKUs</span>
      </div>

      <section className="supplier-stack">
        {supplierGroups.map((group) => (
          <SupplierSection
            key={group.supplier}
            group={group}
            expandAll={expandAll || supplier !== "All"}
            onSaveApproval={onSaveApproval}
            onSetWorkingQty={onSetWorkingQty}
            onSaveWorkingQty={onSaveWorkingQty}
          />
        ))}
      </section>
    </>
  );
}

function SummaryTable({ groups }: { groups: SupplierGroup[] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleGroups = showAll ? groups : groups.slice(0, 7);

  return (
    <>
      <div className="summary-table-actions">
        <span>
          Showing {formatInteger(visibleGroups.length)} of {formatInteger(groups.length)} suppliers
        </span>
        <div>
          <button className="ghost-button" onClick={() => setShowAll(true)} type="button">
            Expand All
          </button>
          <button className="ghost-button" onClick={() => setShowAll(false)} type="button">
            Collapse All
          </button>
        </div>
      </div>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>SKUs</th>
              <th>Urgent</th>
              <th>Suggested Qty</th>
              <th>Suggested Value</th>
              <th>Approved Qty</th>
              <th>Approved Value</th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((group) => (
              <tr key={group.supplier}>
                <td>{group.supplier}</td>
                <td>{formatInteger(group.skuCount)}</td>
                <td>{formatInteger(group.urgentCount)}</td>
                <td>{formatInteger(group.recommendedBottles)}</td>
                <td>{formatCurrency(group.suggestedValue)}</td>
                <td>{formatInteger(group.approvedBottles)}</td>
                <td>{formatCurrency(group.approvedValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SupplierSection({
  group,
  expandAll,
  onSaveApproval,
  onSetWorkingQty,
  onSaveWorkingQty
}: {
  group: SupplierGroup;
  expandAll: boolean;
  onSaveApproval: (row: Recommendation, approved: boolean, qtyOverride?: number) => void;
  onSetWorkingQty: (row: Recommendation, qty: number) => void;
  onSaveWorkingQty: (row: Recommendation, qty: number) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const tdmNames = Array.from(new Set(group.rows.map((row) => row.brand_manager?.trim() || "").filter(Boolean)));
  const tdmLabel = tdmNames.length === 0 ? "TDM unassigned" : tdmNames.length === 1 ? `TDM ${tdmNames[0]}` : "Multiple TDMs";

  return (
    <details className="supplier-section" open={expandAll || undefined}>
      <summary>
        <div>
          <span className="supplier-chip">{group.supplier}</span>
          <span className="supplier-chip supplier-chip-muted">{tdmLabel}</span>
          <strong>{formatInteger(group.recommendedBottles)} bottles</strong>
          <span>{formatCurrency(group.suggestedValue)} suggested</span>
        </div>
        <span>{formatInteger(group.skuCount)} SKUs</span>
      </summary>
      <div className="supplier-metrics">
        <MetricCard label="SKUs" value={formatInteger(group.skuCount)} detail="In this supplier" tone="ink" />
        <MetricCard label="Urgent" value={formatInteger(group.urgentCount)} detail="Need review" tone="red" />
        <MetricCard label="Suggested" value={formatInteger(group.recommendedBottles)} detail="Bottles" tone="green" />
        <MetricCard label="Approved" value={formatInteger(group.approvedBottles)} detail="Bottles" tone="blue" />
        <MetricCard label="Value" value={formatCurrency(group.suggestedValue)} detail="Suggested order" tone="gold" />
      </div>
      <div className="supplier-workbench-options">
        <label className="check-control">
          <input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />
          Show 60/90d sales
        </label>
        <label className="check-control">
          <input type="checkbox" checked={showForecast} onChange={(event) => setShowForecast(event.target.checked)} />
          Show LY 60/90d forecast
        </label>
      </div>
      <WorkbenchGrid
        rows={group.rows}
        showForecast={showForecast}
        showHistory={showHistory}
        onSaveApproval={onSaveApproval}
        onSetWorkingQty={onSetWorkingQty}
        onSaveWorkingQty={onSaveWorkingQty}
      />
    </details>
  );
}
