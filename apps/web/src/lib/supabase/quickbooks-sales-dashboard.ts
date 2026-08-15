import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  QuickBooksSalesDashboardData,
  QuickBooksSalesDashboardFilters,
  QuickBooksSalesLineRow,
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

const DEFAULT_HISTORY_FROM = "2025-01-01";
const DEFAULT_SALES_DELIVERY_FROM = `${new Date().getFullYear()}-01-01`;
const DEFAULT_SALES_DELIVERY_TO = new Date().toISOString().slice(0, 10);
const SALES_DATE_BASIS = "Invoice delivery date; credit memo date";
const PAGE_SIZE = 1000;
const TXN_ID_CHUNK_SIZE = 400;
const DEFAULT_TRANSACTION_LIMIT = 300;

function getSalesDashboardDeliveryDateRange() {
  return {
    from: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_DEFAULT_FROM || DEFAULT_SALES_DELIVERY_FROM,
    to: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_DEFAULT_TO || DEFAULT_SALES_DELIVERY_TO
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
        .or(`ship_date.gte.${salesDateRange.from},txn_date.gte.${salesDateRange.from}`)
        .order("txn_date", { ascending: false, nullsFirst: false })
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
        .range(from, to)
        .returns<QuickBooksCreditMemoRow[]>()
    )
  ]);

  const invoices = invoiceRows.filter((row) => dateInRange(invoiceDeliveryDate(row), salesDateRange));
  const creditMemos = creditMemoRows.filter((row) => dateInRange(row.txn_date, salesDateRange));
  const [invoiceLinesByTxnId, creditMemoLinesByTxnId] = await Promise.all([
    shouldLoadLines ? fetchLinesByTxnId(supabase, "quickbooks_invoice_lines", invoices.map((row) => row.txn_id)) : Promise.resolve(new Map<string, QuickBooksSalesLineRow[]>()),
    shouldLoadLines ? fetchLinesByTxnId(supabase, "quickbooks_credit_memo_lines", creditMemos.map((row) => row.txn_id)) : Promise.resolve(new Map<string, QuickBooksSalesLineRow[]>())
  ]);
  const byRep = new Map<string, MutableSummary>();
  const byAccount = new Map<string, MutableSummary>();
  const byItem = new Map<string, MutableSummary>();
  const transactions: QuickBooksSalesTransactionRow[] = [];

  for (const invoice of invoices) {
    const amount = money(invoice.total_amount ?? invoice.subtotal);
    const rep = refName(invoice.sales_rep_ref) || "Unassigned Rep";
    const account = cleanLabel(invoice.customer_full_name, "Unknown Account");
    const salesDate = invoiceDeliveryDate(invoice);
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
      addInvoice(summaryFor(byRep, rep), amount);
      addInvoice(summaryFor(byAccount, account), amount);
      addItemSummary(byItem, items, amount, "invoice", filters.item);
    }
  }

  for (const creditMemo of creditMemos) {
    const amount = Math.abs(money(creditMemo.total_amount ?? creditMemo.subtotal));
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
      addCredit(summaryFor(byRep, rep), amount);
      addCredit(summaryFor(byAccount, account), amount);
      addItemSummary(byItem, items, amount, "credit_memo", filters.item);
    }
  }

  const matchingTransactions = transactions.filter((row) => matchesItemFilter(row.items, filters.item));
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
    lastInvoiceDate: latestDate(invoices.map((row) => invoiceDeliveryDate(row))),
    lastCreditMemoDate: latestDate(creditMemos.map((row) => row.txn_date)),
    byRep: sortedSummaries(byRep),
    byAccount: sortedSummaries(byAccount),
    byItem: sortedSummaries(byItem),
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

function invoiceDeliveryDate(row: QuickBooksInvoiceRow) {
  return row.ship_date || row.txn_date;
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
