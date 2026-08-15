import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  QuickBooksSalesDashboardData,
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

function getSalesDashboardDeliveryDateRange() {
  return {
    from: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_DEFAULT_FROM || DEFAULT_SALES_DELIVERY_FROM,
    to: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_DEFAULT_TO || DEFAULT_SALES_DELIVERY_TO
  };
}

export async function fetchQuickBooksSalesDashboardData(supabase: SupabaseClient): Promise<QuickBooksSalesDashboardData> {
  const salesDateRange = getSalesDashboardDeliveryDateRange();
  const historyFrom = process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_HISTORY_FROM || DEFAULT_HISTORY_FROM;
  const historyTo = salesDateRange.to;
  const [invoiceRows, creditMemoRows] = await Promise.all([
    fetchAll<QuickBooksInvoiceRow>((from, to) =>
      supabase
        .from("quickbooks_invoices")
        .select("txn_id,ref_number,txn_date,ship_date,customer_full_name,sales_rep_ref,subtotal,total_amount,balance_remaining,is_paid,time_modified,last_seen_at")
        .or(`ship_date.gte.${historyFrom},txn_date.gte.${historyFrom}`)
        .order("txn_date", { ascending: false, nullsFirst: false })
        .range(from, to)
        .returns<QuickBooksInvoiceRow[]>()
    ),
    fetchAll<QuickBooksCreditMemoRow>((from, to) =>
      supabase
        .from("quickbooks_credit_memos")
        .select("txn_id,ref_number,txn_date,customer_full_name,subtotal,total_amount,raw_data,time_modified,last_seen_at")
        .gte("txn_date", historyFrom)
        .order("txn_date", { ascending: false, nullsFirst: false })
        .range(from, to)
        .returns<QuickBooksCreditMemoRow[]>()
    )
  ]);

  const invoices = invoiceRows.filter((row) => dateInRange(invoiceDeliveryDate(row), { from: historyFrom, to: historyTo }));
  const creditMemos = creditMemoRows.filter((row) => dateInRange(row.txn_date, { from: historyFrom, to: historyTo }));
  const [invoiceLinesByTxnId, creditMemoLinesByTxnId] = await Promise.all([
    fetchLinesByTxnId(supabase, "quickbooks_invoice_lines", invoices.map((row) => row.txn_id)),
    fetchLinesByTxnId(supabase, "quickbooks_credit_memo_lines", creditMemos.map((row) => row.txn_id))
  ]);
  const byRep = new Map<string, MutableSummary>();
  const byAccount = new Map<string, MutableSummary>();
  const transactions: QuickBooksSalesTransactionRow[] = [];

  for (const invoice of invoices) {
    const amount = money(invoice.total_amount ?? invoice.subtotal);
    const rep = refName(invoice.sales_rep_ref) || "Unassigned Rep";
    const account = cleanLabel(invoice.customer_full_name, "Unknown Account");
    const salesDate = invoiceDeliveryDate(invoice);
    const items = invoiceLinesByTxnId.get(invoice.txn_id) || [];
    if (dateInRange(salesDate, salesDateRange)) {
      addInvoice(summaryFor(byRep, rep), amount);
      addInvoice(summaryFor(byAccount, account), amount);
    }
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
  }

  for (const creditMemo of creditMemos) {
    const amount = Math.abs(money(creditMemo.total_amount ?? creditMemo.subtotal));
    const rep = creditMemoRepName(creditMemo.raw_data) || "Unassigned Rep";
    const account = cleanLabel(creditMemo.customer_full_name, "Unknown Account");
    const items = creditMemoLinesByTxnId.get(creditMemo.txn_id) || [];
    if (dateInRange(creditMemo.txn_date, salesDateRange)) {
      addCredit(summaryFor(byRep, rep), amount);
      addCredit(summaryFor(byAccount, account), amount);
    }
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
  }

  const defaultTransactions = transactions.filter((row) => dateInRange(row.salesDate, salesDateRange));
  const invoiceSales = defaultTransactions
    .filter((row) => row.type === "invoice")
    .reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const creditMemoTotal = defaultTransactions
    .filter((row) => row.type === "credit_memo")
    .reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const sortedTransactions = transactions.sort((a, b) => (b.salesDate || "").localeCompare(a.salesDate || ""));

  return {
    generatedAt: new Date().toISOString(),
    salesDateFrom: salesDateRange.from,
    salesDateTo: salesDateRange.to,
    availableDateFrom: historyFrom,
    availableDateTo: historyTo,
    dateBasis: SALES_DATE_BASIS,
    invoiceCount: defaultTransactions.filter((row) => row.type === "invoice").length,
    creditMemoCount: defaultTransactions.filter((row) => row.type === "credit_memo").length,
    invoiceSales,
    creditMemos: creditMemoTotal,
    netSales: invoiceSales - creditMemoTotal,
    lastInvoiceDate: latestDate(invoices.map((row) => invoiceDeliveryDate(row))),
    lastCreditMemoDate: latestDate(creditMemos.map((row) => row.txn_date)),
    byRep: sortedSummaries(byRep),
    byAccount: sortedSummaries(byAccount),
    transactions: sortedTransactions,
    recentTransactions: sortedTransactions.slice(0, 50),
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
