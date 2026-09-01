import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuickBooksSalesSummaryRow } from "@/lib/quickbooks-sales-types";

export const GROSS_PROFIT_FORMULA_VERSION = "gross-profit-center-v1-current-item-cost-billback";
export const STABLE_GROSS_PROFIT_LAG_DAYS = 124;

export type StoredGrossProfitBusinessLine = "all" | "stem" | "grw";

export type StoredGrossProfitSummary = {
  grossSales: number;
  credits: number;
  netSales: number;
  invoiceCount: number;
  creditMemoCount: number;
  averageInvoice: number;
  sampleCost: number;
  grossProfit: number | null;
  grossProfitPercent: number | null;
  grossProfitUnavailableReason: string | null;
};

export type StoredGrossProfitBusinessLineSummary = StoredGrossProfitSummary & {
  key: Exclude<StoredGrossProfitBusinessLine, "all">;
  label: string;
  salesShare: number;
};

export type StoredGrossProfitRollups = {
  summary: StoredGrossProfitSummary;
  byRepRows: QuickBooksSalesSummaryRow[];
  byAccountRows: QuickBooksSalesSummaryRow[];
  businessLineSummaries: StoredGrossProfitBusinessLineSummary[];
  unavailableReason: string | null;
};

type StoredRollupRow = {
  period_date: string;
  business_line: StoredGrossProfitBusinessLine;
  scope_type: "company" | "rep" | "account" | "rep_account";
  scope_key: string;
  scope_label: string;
  parent_scope_type: string;
  parent_scope_key: string;
  parent_scope_label: string;
  invoice_sales: number | string | null;
  credit_memos: number | string | null;
  net_sales: number | string | null;
  invoice_count: number | string | null;
  credit_memo_count: number | string | null;
  sample_cost: number | string | null;
  gross_profit: number | string | null;
  gross_profit_percent: number | string | null;
};

type MutableStoredRollup = {
  key: string;
  label: string;
  invoiceSales: number;
  creditMemos: number;
  netSales: number;
  invoiceCount: number;
  creditMemoCount: number;
  sampleCost: number;
  grossProfit: number;
};

const PAGE_SIZE = 1000;

const BUSINESS_LINE_LABELS: Record<Exclude<StoredGrossProfitBusinessLine, "all">, string> = {
  stem: "Stem Core",
  grw: "GRW Broker"
};

export async function fetchStoredGrossProfitRollups(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  options: { rep?: string; businessLine?: StoredGrossProfitBusinessLine } = {}
): Promise<StoredGrossProfitRollups> {
  const businessLine = options.businessLine || "all";
  const expectedDays = daysInclusive(range.from, range.to);
  if (expectedDays <= 0) {
    return unavailableStoredGrossProfitRollups("Invalid gross profit rollup date range.");
  }

  const repKey = rowKey(options.rep || "");
  const [companyRows, repRows, accountRows, businessLineRows] = await Promise.all([
    fetchStoredRows(supabase, range, {
      businessLine,
      scopeType: repKey ? "rep" : "company",
      scopeKey: repKey || "all"
    }),
    repKey
      ? Promise.resolve([] as StoredRollupRow[])
      : fetchStoredRows(supabase, range, {
          businessLine,
          scopeType: "rep"
        }),
    fetchStoredRows(supabase, range, {
      businessLine,
      scopeType: repKey ? "rep_account" : "account",
      parentScopeType: repKey ? "rep" : undefined,
      parentScopeKey: repKey || undefined
    }),
    fetchBusinessLineSummaryRows(supabase, range, repKey)
  ]);

  const coverageRows = companyRows.filter((row) => row.business_line === businessLine);
  if (new Set(coverageRows.map((row) => row.period_date)).size !== expectedDays) {
    return unavailableStoredGrossProfitRollups("Stored gross profit is still backfilling for this range.");
  }

  const summaryRollup = sumRows(companyRows, repKey ? options.rep || "Unassigned Rep" : "All");
  const byRepRows = repKey ? [] : rowsByScope(repRows);
  const byAccountRows = rowsByScope(accountRows);
  const businessLineSummaries = buildBusinessLineSummaries(businessLineRows, summaryRollup.netSales);

  return {
    summary: summaryFromRollup(summaryRollup),
    byRepRows,
    byAccountRows,
    businessLineSummaries,
    unavailableReason: null
  };
}

function fetchBusinessLineSummaryRows(supabase: SupabaseClient, range: { from: string; to: string }, repKey: string) {
  return fetchAllRows((from, to) =>
    supabase
      .from("gross_profit_daily_rollups")
      .select(STORED_SELECT)
      .gte("period_date", range.from)
      .lte("period_date", range.to)
      .in("business_line", ["stem", "grw"])
      .eq("scope_type", repKey ? "rep" : "company")
      .eq("scope_key", repKey || "all")
      .eq("formula_version", GROSS_PROFIT_FORMULA_VERSION)
      .order("period_date", { ascending: true })
      .range(from, to)
      .returns<StoredRollupRow[]>()
  );
}

function fetchStoredRows(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  filters: {
    businessLine: StoredGrossProfitBusinessLine;
    scopeType: StoredRollupRow["scope_type"];
    scopeKey?: string;
    parentScopeType?: string;
    parentScopeKey?: string;
  }
) {
  return fetchAllRows((from, to) => {
    let query = supabase
      .from("gross_profit_daily_rollups")
      .select(STORED_SELECT)
      .gte("period_date", range.from)
      .lte("period_date", range.to)
      .eq("business_line", filters.businessLine)
      .eq("scope_type", filters.scopeType)
      .eq("formula_version", GROSS_PROFIT_FORMULA_VERSION);

    if (filters.scopeKey) query = query.eq("scope_key", filters.scopeKey);
    if (filters.parentScopeType) query = query.eq("parent_scope_type", filters.parentScopeType);
    if (filters.parentScopeKey) query = query.eq("parent_scope_key", filters.parentScopeKey);
    return query.order("period_date", { ascending: true }).range(from, to).returns<StoredRollupRow[]>();
  });
}

async function fetchAllRows(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: StoredRollupRow[] | null; error: { message: string } | null }>
) {
  const rows: StoredRollupRow[] = [];
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

function rowsByScope(rows: StoredRollupRow[]): QuickBooksSalesSummaryRow[] {
  const byKey = new Map<string, MutableStoredRollup>();
  for (const row of rows) {
    const current = byKey.get(row.scope_key) || emptyRollup(row.scope_key, row.scope_label);
    addStoredRow(current, row);
    byKey.set(row.scope_key, current);
  }
  return Array.from(byKey.values())
    .map(salesRowFromRollup)
    .sort((a, b) => Math.abs(b.netSales) - Math.abs(a.netSales));
}

function sumRows(rows: StoredRollupRow[], fallbackLabel: string) {
  const rollup = emptyRollup("all", fallbackLabel);
  rows.forEach((row) => addStoredRow(rollup, row));
  return rollup;
}

function buildBusinessLineSummaries(rows: StoredRollupRow[], totalNetSales: number) {
  return (["stem", "grw"] as const).map((businessLine) => {
    const rollup = sumRows(
      rows.filter((row) => row.business_line === businessLine),
      BUSINESS_LINE_LABELS[businessLine]
    );
    return {
      key: businessLine,
      label: BUSINESS_LINE_LABELS[businessLine],
      ...summaryFromRollup(rollup),
      salesShare: totalNetSales === 0 ? 0 : rollup.netSales / totalNetSales
    };
  });
}

function emptyRollup(key: string, label: string): MutableStoredRollup {
  return {
    key,
    label,
    invoiceSales: 0,
    creditMemos: 0,
    netSales: 0,
    invoiceCount: 0,
    creditMemoCount: 0,
    sampleCost: 0,
    grossProfit: 0
  };
}

function addStoredRow(rollup: MutableStoredRollup, row: StoredRollupRow) {
  rollup.invoiceSales += number(row.invoice_sales);
  rollup.creditMemos += number(row.credit_memos);
  rollup.netSales += number(row.net_sales);
  rollup.invoiceCount += integer(row.invoice_count);
  rollup.creditMemoCount += integer(row.credit_memo_count);
  rollup.sampleCost += number(row.sample_cost);
  rollup.grossProfit += number(row.gross_profit);
}

function salesRowFromRollup(rollup: MutableStoredRollup): QuickBooksSalesSummaryRow {
  return {
    key: rollup.key,
    label: rollup.label,
    invoiceSales: rollup.invoiceSales,
    creditMemos: rollup.creditMemos,
    netSales: rollup.netSales,
    invoiceCount: rollup.invoiceCount,
    creditMemoCount: rollup.creditMemoCount,
    creditMemoRate: rollup.invoiceSales > 0 ? rollup.creditMemos / rollup.invoiceSales : 0,
    grossProfit: rollup.grossProfit,
    grossProfitPercent: marginPct(rollup.grossProfit, rollup.netSales),
    sampleCost: rollup.sampleCost
  };
}

function summaryFromRollup(rollup: MutableStoredRollup): StoredGrossProfitSummary {
  return {
    grossSales: rollup.invoiceSales,
    credits: rollup.creditMemos,
    netSales: rollup.netSales,
    invoiceCount: rollup.invoiceCount,
    creditMemoCount: rollup.creditMemoCount,
    averageInvoice: rollup.invoiceCount > 0 ? rollup.invoiceSales / rollup.invoiceCount : 0,
    sampleCost: rollup.sampleCost,
    grossProfit: rollup.grossProfit,
    grossProfitPercent: marginPct(rollup.grossProfit, rollup.netSales),
    grossProfitUnavailableReason: null
  };
}

function unavailableStoredGrossProfitRollups(reason: string): StoredGrossProfitRollups {
  return {
    summary: {
      grossSales: 0,
      credits: 0,
      netSales: 0,
      invoiceCount: 0,
      creditMemoCount: 0,
      averageInvoice: 0,
      sampleCost: 0,
      grossProfit: null,
      grossProfitPercent: null,
      grossProfitUnavailableReason: reason
    },
    byRepRows: [],
    byAccountRows: [],
    businessLineSummaries: [
      { key: "stem", label: BUSINESS_LINE_LABELS.stem, salesShare: 0, ...emptySummary(reason) },
      { key: "grw", label: BUSINESS_LINE_LABELS.grw, salesShare: 0, ...emptySummary(reason) }
    ],
    unavailableReason: reason
  };
}

function emptySummary(reason: string | null): StoredGrossProfitSummary {
  return {
    grossSales: 0,
    credits: 0,
    netSales: 0,
    invoiceCount: 0,
    creditMemoCount: 0,
    averageInvoice: 0,
    sampleCost: 0,
    grossProfit: null,
    grossProfitPercent: null,
    grossProfitUnavailableReason: reason
  };
}

function daysInclusive(from: string, to: string) {
  return Math.floor((dateFromIso(to).getTime() - dateFromIso(from).getTime()) / 86400000) + 1;
}

function dateFromIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function rowKey(label: string) {
  return label.trim().toLowerCase();
}

function number(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: number | string | null | undefined) {
  return Math.trunc(number(value));
}

function marginPct(grossProfit: number | null, grossSales: number | null) {
  if (grossProfit === null || grossSales === null || grossSales === 0) return null;
  return grossProfit / grossSales;
}

const STORED_SELECT = `
  period_date,
  business_line,
  scope_type,
  scope_key,
  scope_label,
  parent_scope_type,
  parent_scope_key,
  parent_scope_label,
  invoice_sales,
  credit_memos,
  net_sales,
  invoice_count,
  credit_memo_count,
  sample_cost,
  gross_profit,
  gross_profit_percent
`;
