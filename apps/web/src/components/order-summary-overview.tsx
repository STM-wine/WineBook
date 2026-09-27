"use client";
import { useState } from "react";
import type { DashboardMetrics, SupplierGroup } from "@/lib/types";
import { formatCurrency, formatInteger } from "@/lib/order-data";
import { MetricCard } from "./metric-card";

export function OrderSummaryMetrics({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <section className="metric-grid order-summary-metrics">
      <MetricCard label="Urgent" value={formatInteger(metrics.urgent)} detail="SKUs need action" tone="red" />
      <MetricCard label="Low" value={formatInteger(metrics.low)} detail="Below target" tone="gold" />
      <MetricCard label="Recommended" value={formatInteger(metrics.recommendedBottles)} detail="Bottles" tone="green" />
      <MetricCard label="PO Approved" value={formatInteger(metrics.approvedBottles)} detail="Net bottles ready for PO" tone="blue" />
      <MetricCard label="Approved Value" value={formatCurrency(metrics.poValue)} detail="Net unprocessed value" tone="plum" />
      <MetricCard label="Suppliers" value={formatInteger(metrics.supplierCount)} detail="With suggested orders" tone="ink" />
    </section>
  );
}

export function SummaryTable({ groups }: { groups: Omit<SupplierGroup, "rows">[] }) {
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
              <th>Free Goods</th>
              <th>Suggested Qty</th>
              <th>Suggested Value</th>
              <th>PO Approved Qty</th>
              <th>Approved Value</th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((group) => (
              <tr key={group.supplier}>
                <td>{group.supplier}</td>
                <td>{formatInteger(group.skuCount)}</td>
                <td>{formatInteger(group.urgentCount)}</td>
                <td>{formatInteger(group.freeGoodProgramCount)}</td>
                <td>{formatInteger(group.recommendedBottles)}</td>
                <td>{formatCurrency(group.suggestedValue)}</td>
                <td>{formatInteger(group.approvedBottles)}</td>
                <td>
                  <strong className={group.approvedValue > 0 ? "approved-value-strong" : undefined}>
                    {formatCurrency(group.approvedValue)}
                  </strong>
                  <span className="value-comparison">
                    {approvedValueComparison(group.approvedValue, group.suggestedValue)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}


function approvedValueComparison(approvedValue: number, suggestedValue: number) {
  if (suggestedValue <= 0) return "No suggested value";
  if (approvedValue === 0) return "No approved value";
  return `${formatInteger(Math.round((approvedValue / suggestedValue) * 100))}% of suggested`;
}
