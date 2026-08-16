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

type QuickBooksInvoiceRow = {
  txn_id: string;
  ref_number: string | null;
  txn_date: string | null;
  ship_date: string | null;
  customer_full_name: string | null;
  sales_rep_ref: Record<string, unknown> | null;
  subtotal: number | string | null;
  total_amount: number | string | null;
  balance_remaining: number | string | null;
  is_paid: boolean | null;
  time_modified: string | null;
  last_seen_at: string | null;
};

type QuickBooksCreditMemoRow = {
  txn_id: string;
  ref_number: string | null;
  txn_date: string | null;
  customer_full_name: string | null;
  subtotal: number | string | null;
  total_amount: number | string | null;
  raw_data: Record<string, unknown> | null;
  time_modified: string | null;
  last_seen_at: string | null;
};

type QuickBooksSalesLineTableRow = {
  txn_id: string;
  item_full_name: string | null;
  description: string | null;
  quantity: number | string | null;
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
  const historyTo = salesDateRange.to;
  const includeTransactions = filters.includeTransactions ?? false;
  const shouldLoadLines = includeTransactions || Boolean(filters.item?.trim());
  const [invoiceRows, creditMemoRows] = await Promise.all([
    fetchAll<QuickBooksInvoiceRow>((from, to) =>
      supabase
        .from("quickbooks_invoices")
        .select("txn_id,ref_number,txn_date,ship_date,customer_full_name,sales_rep_ref,subtotal,total_amount,balance_remaining,is_paid,time_modified,last_seen_at")
        .gte("txn_date", salesDateRange.from)
        .lte("txn_date", salesDateRange.to)
        .order("txn_date", { ascending: false, nullsFirst: false })
        .order("txn_id", { ascending: false })
        .range(from, to)
        .returns<QuickBooksInvoiceRow[]>()
    ),
    fetchAll<QuickBooksCreditMemoRow>((from, to) =>
      supabase
        .from("quickbooks_credit_memos")
        .select("txn_id,ref_number,txn_date,customer_full_name,subtotal,total_amount,raw_data,time_modified,last_seen_at")
        .gte("txn_date", salesDateRange.from)
        .lte("txn_date", salesDateRange.to)
        .order("txn_date", { ascending: false, nullsFirst: false })
        .order("txn_id", { ascending: false })
        .range(from, to)
        .returns<QuickBooksCreditMemoRow[]>()
    )
  ]);

  const invoices = invoiceRows.filter((row) => dateInRange(row.txn_date, salesDateRange));
  const creditMemos = creditMemoRows.filter((row) => dateInRange(row.txn_date, salesDateRange));
  const [invoiceLinesByTxnId, creditMemoLinesByTxnId] = await Promise.all([
    shouldLoadLines ? fetchLinesByTxnId(supabase, "quickbooks_invoice_lines", invoices.map((row) => row.txn_id)) : Promise.resolve(new Map<string, QuickBooksSalesLineRow[]>()),
    shouldLoadLines ? fetchLinesByTxnId(supabase, "quickbooks_credit_memo_lines", creditMemos.map((row) => row.txn_id)) : Promise.resolve(new Map<string, QuickBooksSalesLineRow[]>())
  ]);
  const byItem = new Map<string, MutableSummary>();
  const monthColumns = buildMonthColumns(salesDateRange);
  const transactions: QuickBooksSalesTransactionRow[] = [];

  for (const invoice of invoices) {
    const amount = money(invoice.subtotal ?? invoice.total_amount);
    const rep = refName(invoice.sales_rep_ref) || "Unassigned Rep";
    const account = cleanLabel(invoice.customer_full_name, "Unknown Account");
    const salesDate = invoice.txn_date;
    const items = invoiceLinesByTxnId.get(invoice.txn_id) || [];
    if (!matchesHeaderFilters({ type: "invoice", refNumber: invoice.ref_number, account, rep }, filters)) continue;
    transactions.push({
      id: invoice.txn_id,
      type: "invoice",
      refNumber: invoice.ref_number,
      txnDate: invoice.txn_date,
      salesDate,
      account,
      rep,
      amount,
      items
    });
    if (matchesItemFilter(items, filters.item)) {
      addItemSummary(byItem, items, amount, "invoice", filters.item);
    }
  }

  for (const creditMemo of creditMemos) {
    const amount = Math.abs(money(creditMemo.subtotal ?? creditMemo.total_amount));
    const rep = creditMemoRepName(creditMemo.raw_data) || "Unassigned Rep";
    const account = cleanLabel(creditMemo.customer_full_name, "Unknown Account");
    const items = creditMemoLinesByTxnId.get(creditMemo.txn_id) || [];
    if (!matchesHeaderFilters({ type: "credit_memo", refNumber: creditMemo.ref_number, account, rep }, filters)) continue;
    transactions.push({
      id: creditMemo.txn_id,
      type: "credit_memo",
      refNumber: creditMemo.ref_number,
      txnDate: creditMemo.txn_date,
      salesDate: creditMemo.txn_date,
      account,
      rep,
      amount: -amount,
      items
    });
    if (matchesItemFilter(items, filters.item)) {
      addItemSummary(byItem, items, amount, "credit_memo", filters.item);
    }
  }

  const matchingTransactions = transactions.filter((row) => matchesItemFilter(row.items, filters.item));
  const byRep = buildTransactionSummaries(matchingTransactions, (transaction) => transaction.rep);
  const byAccount = buildTransactionSummaries(matchingTransactions, (transaction) => transaction.account);
  const byRepMonthly = buildMonthlyRepRows(matchingTransactions, monthColumns);
  const invoiceSales = matchingTransactions
    .filter((row) => row.type === "invoice")
    .reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const creditMemoTotal = matchingTransactions
    .filter((row) => row.type === "credit_memo")
    .reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const sortedTransactions = matchingTransactions.sort((a, b) => (b.salesDate || "").localeCompare(a.salesDate || ""));
  const visibleTransactions = includeTransactions ? sortedTransactions.slice(0, DEFAULT_TRANSACTION_LIMIT) : [];

  return {
    generatedAt: new Date().toISOString(),
    salesDateFrom: salesDateRange.from,
    salesDateTo: salesDateRange.to,
    availableDateFrom: historyFrom,
    availableDateTo: historyTo,
    dateBasis: SALES_DATE_BASIS,
    invoiceCount: matchingTransactions.filter((row) => row.type === "invoice").length,
    creditMemoCount: matchingTransactions.filter((row) => row.type === "credit_memo").length,
    invoiceSales,
    creditMemos: creditMemoTotal,
    netSales: invoiceSales - creditMemoTotal,
    lastInvoiceDate: latestDate(invoices.map((row) => row.txn_date)),
    lastCreditMemoDate: latestDate(creditMemos.map((row) => row.txn_date)),
    byRep: sortedSummaries(byRep),
    byAccount: sortedSummaries(byAccount),
    byItem: sortedSummaries(byItem),
    monthColumns,
    byRepMonthly,
    transactions: visibleTransactions,
    recentTransactions: visibleTransactions.slice(0, 50),
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
    unavailableReason: reason
  };
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

function matchesHeaderFilters(
  transaction: { type: "invoice" | "credit_memo"; refNumber: string | null; account: string; rep: string },
  filters: QuickBooksSalesDashboardFilters
) {
  if (filters.documentType && filters.documentType !== "all" && transaction.type !== filters.documentType) return false;
  if (filters.rep && filters.rep !== "All" && transaction.rep !== filters.rep) return false;
  if (filters.account?.trim() && !includesText(transaction.account, filters.account)) return false;
  if (filters.document?.trim() && !includesText(transaction.refNumber || "", filters.document)) return false;
  return true;
}

function matchesItemFilter(items: QuickBooksSalesLineRow[], itemFilter: string | undefined) {
  if (!itemFilter?.trim()) return true;
  return items.some((line) => includesText(line.item, itemFilter) || includesText(line.description || "", itemFilter));
}

function includesText(value: string, search: string) {
  return value.trim().toLowerCase().includes(search.trim().toLowerCase());
}

function dateInRange(value: string | null | undefined, range: { from: string; to: string }) {
  return Boolean(value && value >= range.from && value <= range.to);
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

function addInvoice(summary: MutableSummary, amount: number) {
  summary.invoiceSales += amount;
  summary.netSales += amount;
  summary.invoiceCount += 1;
  updateCreditRate(summary);
}

function addCredit(summary: MutableSummary, amount: number) {
  summary.creditMemos += amount;
  summary.netSales -= amount;
  summary.creditMemoCount += 1;
  updateCreditRate(summary);
}

function addItemSummary(
  map: Map<string, MutableSummary>,
  items: QuickBooksSalesLineRow[],
  transactionAmount: number,
  type: "invoice" | "credit_memo",
  itemFilter: string | undefined
) {
  const matchingItems = itemFilter?.trim()
    ? items.filter((line) => includesText(line.item, itemFilter) || includesText(line.description || "", itemFilter))
    : items;

  if (matchingItems.length === 0) {
    const summary = summaryFor(map, "Unspecified Item");
    if (type === "credit_memo") addCredit(summary, Math.abs(transactionAmount));
    else addInvoice(summary, Math.abs(transactionAmount));
    return;
  }

  for (const item of matchingItems) {
    const amount = Math.abs(item.amount);
    const summary = summaryFor(map, item.item);
    if (type === "credit_memo") addCredit(summary, amount);
    else addInvoice(summary, amount);
  }
}

function updateCreditRate(summary: MutableSummary) {
  summary.creditMemoRate = summary.invoiceSales > 0 ? summary.creditMemos / summary.invoiceSales : 0;
}

function sortedSummaries(map: Map<string, MutableSummary>) {
  return Array.from(map.values()).sort((a, b) => Math.abs(b.netSales) - Math.abs(a.netSales));
}

function buildTransactionSummaries(
  transactions: QuickBooksSalesTransactionRow[],
  labelForTransaction: (transaction: QuickBooksSalesTransactionRow) => string
) {
  const summaries = new Map<string, MutableSummary>();
  for (const transaction of transactions) {
    const summary = summaryFor(summaries, labelForTransaction(transaction));
    if (transaction.type === "credit_memo") addCredit(summary, Math.abs(transaction.amount));
    else addInvoice(summary, Math.max(0, transaction.amount));
  }
  return summaries;
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

function monthKey(value: string | null | undefined) {
  return value ? value.slice(0, 7) : null;
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
  date: string | null | undefined,
  amount: number
) {
  const key = monthKey(date);
  if (!key || !columns.some((column) => column.key === key)) return;
  const row = monthlyRowFor(map, columns, rep);
  row.months[key] = (row.months[key] || 0) + amount;
  row.total += amount;
}

function buildMonthlyRepRows(transactions: QuickBooksSalesTransactionRow[], columns: QuickBooksSalesMonthColumn[]) {
  const rows = new Map<string, MutableMonthlyRepRow>();
  for (const transaction of transactions) {
    addMonthlyRepAmount(rows, columns, transaction.rep, transaction.salesDate || transaction.txnDate, transaction.amount);
  }
  return sortedMonthlyRows(rows);
}

function sortedMonthlyRows(map: Map<string, MutableMonthlyRepRow>) {
  return Array.from(map.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function money(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function nullableNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanLabel(value: string | null | undefined, fallback: string) {
  const text = value?.trim();
  return text || fallback;
}

function refName(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  return (
    stringValue(value.ResolvedFullName) ||
    stringValue(value.SalesRepEntityFullName) ||
    stringValue(value.resolvedFullName) ||
    stringValue(value.FullName) ||
    stringValue(value.fullName) ||
    stringValue(value.Name) ||
    stringValue(value.name)
  );
}

function creditMemoRepName(rawData: Record<string, unknown> | null | undefined) {
  const salesRepRef = rawData?.sales_rep_ref;
  return typeof salesRepRef === "object" && salesRepRef ? refName(salesRepRef as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function latestDate(values: Array<string | null>) {
  return values.filter(Boolean).sort().at(-1) || null;
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
