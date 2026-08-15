import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  QuickBooksSalesDashboardData,
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

type MutableSummary = QuickBooksSalesSummaryRow;

const DEFAULT_SALES_DELIVERY_FROM = "2026-08-01";
const DEFAULT_SALES_DELIVERY_TO = "2026-08-14";
const SALES_DATE_BASIS = "Invoice delivery date / ShipDate; credit memo transaction date";

function getSalesDashboardDeliveryDateRange() {
  return {
    from: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_DELIVERY_FROM || DEFAULT_SALES_DELIVERY_FROM,
    to: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_DELIVERY_TO || DEFAULT_SALES_DELIVERY_TO
  };
}

export async function fetchQuickBooksSalesDashboardData(supabase: SupabaseClient): Promise<QuickBooksSalesDashboardData> {
  const salesDateRange = getSalesDashboardDeliveryDateRange();
  const [invoiceResult, creditMemoResult] = await Promise.all([
    supabase
      .from("quickbooks_invoices")
      .select("txn_id,ref_number,txn_date,ship_date,customer_full_name,sales_rep_ref,subtotal,total_amount,balance_remaining,is_paid,time_modified,last_seen_at")
      .order("txn_date", { ascending: false, nullsFirst: false })
      .limit(5000)
      .returns<QuickBooksInvoiceRow[]>(),
    supabase
      .from("quickbooks_credit_memos")
      .select("txn_id,ref_number,txn_date,customer_full_name,subtotal,total_amount,raw_data,time_modified,last_seen_at")
      .order("txn_date", { ascending: false, nullsFirst: false })
      .limit(5000)
      .returns<QuickBooksCreditMemoRow[]>()
  ]);

  if (invoiceResult.error) throw new Error(invoiceResult.error.message);
  if (creditMemoResult.error) throw new Error(creditMemoResult.error.message);

  const invoices = (invoiceResult.data || []).filter((row) => dateInRange(invoiceDeliveryDate(row), salesDateRange));
  const creditMemos = (creditMemoResult.data || []).filter((row) => dateInRange(row.txn_date, salesDateRange));
  const byRep = new Map<string, MutableSummary>();
  const byAccount = new Map<string, MutableSummary>();
  const transactions: QuickBooksSalesTransactionRow[] = [];

  for (const invoice of invoices) {
    const amount = money(invoice.total_amount ?? invoice.subtotal);
    const rep = refName(invoice.sales_rep_ref) || "Unassigned Rep";
    const account = cleanLabel(invoice.customer_full_name, "Unknown Account");
    addInvoice(summaryFor(byRep, rep), amount);
    addInvoice(summaryFor(byAccount, account), amount);
    transactions.push({
      id: invoice.txn_id,
      type: "invoice",
      refNumber: invoice.ref_number,
      txnDate: invoice.txn_date,
      account,
      rep,
      amount
    });
  }

  for (const creditMemo of creditMemos) {
    const amount = Math.abs(money(creditMemo.total_amount ?? creditMemo.subtotal));
    const rep = creditMemoRepName(creditMemo.raw_data) || "Unassigned Rep";
    const account = cleanLabel(creditMemo.customer_full_name, "Unknown Account");
    addCredit(summaryFor(byRep, rep), amount);
    addCredit(summaryFor(byAccount, account), amount);
    transactions.push({
      id: creditMemo.txn_id,
      type: "credit_memo",
      refNumber: creditMemo.ref_number,
      txnDate: creditMemo.txn_date,
      account,
      rep,
      amount: -amount
    });
  }

  const invoiceSales = invoices.reduce((sum, row) => sum + money(row.total_amount ?? row.subtotal), 0);
  const creditMemoTotal = creditMemos.reduce((sum, row) => sum + Math.abs(money(row.total_amount ?? row.subtotal)), 0);

  return {
    generatedAt: new Date().toISOString(),
    salesDateFrom: salesDateRange.from,
    salesDateTo: salesDateRange.to,
    dateBasis: SALES_DATE_BASIS,
    invoiceCount: invoices.length,
    creditMemoCount: creditMemos.length,
    invoiceSales,
    creditMemos: creditMemoTotal,
    netSales: invoiceSales - creditMemoTotal,
    lastInvoiceDate: latestDate(invoices.map((row) => row.txn_date)),
    lastCreditMemoDate: latestDate(creditMemos.map((row) => row.txn_date)),
    byRep: sortedSummaries(byRep),
    byAccount: sortedSummaries(byAccount),
    recentTransactions: transactions
      .sort((a, b) => (b.txnDate || "").localeCompare(a.txnDate || ""))
      .slice(0, 50),
    unavailableReason: null
  };
}

export function unavailableQuickBooksSalesDashboardData(reason: string): QuickBooksSalesDashboardData {
  const salesDateRange = getSalesDashboardDeliveryDateRange();
  return {
    generatedAt: new Date().toISOString(),
    salesDateFrom: salesDateRange.from,
    salesDateTo: salesDateRange.to,
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
    recentTransactions: [],
    unavailableReason: reason
  };
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

function cleanLabel(value: string | null | undefined, fallback: string) {
  const text = value?.trim();
  return text || fallback;
}

function refName(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  return stringValue(value.FullName) || stringValue(value.fullName) || stringValue(value.Name) || stringValue(value.name);
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
