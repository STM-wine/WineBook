"use client";

import { useState } from "react";
import type { QuickBooksSalesDashboardData, QuickBooksSalesSummaryRow } from "@/lib/quickbooks-sales-types";

type SalesDashboardViewProps = {
  data: QuickBooksSalesDashboardData;
};

type SummaryMode = "rep" | "account";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1
});

export function SalesDashboardView({ data }: SalesDashboardViewProps) {
  const [mode, setMode] = useState<SummaryMode>("rep");
  const rows = mode === "rep" ? data.byRep : data.byAccount;
  const salesDateLabel = formatDateRange(data.salesDateFrom, data.salesDateTo);

  return (
    <section className="sales-dashboard-view">
      <div className="sales-report-heading">
        <div>
          <p className="eyebrow">QuickBooks Sales Truth</p>
          <h1>Daily Sales Report</h1>
        </div>
        <div className="sales-report-meta">
          <span>Last Sync</span>
          <strong>{formatDateTime(data.generatedAt)}</strong>
        </div>
      </div>

      {data.unavailableReason ? <div className="status-card error">{data.unavailableReason}</div> : null}

      <div className="sales-kpi-grid sales-kpi-grid-primary">
        <Metric label="Date of Sale" value={salesDateLabel} detail={data.dateBasis} />
        <Metric label="Total Sales" value={currency.format(data.invoiceSales)} detail={data.invoiceCount + " invoices"} />
        <Metric label="Net Sales" value={currency.format(data.netSales)} detail={currency.format(data.creditMemos) + " in credit memos"} tone="strong" />
      </div>

      {data.invoiceCount === 0 && data.creditMemoCount === 0 ? (
        <div className="empty-inline">
          No QuickBooks sales rows are available for this date window yet. Run the Stem Intelligence row in QuickBooks Web Connector once after this deploy.
        </div>
      ) : null}

      <section className="sales-dashboard-panel sales-dashboard-panel-main">
        <div className="panel-heading-row">
          <div>
            <h2>{mode === "rep" ? "Sales By Rep" : "Sales By Account"}</h2>
            <p>Sorted by net sales, highest to lowest.</p>
          </div>
          <div className="segmented-control" aria-label="Summary mode">
            <button className={mode === "rep" ? "active" : ""} onClick={() => setMode("rep")} type="button">
              Rep
            </button>
            <button className={mode === "account" ? "active" : ""} onClick={() => setMode("account")} type="button">
              Account
            </button>
          </div>
        </div>
        <SummaryTable rows={rows} labelHeader={mode === "rep" ? "Rep" : "Account"} />
      </section>

      <section className="sales-dashboard-panel">
        <div className="panel-heading-row">
          <div>
            <h2>Recent QuickBooks Transactions</h2>
            <p>Sample of synced invoice and credit memo headers.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table sales-transaction-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Ref #</th>
                <th>Account</th>
                <th>Rep</th>
                <th className="numeric">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recentTransactions.map((transaction) => (
                <tr key={`${transaction.type}-${transaction.id}`}>
                  <td>{formatDate(transaction.txnDate)}</td>
                  <td>{transaction.type === "credit_memo" ? "Credit Memo" : "Invoice"}</td>
                  <td>{transaction.refNumber || "-"}</td>
                  <td>{transaction.account}</td>
                  <td>{transaction.rep}</td>
                  <td className={transaction.amount < 0 ? "numeric negative" : "numeric"}>{currency.format(transaction.amount)}</td>
                </tr>
              ))}
              {data.recentTransactions.length === 0 ? (
                <tr>
                  <td colSpan={6}>No transactions synced yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "warning" | "strong" }) {
  return (
    <div className={tone ? `sales-kpi sales-kpi-${tone}` : "sales-kpi"}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function SummaryTable({ rows, labelHeader, compact }: { rows: QuickBooksSalesSummaryRow[]; labelHeader: string; compact?: boolean }) {
  return (
    <div className="table-scroll">
      <table className={compact ? "data-table sales-summary-table compact" : "data-table sales-summary-table"}>
        <thead>
          <tr>
            <th>{labelHeader}</th>
            <th className="numeric">Invoice Sales</th>
            <th className="numeric">Credit Memos</th>
            <th className="numeric">Net Sales</th>
            <th className="numeric">Credit %</th>
            {!compact ? <th className="numeric">Docs</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="numeric">{currency.format(row.invoiceSales)}</td>
              <td className="numeric negative">{currency.format(-row.creditMemos)}</td>
              <td className={row.netSales < 0 ? "numeric negative" : "numeric"}>{currency.format(row.netSales)}</td>
              <td className="numeric">{percent.format(row.creditMemoRate)}</td>
              {!compact ? <td className="numeric">{row.invoiceCount} / {row.creditMemoCount}</td> : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={compact ? 5 : 6}>No rows available yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function formatDateRange(from: string | null, to: string | null) {
  if (!from && !to) return "-";
  if (from === to) return formatDate(from);
  return formatDate(from) + " - " + formatDate(to);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
