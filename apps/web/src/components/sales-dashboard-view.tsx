"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  QuickBooksSalesDashboardData,
  QuickBooksSalesDashboardFilters,
  QuickBooksSalesMonthColumn,
  QuickBooksSalesMonthlyRepRow,
  QuickBooksSalesSummaryRow,
  QuickBooksSalesTransactionRow
} from "@/lib/quickbooks-sales-types";

type SalesDashboardViewProps = {
  data: QuickBooksSalesDashboardData;
};

type SummaryMode = "rep" | "account" | "item" | "month";
type DocumentTypeFilter = "all" | "invoice" | "credit_memo";
type LoadSalesDashboardOptions = {
  includeTransactions?: boolean;
  showLoading?: boolean;
};

const MAX_VISIBLE_TRANSACTIONS = 300;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
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
  const [dashboardData, setDashboardData] = useState(data);
  const [mode, setMode] = useState<SummaryMode>("rep");
  const [dateFrom, setDateFrom] = useState(data.salesDateFrom);
  const [dateTo, setDateTo] = useState(data.salesDateTo);
  const [repFilter, setRepFilter] = useState("All");
  const [documentType, setDocumentType] = useState<DocumentTypeFilter>("all");
  const [accountFilter, setAccountFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [documentFilter, setDocumentFilter] = useState("");
  const [appliedItemFilter, setAppliedItemFilter] = useState("");
  const [hasRequestedTransactions, setHasRequestedTransactions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const transactions = dashboardData.transactions || [];
  const repOptions = useMemo(
    () => ["All", ...uniqueSorted([...dashboardData.byRep.map((row) => row.label), ...transactions.map((row) => row.rep)])],
    [dashboardData.byRep, transactions]
  );
  const selectedItem = appliedItemFilter.trim();

  const summaryRows = useMemo(() => {
    if (mode === "rep") return dashboardData.byRep;
    if (mode === "account") return dashboardData.byAccount;
    if (mode === "item") return dashboardData.byItem;
    return [];
  }, [dashboardData.byAccount, dashboardData.byItem, dashboardData.byRep, mode]);
  const metrics = useMemo(() => metricsFromDashboardData(dashboardData), [dashboardData]);
  const visibleTransactions = transactions.slice(0, MAX_VISIBLE_TRANSACTIONS);
  const matchingDocumentCount = dashboardData.invoiceCount + dashboardData.creditMemoCount;
  const hasFilters =
    dateFrom !== data.salesDateFrom ||
    dateTo !== data.salesDateTo ||
    repFilter !== "All" ||
    documentType !== "all" ||
    accountFilter.trim() ||
    itemFilter.trim() ||
    documentFilter.trim();

  useEffect(() => {
    void loadSalesDashboard({}, { includeTransactions: false, showLoading: false });
    // The first screen should refresh from the same API used by drilldowns without loading transaction detail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetFilters() {
    setDateFrom(data.salesDateFrom);
    setDateTo(data.salesDateTo);
    setRepFilter("All");
    setDocumentType("all");
    setAccountFilter("");
    setItemFilter("");
    setDocumentFilter("");
    setAppliedItemFilter("");
    setHasRequestedTransactions(false);
    setMode("rep");
    setErrorMessage("");
    setDashboardData(data);
    void loadSalesDashboard(
      {
        dateFrom: data.salesDateFrom,
        dateTo: data.salesDateTo,
        rep: "All",
        documentType: "all",
        account: "",
        item: "",
        document: ""
      },
      { includeTransactions: false, showLoading: false }
    );
  }

  function setMonthToDate() {
    const range = monthToDateRange();
    setDateFrom(range.from);
    setDateTo(range.to);
    void loadSalesDashboard({ dateFrom: range.from, dateTo: range.to });
  }

  function setYtd() {
    const year = new Date().getFullYear();
    const nextDateFrom = `${year}-01-01`;
    const nextDateTo = data.availableDateTo;
    setDateFrom(nextDateFrom);
    setDateTo(nextDateTo);
    void loadSalesDashboard({ dateFrom: nextDateFrom, dateTo: nextDateTo });
  }

  function setFullYear2025() {
    const nextDateFrom = "2025-01-01";
    const nextDateTo = "2025-12-31";
    setDateFrom(nextDateFrom);
    setDateTo(nextDateTo);
    void loadSalesDashboard({ dateFrom: nextDateFrom, dateTo: nextDateTo });
  }

  function selectMonthlyRepCell(row: QuickBooksSalesMonthlyRepRow, column: QuickBooksSalesMonthColumn) {
    const range = dateRangeForMonth(column.key, {
      from: dashboardData.salesDateFrom,
      to: dashboardData.salesDateTo
    });
    if (!range) return;

    setDateFrom(range.from);
    setDateTo(range.to);
    setRepFilter(row.label);
    setDocumentType("all");
    setAccountFilter("");
    setItemFilter("");
    setDocumentFilter("");
    setAppliedItemFilter("");
    void loadSalesDashboard({
      dateFrom: range.from,
      dateTo: range.to,
      rep: row.label,
      documentType: "all",
      account: "",
      item: "",
      document: ""
    });
  }

  function selectMonthlyRep(row: QuickBooksSalesMonthlyRepRow) {
    selectRep(row.label, dashboardData.salesDateFrom, dashboardData.salesDateTo);
  }

  function selectSummaryRow(row: QuickBooksSalesSummaryRow, nextDocumentType: DocumentTypeFilter = "all") {
    if (mode === "rep") {
      selectRep(row.label, dateFrom, dateTo, nextDocumentType);
      return;
    }

    const nextRep = "All";
    const nextAccount = mode === "account" ? row.label : "";
    const nextItem = mode === "item" ? row.label : "";
    setRepFilter(nextRep);
    setDocumentType(nextDocumentType);
    setAccountFilter(nextAccount);
    setItemFilter(nextItem);
    setDocumentFilter("");
    setAppliedItemFilter(nextItem);
    void loadSalesDashboard({
      dateFrom,
      dateTo,
      rep: nextRep,
      documentType: nextDocumentType,
      account: nextAccount,
      item: nextItem,
      document: ""
    });
  }

  function selectRep(rep: string, nextDateFrom: string, nextDateTo: string, nextDocumentType: DocumentTypeFilter = "all") {
    setDateFrom(nextDateFrom);
    setDateTo(nextDateTo);
    setRepFilter(rep);
    setDocumentType(nextDocumentType);
    setAccountFilter("");
    setItemFilter("");
    setDocumentFilter("");
    setAppliedItemFilter("");
    void loadSalesDashboard({
      dateFrom: nextDateFrom,
      dateTo: nextDateTo,
      rep,
      documentType: nextDocumentType,
      account: "",
      item: "",
      document: ""
    });
  }

  async function loadSalesDashboard(
    overrides: Partial<QuickBooksSalesDashboardFilters> = {},
    options: LoadSalesDashboardOptions = {}
  ) {
    const includeTransactions = options.includeTransactions ?? true;
    const showLoading = options.showLoading ?? true;
    const filters = {
      dateFrom,
      dateTo,
      rep: repFilter,
      documentType,
      account: accountFilter,
      item: itemFilter,
      document: documentFilter,
      ...overrides
    };
    const params = new URLSearchParams();
    params.set("from", filters.dateFrom || data.salesDateFrom);
    params.set("to", filters.dateTo || data.salesDateTo);
    params.set("type", filters.documentType || "all");
    params.set("includeTransactions", includeTransactions ? "true" : "false");
    if (filters.rep && filters.rep !== "All") params.set("rep", filters.rep);
    if (filters.account?.trim()) params.set("account", filters.account.trim());
    if (filters.item?.trim()) params.set("item", filters.item.trim());
    if (filters.document?.trim()) params.set("document", filters.document.trim());

    if (showLoading) setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch(`/api/sales-dashboard?${params.toString()}`);
      const result = (await response.json()) as QuickBooksSalesDashboardData | { error?: string };
      if (!response.ok || "error" in result) {
        throw new Error("error" in result && result.error ? result.error : "Could not load sales.");
      }
      if (!isSalesDashboardData(result)) {
        throw new Error("Could not load sales.");
      }
      setDashboardData(result);
      setAppliedItemFilter(filters.item || "");
      setHasRequestedTransactions(includeTransactions);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load sales.");
    } finally {
      if (showLoading) setIsLoading(false);
    }
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
          <strong>{formatDateTime(dashboardData.generatedAt)}</strong>
        </div>
      </div>

      {data.unavailableReason ? <div className="status-card error">Sales data is not available yet.</div> : null}

      <section className="sales-filter-panel" aria-label="Sales filters">
        <div className="sales-filter-presets">
          <button type="button" onClick={setMonthToDate}>MTD</button>
          <button type="button" onClick={setYtd}>YTD</button>
          <button type="button" onClick={setFullYear2025}>2025</button>
          <button type="button" onClick={() => void loadSalesDashboard()} disabled={isLoading}>{isLoading ? "Loading" : "Apply"}</button>
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

      {errorMessage ? <div className="status-card error">{errorMessage}</div> : null}

      <div className="sales-kpi-grid">
        <Metric label="Net Sales" value={currency.format(metrics.netSales)} detail={`${formatCount(metrics.documentCount)} documents`} tone="strong" />
        <Metric label="Invoice Sales" value={currency.format(metrics.invoiceSales)} detail={`${formatCount(metrics.invoiceCount)} invoices`} />
        <Metric label="Credits" value={currency.format(metrics.creditMemos)} detail={`${formatCount(metrics.creditMemoCount)} credit memos`} tone="warning" />
        <Metric label="Average Invoice" value={currency.format(metrics.averageInvoice)} detail={formatDateRange(dateFrom, dateTo)} />
      </div>

      <section className="sales-dashboard-panel sales-dashboard-panel-main">
        <div className="panel-heading-row">
          <div>
            <h2>{mode === "rep" ? "By Rep" : mode === "account" ? "By Account" : mode === "item" ? "By Item" : "Monthly"}</h2>
            <p>{formatCount(matchingDocumentCount)} matching documents</p>
          </div>
          <div className="segmented-control sales-summary-mode" aria-label="Summary mode">
            <button className={mode === "rep" ? "active" : ""} onClick={() => setMode("rep")} type="button">Rep</button>
            <button className={mode === "account" ? "active" : ""} onClick={() => setMode("account")} type="button">Account</button>
            <button className={mode === "item" ? "active" : ""} onClick={() => setMode("item")} type="button">Item</button>
            <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")} type="button">Monthly</button>
          </div>
        </div>
        {mode === "month" ? (
          <MonthlyRepTable columns={dashboardData.monthColumns} rows={dashboardData.byRepMonthly} onSelectMonth={selectMonthlyRepCell} onSelectRep={selectMonthlyRep} />
        ) : (
          <SummaryTable rows={summaryRows} labelHeader={mode === "rep" ? "Rep" : mode === "account" ? "Account" : "Item"} onSelect={selectSummaryRow} />
        )}
      </section>

      <section className="sales-dashboard-panel">
        <div className="panel-heading-row">
          <div>
            <h2>Transactions</h2>
            <p>
              Showing {formatCount(visibleTransactions.length)}
              {matchingDocumentCount > visibleTransactions.length ? ` of ${formatCount(matchingDocumentCount)}` : ""}
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
                  <td colSpan={7}>{hasRequestedTransactions ? "No sales match these filters." : "No transactions shown."}</td>
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

function isSalesDashboardData(value: QuickBooksSalesDashboardData | { error?: string }): value is QuickBooksSalesDashboardData {
  return "generatedAt" in value && "invoiceSales" in value && "transactions" in value && "monthColumns" in value && "byRepMonthly" in value;
}

function SummaryTable({
  rows,
  labelHeader,
  onSelect
}: {
  rows: QuickBooksSalesSummaryRow[];
  labelHeader: string;
  onSelect: (row: QuickBooksSalesSummaryRow, documentType?: DocumentTypeFilter) => void;
}) {
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
              <td>
                <button type="button" className="sales-table-drilldown sales-row-label" onClick={() => onSelect(row)}>
                  {row.label}
                </button>
              </td>
              <td className="numeric">
                <button type="button" className="sales-table-drilldown sales-amount-cell" onClick={() => onSelect(row, "invoice")}>
                  {preciseCurrency.format(row.invoiceSales)}
                </button>
              </td>
              <td className="numeric negative">
                <button type="button" className="sales-table-drilldown sales-amount-cell negative" onClick={() => onSelect(row, "credit_memo")}>
                  {preciseCurrency.format(row.creditMemos)}
                </button>
              </td>
              <td className={row.netSales < 0 ? "numeric negative" : "numeric"}>
                <button type="button" className={row.netSales < 0 ? "sales-table-drilldown sales-amount-cell negative" : "sales-table-drilldown sales-amount-cell"} onClick={() => onSelect(row)}>
                  {preciseCurrency.format(row.netSales)}
                </button>
              </td>
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

function MonthlyRepTable({
  columns,
  rows,
  onSelectMonth,
  onSelectRep
}: {
  columns: QuickBooksSalesMonthColumn[];
  rows: QuickBooksSalesMonthlyRepRow[];
  onSelectMonth: (row: QuickBooksSalesMonthlyRepRow, column: QuickBooksSalesMonthColumn) => void;
  onSelectRep: (row: QuickBooksSalesMonthlyRepRow) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table sales-monthly-table">
        <thead>
          <tr>
            <th>Rep</th>
            {columns.map((column) => (
              <th key={column.key} className="numeric">{column.label}</th>
            ))}
            <th className="numeric">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <button type="button" className="sales-table-drilldown sales-row-label" onClick={() => onSelectRep(row)}>
                  {row.label}
                </button>
              </td>
              {columns.map((column) => {
                const amount = row.months[column.key] || 0;
                return (
                  <td key={column.key} className="numeric">
                    <button
                      type="button"
                      className={amount < 0 ? "sales-table-drilldown sales-monthly-cell negative" : "sales-table-drilldown sales-monthly-cell"}
                      onClick={() => onSelectMonth(row, column)}
                      aria-label={`${row.label} ${column.label} sales`}
                    >
                      {preciseCurrency.format(amount)}
                    </button>
                  </td>
                );
              })}
              <td className={row.total < 0 ? "numeric negative" : "numeric"}>
                <button type="button" className={row.total < 0 ? "sales-table-drilldown sales-amount-cell negative" : "sales-table-drilldown sales-amount-cell"} onClick={() => onSelectRep(row)}>
                  {preciseCurrency.format(row.total)}
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 2}>No sales match these filters.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function metricsFromDashboardData(data: QuickBooksSalesDashboardData) {
  return {
    invoiceSales: data.invoiceSales,
    creditMemos: data.creditMemos,
    netSales: data.netSales,
    invoiceCount: data.invoiceCount,
    creditMemoCount: data.creditMemoCount,
    documentCount: data.invoiceCount + data.creditMemoCount,
    averageInvoice: data.invoiceCount > 0 ? data.invoiceSales / data.invoiceCount : 0
  };
}

function dateRangeForMonth(key: string, containingRange: { from: string; to: string }) {
  const [yearText, monthText] = key.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;

  const monthFrom = `${key}-01`;
  const monthTo = `${key}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;

  return {
    from: monthFrom > containingRange.from ? monthFrom : containingRange.from,
    to: monthTo < containingRange.to ? monthTo : containingRange.to
  };
}

function monthToDateRange() {
  const now = new Date();
  return {
    from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
    to: now.toISOString().slice(0, 10)
  };
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
