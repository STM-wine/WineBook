import { useMemo, useState } from "react";
import type { SupplierGroup } from "@/lib/types";
import { formatCurrency, formatInteger } from "@/lib/order-data";
import { MetricCard } from "./metric-card";

type SortMode = "priority" | "supplier" | "suggested" | "approved";

function supplierStatus(group: SupplierGroup): string {
  if (group.approvedBottles <= 0) return "Not Started";
  if (group.approvedBottles >= group.recommendedBottles && group.recommendedBottles > 0) return "Approved";
  return "In Progress";
}

function statusTone(status: string): string {
  if (status === "Approved") return "status-good";
  if (status === "In Progress") return "status-progress";
  return "status-muted";
}

export function SupplierBoardView({ groups }: { groups: SupplierGroup[] }) {
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [showCompleted, setShowCompleted] = useState(true);

  const filteredGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return groups
      .filter((group) => {
        const status = supplierStatus(group);
        if (!showCompleted && status === "Approved") return false;
        if (!needle) return true;
        return group.supplier.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        if (sortMode === "supplier") return a.supplier.localeCompare(b.supplier);
        if (sortMode === "suggested") return b.suggestedValue - a.suggestedValue || a.supplier.localeCompare(b.supplier);
        if (sortMode === "approved") return b.approvedValue - a.approvedValue || a.supplier.localeCompare(b.supplier);
        return b.urgentCount - a.urgentCount || b.suggestedValue - a.suggestedValue || a.supplier.localeCompare(b.supplier);
      });
  }, [groups, search, showCompleted, sortMode]);

  const totalSuppliers = filteredGroups.length;
  const totalUrgent = filteredGroups.reduce((sum, group) => sum + group.urgentCount, 0);
  const totalSuggested = filteredGroups.reduce((sum, group) => sum + group.recommendedBottles, 0);
  const totalApproved = filteredGroups.reduce((sum, group) => sum + group.approvedBottles, 0);
  const totalSuggestedValue = filteredGroups.reduce((sum, group) => sum + group.suggestedValue, 0);
  const totalApprovedValue = filteredGroups.reduce((sum, group) => sum + group.approvedValue, 0);

  return (
    <section className="panel supplier-board-panel">
      <div className="section-heading">
        <div>
          <h1>Supplier Board</h1>
          <p>Supplier-level queue for ordering pressure, approval progress, and estimated value.</p>
        </div>
      </div>
      <div className="supplier-board-metrics">
        <MetricCard label="Suppliers" value={formatInteger(totalSuppliers)} detail="Visible queue" tone="ink" />
        <MetricCard label="Urgent" value={formatInteger(totalUrgent)} detail="Rows needing action" tone="red" />
        <MetricCard label="Suggested" value={formatInteger(totalSuggested)} detail="Bottles" tone="green" />
        <MetricCard label="Approved" value={formatInteger(totalApproved)} detail="Bottles" tone="blue" />
        <MetricCard label="Suggested Value" value={formatCurrency(totalSuggestedValue)} detail="Wine + laid in" tone="gold" />
        <MetricCard label="Approved Value" value={formatCurrency(totalApprovedValue)} detail="Ready for PO" tone="plum" />
      </div>
      <div className="supplier-board-controls">
        <label className="search-field">
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Supplier name" />
        </label>
        <label>
          Sort
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="priority">Priority</option>
            <option value="supplier">Supplier A-Z</option>
            <option value="suggested">Suggested Value</option>
            <option value="approved">Approved Value</option>
          </select>
        </label>
        <label className="check-control">
          <input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />
          Show approved
        </label>
      </div>
      <div className="table-shell supplier-board-table-shell">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Status</th>
              <th>SKUs</th>
              <th>Urgent</th>
              <th>Suggested Qty</th>
              <th>Suggested Value</th>
              <th>Approved Qty</th>
              <th>Approved Value</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.map((group) => {
              const status = supplierStatus(group);
              const progress = group.recommendedBottles > 0 ? Math.min(100, (group.approvedBottles / group.recommendedBottles) * 100) : 0;

              return (
                <tr key={group.supplier}>
                  <td>{group.supplier}</td>
                  <td>
                    <span className={`status-pill ${statusTone(status)}`}>{status}</span>
                  </td>
                  <td>{formatInteger(group.skuCount)}</td>
                  <td>{formatInteger(group.urgentCount)}</td>
                  <td>{formatInteger(group.recommendedBottles)}</td>
                  <td>{formatCurrency(group.suggestedValue)}</td>
                  <td>{formatInteger(group.approvedBottles)}</td>
                  <td>{formatCurrency(group.approvedValue)}</td>
                  <td>
                    <div className="mini-progress" aria-label={`${formatInteger(progress)} percent approved`}>
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="empty-inline">No suppliers match the current filters.</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
