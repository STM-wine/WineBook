"use client";

import { useMemo, useState } from "react";
import type {
  QuickBooksSalesDashboardData,
  QuickBooksSalesSummaryRow,
  QuickBooksSalesTransactionRow
} from "@/lib/quickbooks-sales-types";

type SalesDashboardViewProps = {
  data: QuickBooksSalesDashboardData;
};

type SummaryMode = "rep" | "account" | "item";
type DocumentTypeFilter = "all" | "invoice" | "credit_memo";

const MAX_VISIBLE_TRANSACTIONS = 300;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const preciseCurrency = new Intl.NumberFormat("en-US", {
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
  const transactions = data.transactions?.length ? data.transactions : data.recentTransactions;
  const [mode, setMode] = useState<SummaryMode>("rep");
  const [dateFrom, setDateFrom] = useState(data.salesDateFrom);
  const [dateTo, setDateTo] = useState(data.salesDateTo);
  const [repFilter, setRepFilter] = useState("All");
  const [documentType, setDocumentType] = useState<DocumentTypeFilter>("all");
  const [accountFilter, setAccountFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [documentFilter, setDocumentFilter] = useState("");

  const repOptions = useMemo(() => ["All", ...uniqueSorted(transactions.map((row) => row.rep))], [transactions]);
  const selectedItem = itemFilter.trim();

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((transaction) =>
        transactionMatches(transaction, {
          dateFrom,
          dateTo,
          repFilter,
          documentType,
          accountFilter,
          itemFilter,
          documentFilter
        })
      ),
    [accountFilter, dateFrom, dateTo, documentFilter, documentType, itemFilter, repFilter, transactions]
  );

  const summaryRows = useMemo(
    () => buildSummaryRows(filteredTransactions, mode, selectedItem),
    [filteredTransactions, mode, selectedItem]
  );
  const metrics = useMemo(
    () => buildMetrics(filteredTransactions, selectedItem),
    [filteredTransactions, selectedItem]
  );
  const visibleTransactions = filteredTransactions.slice(0, MAX_VISIBLE_TRANSACTIONS);
  const hasFilters =
    dateFrom !== data.salesDateFrom ||
    dateTo !== data.salesDateTo ||
    repFilter !== "All" ||
    documentType !== "all" ||
    accountFilter.trim() ||
    itemFilter.trim() ||
    documentFilter.trim();

  function resetFilters() {
    setDateFrom(data.salesDateFrom);
    setDateTo(data.salesDateTo);
    setRepFilter("All");
    setDocumentType("all");
    setAccountFilter("");
    setItemFilter("");
    setDocumentFilter("");
    setMode("rep");
  }

  function setYtd() {
    const year = new Date().getFullYear();
    setDateFrom(`${year}-01-01`);
    setDateTo(data.availableDateTo);
  }

  function setFullYear2025() {
    setDateFrom("2025-01-01");
    setDateTo("2025-12-31");
  }

  return (
    <section className="sales-dashboard-view">
      <div className="sales-report-heading">
        <div>
          <p className="eyebrow">Stem Intelligence</p>
          <h1>Sales Dashboard</h1>
        </div>
        <div className="sales-report-meta">
          <span>Last Updated</span>
          <strong>{formatDateTime(data.generatedAt)}</strong>
        </div>
      </div>

      {data.unavailableReason ? <div className="status-card error">Sales data is not available yet.</div> : null}

      <section className="sales-filter-panel" aria-label="Sales filters">
        <div className="sales-filter-presets">
          <button type="button" onClick={setYtd}>YTD</button>
          <button type="button" onClick={setFullYear2025}>2025</button>
          <button type="button" onClick={resetFilters} disabled={!hasFilters}>Reset</button>
        </div>
        <div className="sales-filter-grid">
          <label>
            From
            <input type="date" value={dateFrom} min={data.availableDateFrom} max={data.availableDateTo} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={dateTo} min={data.availableDateFrom} max={data.availableDateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label>
            Rep
            <select value={repFilter} onChange={(event) => setRepFilter(event.target.value)}>
              {repOptions.map((rep) => (
                <option key={rep} value={rep}>{rep}</option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentTypeFilter)}>
              <option value="all">All</option>
              <option value="invoice">Invoices</option>
              <option value="credit_memo">Credit Memos</option>
            </select>
          </label>
          <label>
            Account
            <input value={accountFilter} placeholder="Account name" onChange={(event) => setAccountFilter(event.target.value)} />
          </label>
          <label>
            Item
            <input value={itemFilter} placeholder="Item name" onChange={(event) => setItemFilter(event.target.value)} />
          </label>
          <label>
            Invoice / Credit Memo
            <input value={documentFilter} placeholder="Document number" onChange={(event) => setDocumentFilter(event.target.value)} />
          </label>
        </div>
      </section>

      <div className="sales-kpi-grid">
        <Metric label="Net Sales" value={currency.format(metrics.netSales)} detail={`${formatCount(metrics.documentCount)} documents`} tone="strong" />
        <Metric label="Invoice Sales" value={currency.format(metrics.invoiceSales)} detail={`${formatCount(metrics.invoiceCount)} invoices`} />
        <Metric label="Credits" value={currency.format(metrics.creditMemos)} detail={`${formatCount(metrics.creditMemoCount)} credit memos`} tone="warning" />
        <Metric label="Average Invoice" value={currency.format(metrics.averageInvoice)} detail={formatDateRange(dateFrom, dateTo)} />
      </div>

      <section className="sales-dashboard-panel sales-dashboard-panel-main">
        <div className="panel-heading-row">
          <div>
            <h2>{mode === "rep" ? "By Rep" : mode === "account" ? "By Account" : "By Item"}</h2>
            <p>{formatCount(filteredTransactions.length)} matching documents</p>
          </div>
          <div className="segmented-control sales-summary-mode" aria-label="Summary mode">
            <button className={mode === "rep" ? "active" : ""} onClick={() => setMode("rep")} type="button">Rep</button>
            <button className={mode === "account" ? "active" : ""} onClick={() => setMode("account")} type="button">Account</button>
            <button className={mode === "item" ? "active" : ""} onClick={() => setMode("item")} type="button">Item</button>
          </div>
        </div>
        <SummaryTable rows={summaryRows} labelHeader={mode === "rep" ? "Rep" : mode === "account" ? "Account" : "Item"} />
      </section>

      <section className="sales-dashboard-panel">
        <div className="panel-heading-row">
          <div>
            <h2>Transactions</h2>
            <p>
              Showing {formatCount(visibleTransactions.length)}
              {filteredTransactions.length > visibleTransactions.length ? ` of ${formatCount(filteredTransactions.length)}` : ""}
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table sales-transaction-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Number</th>
                <th>Account</th>
                <th>Rep</th>
                <th>Items</th>
                <th className="numeric">Sales</th>
              </tr>
            </thead>
            <tbody>
              {visibleTransactions.map((transaction) => {
                const displayAmount = amountForTransaction(transaction, selectedItem);
                return (
                  <tr key={`${transaction.type}-${transaction.id}`}>
                    <td>{formatDate(transaction.salesDate || transaction.txnDate)}</td>
                    <td>{documentTypeLabel(transaction.type)}</td>
                    <td>{transaction.refNumber || "-"}</td>
                    <td>{transaction.account}</td>
                    <td>{transaction.rep}</td>
                    <td>{formatItems(transaction.items)}</td>
                    <td className={displayAmount < 0 ? "numeric negative" : "numeric"}>{preciseCurrency.format(displayAmount)}</td>
                  </tr>
                );
              })}
              {visibleTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7}>No sales match these filters.</td>
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

function SummaryTable({ rows, labelHeader }: { rows: QuickBooksSalesSummaryRow[]; labelHeader: string }) {
  return (
    <div className="table-scroll">
      <table className="data-table sales-summary-table">
        <thead>
          <tr>
            <th>{labelHeader}</th>
            <th className="numeric">Invoice Sales</th>
            <th className="numeric">Credits</th>
            <th className="numeric">Net Sales</th>
            <th className="numeric">Credit %</th>
            <th className="numeric">Docs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="numeric">{preciseCurrency.format(row.invoiceSales)}</td>
              <td className="numeric negative">{preciseCurrency.format(row.creditMemos)}</td>
              <td className={row.netSales < 0 ? "numeric negative" : "numeric"}>{preciseCurrency.format(row.netSales)}</td>
              <td className="numeric">{percent.format(row.creditMemoRate)}</td>
              <td className="numeric">{formatCount(row.invoiceCount + row.creditMemoCount)}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>No sales match these filters.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function transactionMatches(
  transaction: QuickBooksSalesTransactionRow,
  filters: {
    dateFrom: string;
    dateTo: string;
    repFilter: string;
    documentType: DocumentTypeFilter;
    accountFilter: string;
    itemFilter: string;
    documentFilter: string;
  }
) {
  const salesDate = transaction.salesDate || transaction.txnDate || "";
  if (filters.dateFrom && salesDate < filters.dateFrom) return false;
  if (filters.dateTo && salesDate > filters.dateTo) return false;
  if (filters.repFilter !== "All" && transaction.rep !== filters.repFilter) return false;
  if (filters.documentType !== "all" && transaction.type !== filters.documentType) return false;
  if (filters.accountFilter.trim() && !includesText(transaction.account, filters.accountFilter)) return false;
  if (filters.documentFilter.trim() && !includesText(transaction.refNumber || "", filters.documentFilter)) return false;
  if (filters.itemFilter.trim()) {
    return transaction.items.some((line) => includesText(line.item, filters.itemFilter) || includesText(line.description || "", filters.itemFilter));
  }
  return true;
}

function buildMetrics(transactions: QuickBooksSalesTransactionRow[], selectedItem: string) {
  return transactions.reduce(
    (metrics, transaction) => {
      const amount = amountForTransaction(transaction, selectedItem);
      if (transaction.type === "credit_memo") {
        metrics.creditMemos += Math.abs(amount);
        metrics.creditMemoCount += 1;
      } else {
        metrics.invoiceSales += Math.max(0, amount);
        metrics.invoiceCount += 1;
      }
      metrics.netSales += amount;
      metrics.documentCount += 1;
      metrics.averageInvoice = metrics.invoiceCount > 0 ? metrics.invoiceSales / metrics.invoiceCount : 0;
      return metrics;
    },
    {
      invoiceSales: 0,
      creditMemos: 0,
      netSales: 0,
      invoiceCount: 0,
      creditMemoCount: 0,
      documentCount: 0,
      averageInvoice: 0
    }
  );
}

function buildSummaryRows(transactions: QuickBooksSalesTransactionRow[], mode: SummaryMode, selectedItem: string) {
  const summaries = new Map<string, QuickBooksSalesSummaryRow>();

  for (const transaction of transactions) {
    if (mode === "item") {
      const lines = matchingLines(transaction, selectedItem);
      if (lines.length === 0) {
        addSignedAmount(summaryFor(summaries, "Unspecified Item"), transaction.amount, transaction.type);
      } else {
        for (const line of lines) {
          const amount = transaction.type === "credit_memo" ? -Math.abs(line.amount) : Math.max(0, line.amount);
          addSignedAmount(summaryFor(summaries, line.item), amount, transaction.type);
        }
      }
    } else {
      const label = mode === "rep" ? transaction.rep : transaction.account;
      addSignedAmount(summaryFor(summaries, label), amountForTransaction(transaction, selectedItem), transaction.type);
    }
  }

  return Array.from(summaries.values()).sort((a, b) => b.netSales - a.netSales);
}

function summaryFor(map: Map<string, QuickBooksSalesSummaryRow>, label: string) {
  const cleanLabel = label.trim() || "Unknown";
  const key = normalize(cleanLabel);
  const existing = map.get(key);
  if (existing) return existing;
  const created: QuickBooksSalesSummaryRow = {
    key,
    label: cleanLabel,
    invoiceSales: 0,
    creditMemos: 0,
    netSales: 0,
    invoiceCount: 0,
    creditMemoCount: 0,
    creditMemoRate: 0
  };
  map.set(key, created);
  return created;
}

function addSignedAmount(summary: QuickBooksSalesSummaryRow, amount: number, type: "invoice" | "credit_memo") {
  if (type === "credit_memo" || amount < 0) {
    summary.creditMemos += Math.abs(amount);
    summary.creditMemoCount += 1;
  } else {
    summary.invoiceSales += Math.max(0, amount);
    summary.invoiceCount += 1;
  }
  summary.netSales += amount;
  summary.creditMemoRate = summary.invoiceSales > 0 ? summary.creditMemos / summary.invoiceSales : 0;
}

function amountForTransaction(transaction: QuickBooksSalesTransactionRow, selectedItem: string) {
  const lines = matchingLines(transaction, selectedItem);
  if (!selectedItem || lines.length === 0) return transaction.amount;
  const lineAmount = lines.reduce((sum, line) => sum + Math.abs(line.amount), 0);
  return transaction.type === "credit_memo" ? -lineAmount : lineAmount;
}

function matchingLines(transaction: QuickBooksSalesTransactionRow, selectedItem: string) {
  if (!selectedItem) return transaction.items;
  return transaction.items.filter((line) => includesText(line.item, selectedItem) || includesText(line.description || "", selectedItem));
}

function includesText(value: string, search: string) {
  return normalize(value).includes(normalize(search));
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function formatItems(items: QuickBooksSalesTransactionRow["items"]) {
  const names = uniqueSorted(items.map((item) => item.item));
  if (names.length === 0) return "-";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
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

function documentTypeLabel(value: "invoice" | "credit_memo") {
  return value === "credit_memo" ? "Credit Memo" : "Invoice";
}

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}
