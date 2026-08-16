import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  QuickBooksSalesDashboardData,
  QuickBooksSalesDashboardFilters,
  QuickBooksSalesLineRow,
  QuickBooksSalesMonthColumn,
  QuickBooksSalesMonthlyRepRow,
  QuickBooksSalesSummaryRow,
  QuickBooksSalesTransactionRow
} from "@/lib/quickbooks-sales-types";

type QuickBooksSalesLineTableRow = {
  txn_id: string;
  item_full_name: string | null;
  description: string | null;
  quantity: number | string | null;
  amount: number | string | null;
};

type QuickBooksSalesSummaryRpcRow = {
  group_type: "overall" | "rep" | "account" | "monthly_rep" | "item";
  label: string | null;
  month_key: string | null;
  document_type: "invoice" | "credit_memo" | "all";
  sales_amount: number | string | null;
  document_count: number | string | null;
};

type QuickBooksSalesTransactionRpcRow = {
  txn_id: string;
  document_type: "invoice" | "credit_memo";
  ref_number: string | null;
  txn_date: string | null;
  account: string | null;
  rep: string | null;
  amount: number | string | null;
};

type MutableSummary = QuickBooksSalesSummaryRow;
type MutableMonthlyRepRow = QuickBooksSalesMonthlyRepRow;

const DEFAULT_HISTORY_FROM = "2025-01-01";
const SALES_DATE_BASIS = "Transaction date; sales subtotal";
const PAGE_SIZE = 1000;
const TXN_ID_CHUNK_SIZE = 400;
const DEFAULT_TRANSACTION_LIMIT = 300;

function getSalesDashboardDeliveryDateRange() {
  const monthToDate = monthToDateRange();
  return {
    from: monthToDate.from,
    to: monthToDate.to
  };
}

function monthToDateRange() {
  const now = new Date();
  return {
    from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
    to: now.toISOString().slice(0, 10)
  };
}

export async function fetchQuickBooksSalesDashboardData(
  supabase: SupabaseClient,
  filters: QuickBooksSalesDashboardFilters = {}
): Promise<QuickBooksSalesDashboardData> {
  const defaultSalesDateRange = getSalesDashboardDeliveryDateRange();
  const salesDateRange = {
    from: filters.dateFrom || defaultSalesDateRange.from,
    to: filters.dateTo || defaultSalesDateRange.to
  };
  const historyFrom = process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_HISTORY_FROM || DEFAULT_HISTORY_FROM;
  const includeTransactions = filters.includeTransactions ?? false;
  const includeItems = filters.includeItems ?? Boolean(filters.item?.trim());
  const monthColumns = buildMonthColumns(salesDateRange);

  const [summaryRows, transactions] = await Promise.all([
    fetchSummaryRows(supabase, salesDateRange, filters, includeItems),
    includeTransactions ? fetchVisibleTransactions(supabase, salesDateRange, filters) : Promise.resolve([])
  ]);
  const summaryData = buildSummaryData(summaryRows, monthColumns);

  return {
    generatedAt: new Date().toISOString(),
    salesDateFrom: salesDateRange.from,
    salesDateTo: salesDateRange.to,
    availableDateFrom: historyFrom,
    availableDateTo: defaultSalesDateRange.to,
    dateBasis: SALES_DATE_BASIS,
    invoiceCount: summaryData.invoiceCount,
    creditMemoCount: summaryData.creditMemoCount,
    invoiceSales: summaryData.invoiceSales,
    creditMemos: summaryData.creditMemos,
    netSales: summaryData.invoiceSales - summaryData.creditMemos,
    lastInvoiceDate: summaryData.lastInvoiceDate,
    lastCreditMemoDate: summaryData.lastCreditMemoDate,
    byRep: sortedSummaries(summaryData.byRep),
    byAccount: sortedSummaries(summaryData.byAccount),
    byItem: includeItems ? sortedSummaries(summaryData.byItem) : [],
    monthColumns,
    byRepMonthly: sortedMonthlyRows(summaryData.byRepMonthly),
    transactions,
    recentTransactions: transactions.slice(0, 50),
    byItemLoaded: includeItems,
    transactionLimit: DEFAULT_TRANSACTION_LIMIT,
    unavailableReason: null
  };
}

export function unavailableQuickBooksSalesDashboardData(reason: string): QuickBooksSalesDashboardData {
  const salesDateRange = getSalesDashboardDeliveryDateRange();
  return {
    generatedAt: new Date().toISOString(),
    salesDateFrom: salesDateRange.from,
    salesDateTo: salesDateRange.to,
    availableDateFrom: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_HISTORY_FROM || DEFAULT_HISTORY_FROM,
    availableDateTo: salesDateRange.to,
    dateBasis: SALES_DATE_BASIS,
    invoiceCount: 0,
    creditMemoCount: 0,
    invoiceSales: 0,
    creditMemos: 0,
    netSales: 0,
    lastInvoiceDate: null,
    lastCreditMemoDate: null,
    byRep: [],
    byAccount: [],
    byItem: [],
    monthColumns: buildMonthColumns(salesDateRange),
    byRepMonthly: [],
    transactions: [],
    recentTransactions: [],
    byItemLoaded: false,
    transactionLimit: DEFAULT_TRANSACTION_LIMIT,
    unavailableReason: reason
  };
}

async function fetchSummaryRows(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  filters: QuickBooksSalesDashboardFilters,
  includeItems: boolean
) {
  const { data, error } = await supabase
    .rpc("quickbooks_sales_dashboard_summary", {
      p_date_from: range.from,
      p_date_to: range.to,
      p_rep: cleanRpcParam(filters.rep === "All" ? undefined : filters.rep),
      p_document_type: filters.documentType || "all",
      p_account: cleanRpcParam(filters.account),
      p_document: cleanRpcParam(filters.document),
      p_item: cleanRpcParam(filters.item),
      p_include_items: includeItems
    })
    .returns<QuickBooksSalesSummaryRpcRow[]>();

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function fetchVisibleTransactions(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  filters: QuickBooksSalesDashboardFilters
) {
  const { data, error } = await supabase
    .rpc("quickbooks_sales_dashboard_transactions", {
      p_date_from: range.from,
      p_date_to: range.to,
      p_rep: cleanRpcParam(filters.rep === "All" ? undefined : filters.rep),
      p_document_type: filters.documentType || "all",
      p_account: cleanRpcParam(filters.account),
      p_document: cleanRpcParam(filters.document),
      p_item: cleanRpcParam(filters.item),
      p_limit: DEFAULT_TRANSACTION_LIMIT
    })
    .returns<QuickBooksSalesTransactionRpcRow[]>();

  if (error) throw new Error(error.message);

  const rows = Array.isArray(data) ? data : [];
  const [invoiceLinesByTxnId, creditMemoLinesByTxnId] = await Promise.all([
    fetchLinesByTxnId(
      supabase,
      "quickbooks_invoice_lines",
      rows.filter((row) => row.document_type === "invoice").map((row) => row.txn_id)
    ),
    fetchLinesByTxnId(
      supabase,
      "quickbooks_credit_memo_lines",
      rows.filter((row) => row.document_type === "credit_memo").map((row) => row.txn_id)
    )
  ]);

  return rows.map<QuickBooksSalesTransactionRow>((row) => {
    const items =
      row.document_type === "invoice"
        ? invoiceLinesByTxnId.get(row.txn_id) || []
        : creditMemoLinesByTxnId.get(row.txn_id) || [];

    return {
      id: row.txn_id,
      type: row.document_type,
      refNumber: row.ref_number,
      txnDate: row.txn_date,
      salesDate: row.txn_date,
      account: cleanLabel(row.account, "Unknown Account"),
      rep: cleanLabel(row.rep, "Unassigned Rep"),
      amount: money(row.amount),
      items
    };
  });
}

async function fetchAll<Row>(fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchLinesByTxnId(supabase: SupabaseClient, table: string, txnIds: string[]) {
  const linesByTxnId = new Map<string, QuickBooksSalesLineRow[]>();
  for (const chunk of chunks(unique(txnIds), TXN_ID_CHUNK_SIZE)) {
    if (chunk.length === 0) continue;
    const rows = await fetchAll<QuickBooksSalesLineTableRow>((from, to) =>
      supabase
        .from(table)
        .select("txn_id,item_full_name,description,quantity,amount")
        .in("txn_id", chunk)
        .order("txn_id", { ascending: true })
        .order("line_sequence", { ascending: true })
        .range(from, to)
        .returns<QuickBooksSalesLineTableRow[]>()
    );

    for (const row of rows) {
      const item = cleanLabel(row.item_full_name || row.description, "Unspecified Item");
      const existing = linesByTxnId.get(row.txn_id) || [];
      existing.push({
        item,
        description: row.description,
        quantity: nullableNumber(row.quantity),
        amount: money(row.amount)
      });
      linesByTxnId.set(row.txn_id, existing);
    }
  }
  return linesByTxnId;
}

function buildSummaryData(rows: QuickBooksSalesSummaryRpcRow[], monthColumns: QuickBooksSalesMonthColumn[]) {
  const data = {
    invoiceSales: 0,
    creditMemos: 0,
    invoiceCount: 0,
    creditMemoCount: 0,
    lastInvoiceDate: null as string | null,
    lastCreditMemoDate: null as string | null,
    byRep: new Map<string, MutableSummary>(),
    byAccount: new Map<string, MutableSummary>(),
    byItem: new Map<string, MutableSummary>(),
    byRepMonthly: new Map<string, MutableMonthlyRepRow>()
  };

  for (const row of rows) {
    const label = cleanLabel(row.label, "Unknown");
    const amount = money(row.sales_amount);
    const count = integer(row.document_count);

    if (row.group_type === "overall") {
      if (row.document_type === "invoice") {
        data.invoiceSales = amount;
        data.invoiceCount = count;
        data.lastInvoiceDate = row.month_key;
      } else if (row.document_type === "credit_memo") {
        data.creditMemos = amount;
        data.creditMemoCount = count;
        data.lastCreditMemoDate = row.month_key;
      }
      continue;
    }

    if (row.group_type === "monthly_rep") {
      if (!row.month_key) continue;
      addMonthlyRepAmount(data.byRepMonthly, monthColumns, label, row.month_key, amount);
      continue;
    }

    const summaries =
      row.group_type === "rep"
        ? data.byRep
        : row.group_type === "account"
          ? data.byAccount
          : data.byItem;
    addSummaryValues(summaryFor(summaries, label), row.document_type, amount, count);
  }

  return data;
}

function summaryFor(map: Map<string, MutableSummary>, label: string) {
  const key = label.toLowerCase();
  const existing = map.get(key);
  if (existing) return existing;
  const created: MutableSummary = {
    key,
    label,
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

function addSummaryValues(summary: MutableSummary, documentType: "invoice" | "credit_memo" | "all", amount: number, count: number) {
  if (documentType === "invoice") {
    summary.invoiceSales += amount;
    summary.netSales += amount;
    summary.invoiceCount += count;
  } else if (documentType === "credit_memo") {
    summary.creditMemos += amount;
    summary.netSales -= amount;
    summary.creditMemoCount += count;
  }
  summary.creditMemoRate = summary.invoiceSales > 0 ? summary.creditMemos / summary.invoiceSales : 0;
}

function sortedSummaries(map: Map<string, MutableSummary>) {
  return Array.from(map.values()).sort((a, b) => Math.abs(b.netSales) - Math.abs(a.netSales));
}

function buildMonthColumns(range: { from: string; to: string }): QuickBooksSalesMonthColumn[] {
  const start = parseDateParts(range.from);
  const end = parseDateParts(range.to);
  if (!start || !end) return [];

  const columns: QuickBooksSalesMonthColumn[] = [];
  let year = start.year;
  let month = start.month;

  while (year < end.year || (year === end.year && month <= end.month)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    columns.push({ key, label: monthColumnLabel(year, month, range) });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return columns;
}

function monthColumnLabel(year: number, month: number, range: { from: string; to: string }) {
  const monthDate = new Date(Date.UTC(year, month - 1, 1));
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "short" }).format(monthDate);
  const start = parseDateParts(range.from);
  const end = parseDateParts(range.to);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isStartMonth = Boolean(start && start.year === year && start.month === month && start.day > 1);
  const isEndMonth = Boolean(end && end.year === year && end.month === month && end.day < lastDay);

  if (isStartMonth || isEndMonth) {
    const fromDay = isStartMonth && start ? start.day : 1;
    const toDay = isEndMonth && end ? end.day : lastDay;
    return `${monthLabel} ${fromDay}-${toDay}`;
  }

  return monthLabel;
}

function parseDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function monthlyRowFor(map: Map<string, MutableMonthlyRepRow>, columns: QuickBooksSalesMonthColumn[], rep: string) {
  const key = rep.toLowerCase();
  const existing = map.get(key);
  if (existing) return existing;

  const created: MutableMonthlyRepRow = {
    key,
    label: rep,
    months: Object.fromEntries(columns.map((column) => [column.key, 0])),
    total: 0
  };
  map.set(key, created);
  return created;
}

function addMonthlyRepAmount(
  map: Map<string, MutableMonthlyRepRow>,
  columns: QuickBooksSalesMonthColumn[],
  rep: string,
  monthKey: string,
  amount: number
) {
  if (!columns.some((column) => column.key === monthKey)) return;
  const row = monthlyRowFor(map, columns, rep);
  row.months[monthKey] = (row.months[monthKey] || 0) + amount;
  row.total += amount;
}

function sortedMonthlyRows(map: Map<string, MutableMonthlyRepRow>) {
  return Array.from(map.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function money(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function integer(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
}

function nullableNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanLabel(value: string | null | undefined, fallback: string) {
  const text = value?.trim();
  return text || fallback;
}

function cleanRpcParam(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
