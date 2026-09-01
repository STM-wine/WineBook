import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildGrossProfitCenter, type GrossProfitCenterLine } from "@/lib/supabase/gross-profit-center";
import { fetchQuickBooksSalesDashboardData } from "@/lib/supabase/quickbooks-sales-dashboard";
import type { QuickBooksSalesSummaryRow } from "@/lib/quickbooks-sales-types";

export type CompanyDashboardPeriod = "previous-day" | "mtd" | "ytd" | "custom";
export type CompanyDashboardBusinessLine = "all" | "stem" | "grw";

export type CompanyDashboardSummary = {
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

export type CompanyDashboardComparison = {
  label: string;
  dateFrom: string;
  dateTo: string;
  summary: CompanyDashboardSummary;
};

export type CompanyDashboardBusinessLineSummary = CompanyDashboardSummary & {
  key: Exclude<CompanyDashboardBusinessLine, "all">;
  label: string;
  salesShare: number;
};

export type CompanyDashboardData = {
  generatedAt: string;
  period: CompanyDashboardPeriod;
  periodLabel: string;
  businessLine: CompanyDashboardBusinessLine;
  dateFrom: string;
  dateTo: string;
  salesThroughDate: string | null;
  summary: CompanyDashboardSummary;
  comparison: CompanyDashboardComparison | null;
  businessLineSummaries: CompanyDashboardBusinessLineSummary[];
  byRep: QuickBooksSalesSummaryRow[];
  byAccount: QuickBooksSalesSummaryRow[];
  selectedRep: string | null;
  unavailableReason: string | null;
};

const DASHBOARD_TIME_ZONE = "America/Phoenix";
const QUICKBOOKS_SALES_HISTORY_FROM = process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_HISTORY_FROM || "2025-01-01";
const MAX_AUTO_GROSS_PROFIT_DAYS = 124;

export async function fetchCompanyDashboardData(
  supabase: SupabaseClient,
  period: CompanyDashboardPeriod = "mtd",
  filters: { dateFrom?: string; dateTo?: string; rep?: string; includeGrossProfit?: boolean; businessLine?: string } = {}
): Promise<CompanyDashboardData> {
  const range =
    filters.dateFrom && filters.dateTo
      ? { from: filters.dateFrom, to: filters.dateTo }
      : rangeForPeriod(period);
  const includeGrossProfit = filters.includeGrossProfit !== false;
  const businessLine = parseCompanyDashboardBusinessLine(filters.businessLine);
  const comparisonRange = businessLine === "all" ? comparableLastYearRange(range) : null;
  const includeComparisonGrossProfit = includeGrossProfit && canAutoLoadGrossProfitRange(range);

  const [current, comparison, salesThroughDate] = await Promise.all([
    fetchPeriodDashboardData(supabase, range, filters.rep, { includeGrossProfit, businessLine }),
    comparisonRange
      ? fetchPeriodDashboardData(supabase, comparisonRange, filters.rep, {
          includeGrossProfit: includeComparisonGrossProfit,
          businessLine: "all"
        })
      : Promise.resolve(null),
    fetchQuickBooksSalesThroughDate(supabase, range)
  ]);
  const currentRows = comparison ? mergeLastYearNetSales(current, comparison) : current;

  return {
    generatedAt: new Date().toISOString(),
    period,
    periodLabel: periodLabel(period),
    businessLine,
    dateFrom: range.from,
    dateTo: range.to,
    salesThroughDate,
    summary: current.summary,
    comparison: comparison
      ? {
          label: comparisonLabel(period),
          dateFrom: comparisonRange?.from || "",
          dateTo: comparisonRange?.to || "",
          summary: comparison.summary
        }
      : null,
    businessLineSummaries: currentRows.businessLineSummaries,
    byRep: currentRows.byRep,
    byAccount: currentRows.byAccount,
    selectedRep: cleanFilter(filters.rep) || null,
    unavailableReason: current.unavailableReason
  };
}

export function unavailableCompanyDashboardData(
  reason: string,
  period: CompanyDashboardPeriod = "mtd",
  filters: { dateFrom?: string; dateTo?: string; rep?: string; businessLine?: string } = {}
): CompanyDashboardData {
  const range =
    filters.dateFrom && filters.dateTo
      ? { from: filters.dateFrom, to: filters.dateTo }
      : rangeForPeriod(period);
  const comparisonRange = lastYearSameRange(range);
  const emptySummary = {
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

  return {
    generatedAt: new Date().toISOString(),
    period,
    periodLabel: periodLabel(period),
    businessLine: parseCompanyDashboardBusinessLine(filters.businessLine),
    dateFrom: range.from,
    dateTo: range.to,
    salesThroughDate: null,
    summary: emptySummary,
    comparison: comparisonRange
      ? {
          label: comparisonLabel(period),
          dateFrom: comparisonRange.from,
          dateTo: comparisonRange.to,
          summary: emptySummary
      }
      : null,
    businessLineSummaries: emptyBusinessLineSummaries(),
    byRep: [],
    byAccount: [],
    selectedRep: cleanFilter(filters.rep) || null,
    unavailableReason: reason
  };
}

type PeriodDashboardData = {
  byRep: QuickBooksSalesSummaryRow[];
  byAccount: QuickBooksSalesSummaryRow[];
  businessLineSummaries: CompanyDashboardBusinessLineSummary[];
  unavailableReason: string | null;
  summary: CompanyDashboardSummary;
};

async function fetchPeriodDashboardData(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  rep?: string,
  options: { includeGrossProfit?: boolean; businessLine?: CompanyDashboardBusinessLine } = {}
): Promise<PeriodDashboardData> {
  const businessLine = options.businessLine || "all";
  if (options.includeGrossProfit !== false) {
    const grossProfit = await fetchGrossProfitRollups(supabase, range, rep, businessLine);
    if (!grossProfit.unavailableReason) {
      return {
        byRep: grossProfit.byRepRows,
        byAccount: grossProfit.byAccountRows,
        businessLineSummaries: grossProfit.businessLineSummaries,
        unavailableReason: null,
        summary: grossProfit.summary
      };
    }

    const sales = await fetchQuickBooksSalesDashboardData(supabase, {
      dateFrom: range.from,
      dateTo: range.to,
      rep: cleanFilter(rep),
      includeTransactions: false,
      includeItems: false
    });
    return {
      byRep: mergeGrossProfitRows(sales.byRep, grossProfit.byRep),
      byAccount: mergeGrossProfitRows(sales.byAccount, grossProfit.byAccount),
      businessLineSummaries: grossProfit.businessLineSummaries,
      unavailableReason: sales.unavailableReason || null,
      summary: {
        grossSales: sales.invoiceSales,
        credits: sales.creditMemos,
        netSales: sales.netSales,
        invoiceCount: sales.invoiceCount,
        creditMemoCount: sales.creditMemoCount,
        averageInvoice: sales.invoiceCount > 0 ? sales.invoiceSales / sales.invoiceCount : 0,
        sampleCost: grossProfit.summary.sampleCost,
        grossProfit: grossProfit.summary.grossProfit,
        grossProfitPercent: grossProfit.summary.grossProfitPercent,
        grossProfitUnavailableReason: grossProfit.unavailableReason
      }
    };
  }

  const sales = await fetchQuickBooksSalesDashboardData(supabase, {
    dateFrom: range.from,
    dateTo: range.to,
    rep: cleanFilter(rep),
    includeTransactions: false,
    includeItems: false
  });
  const grossProfit = emptyGrossProfitRollups();
  return {
    byRep: mergeGrossProfitRows(sales.byRep, grossProfit.byRep),
    byAccount: mergeGrossProfitRows(sales.byAccount, grossProfit.byAccount),
    businessLineSummaries: grossProfit.businessLineSummaries,
    unavailableReason: sales.unavailableReason || null,
    summary: {
      grossSales: sales.invoiceSales,
      credits: sales.creditMemos,
      netSales: sales.netSales,
      invoiceCount: sales.invoiceCount,
      creditMemoCount: sales.creditMemoCount,
      averageInvoice: sales.invoiceCount > 0 ? sales.invoiceSales / sales.invoiceCount : 0,
      sampleCost: grossProfit.summary.sampleCost,
      grossProfit: grossProfit.summary.grossProfit,
      grossProfitPercent: grossProfit.summary.grossProfitPercent,
      grossProfitUnavailableReason: grossProfit.unavailableReason
    }
  };
}

async function fetchQuickBooksSalesThroughDate(supabase: SupabaseClient, range: { from: string; to: string }) {
  const [latestInvoice, latestCreditMemo] = await Promise.all([
    fetchLatestTransactionDate(supabase, "quickbooks_invoices", range),
    fetchLatestTransactionDate(supabase, "quickbooks_credit_memos", range)
  ]);
  return latestDate(latestInvoice, latestCreditMemo);
}

async function fetchLatestTransactionDate(
  supabase: SupabaseClient,
  table: "quickbooks_invoices" | "quickbooks_credit_memos",
  range: { from: string; to: string }
) {
  const { data, error } = await supabase
    .from(table)
    .select("txn_date")
    .gte("txn_date", range.from)
    .lte("txn_date", range.to)
    .order("txn_date", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ txn_date: string | null }>();

  if (error) {
    throw new Error(error.message);
  }

  return data?.txn_date || null;
}

function latestDate(...values: Array<string | null>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
}

function mergeLastYearNetSales(current: PeriodDashboardData, comparison: PeriodDashboardData): PeriodDashboardData {
  return {
    ...current,
    byRep: mergeLastYearNetSalesRows(current.byRep, comparison.byRep),
    byAccount: mergeLastYearNetSalesRows(current.byAccount, comparison.byAccount)
  };
}

function mergeLastYearNetSalesRows(rows: QuickBooksSalesSummaryRow[], lastYearRows: QuickBooksSalesSummaryRow[]) {
  const lastYearByKey = new Map(lastYearRows.map((row) => [row.key || rowKey(row.label), row]));
  return rows.map((row) => {
    const lastYear = lastYearByKey.get(row.key) || lastYearByKey.get(rowKey(row.label));
    const lastYearNetSales = lastYear?.netSales ?? null;
    return {
      ...row,
      lastYearNetSales,
      netSalesChangePercent: lastYearNetSales === null ? null : netSalesChangeRate(row.netSales, lastYearNetSales)
    };
  });
}

function netSalesChangeRate(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

type GrossProfitRollup = {
  invoiceSales: number;
  creditMemos: number;
  netSales: number;
  invoiceCount: number;
  creditMemoCount: number;
  sampleCost: number;
  grossProfit: number | null;
  grossProfitPercent: number | null;
};

type MutableGrossProfitRollup = GrossProfitRollup & {
  invoiceTxnIds: Set<string>;
  creditMemoTxnIds: Set<string>;
};

type GrossProfitRollups = {
  summary: CompanyDashboardSummary;
  byRep: Map<string, GrossProfitRollup>;
  byAccount: Map<string, GrossProfitRollup>;
  byRepRows: QuickBooksSalesSummaryRow[];
  byAccountRows: QuickBooksSalesSummaryRow[];
  businessLineSummaries: CompanyDashboardBusinessLineSummary[];
  unavailableReason: string | null;
};

async function fetchGrossProfitRollups(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  rep?: string,
  businessLine: CompanyDashboardBusinessLine = "all"
): Promise<GrossProfitRollups> {
  try {
    const grossProfitCenter = await buildGrossProfitCenterWithRetry(supabase, range);
    const repFilteredLines = filterGrossProfitLines(grossProfitCenter.lines, rep);
    const filteredLines = filterGrossProfitLinesByBusinessLine(repFilteredLines, businessLine);
    return {
      summary: summarizeGrossProfitLines(filteredLines),
      byRep: rollupGrossProfitLines(filteredLines, (line) => cleanLabel(line.salesRep, "Unassigned Rep")),
      byAccount: rollupGrossProfitLines(filteredLines, (line) => cleanLabel(line.customerFullName, "Unknown Account")),
      byRepRows: rollupSalesRows(filteredLines, (line) => cleanLabel(line.salesRep, "Unassigned Rep")),
      byAccountRows: rollupSalesRows(filteredLines, (line) => cleanLabel(line.customerFullName, "Unknown Account")),
      businessLineSummaries: summarizeBusinessLineSplits(repFilteredLines),
      unavailableReason: null
    };
  } catch (error) {
    return {
      ...emptyGrossProfitRollups(),
      unavailableReason: error instanceof Error ? error.message : "Gross profit is not available."
    };
  }
}

function emptyGrossProfitRollups(): GrossProfitRollups {
  return {
    summary: emptySummary(null),
    byRep: new Map(),
    byAccount: new Map(),
    byRepRows: [],
    byAccountRows: [],
    businessLineSummaries: emptyBusinessLineSummaries(),
    unavailableReason: null
  };
}

async function buildGrossProfitCenterWithRetry(supabase: SupabaseClient, range: { from: string; to: string }) {
  try {
    return await buildGrossProfitCenter(supabase, range.from, range.to);
  } catch (error) {
    if (!isStatementTimeout(error)) throw error;
    await sleep(500);
    return buildGrossProfitCenter(supabase, range.from, range.to);
  }
}

function filterGrossProfitLines(lines: GrossProfitCenterLine[], rep?: string) {
  const repFilter = cleanFilter(rep);
  if (!repFilter) return lines;
  return lines.filter((line) => cleanLabel(line.salesRep, "Unassigned Rep") === repFilter);
}

function filterGrossProfitLinesByBusinessLine(lines: GrossProfitCenterLine[], businessLine: CompanyDashboardBusinessLine) {
  if (businessLine === "all") return lines;
  return lines.filter((line) => classifyBusinessLine(line) === businessLine);
}

function rollupGrossProfitLines(lines: GrossProfitCenterLine[], labelForLine: (line: GrossProfitCenterLine) => string) {
  const rollups = new Map<string, MutableGrossProfitRollup>();
  for (const line of lines) {
    const label = labelForLine(line);
    const key = rowKey(label);
    const current = rollups.get(key) || emptyLineRollup();
    addLineToRollup(current, line);
    rollups.set(key, current);
  }
  return rollups;
}

function summarizeGrossProfitLines(lines: GrossProfitCenterLine[]) {
  const rollup = rollupLines(lines);
  const grossProfit = rollup.grossProfit ?? 0;
  return {
    grossSales: rollup.invoiceSales,
    credits: rollup.creditMemos,
    netSales: rollup.netSales,
    invoiceCount: rollup.invoiceCount,
    creditMemoCount: rollup.creditMemoCount,
    averageInvoice: rollup.invoiceCount > 0 ? rollup.invoiceSales / rollup.invoiceCount : 0,
    sampleCost: rollup.sampleCost,
    grossProfit,
    grossProfitPercent: marginPct(grossProfit, rollup.netSales),
    grossProfitUnavailableReason: null
  };
}

function rollupSalesRows(lines: GrossProfitCenterLine[], labelForLine: (line: GrossProfitCenterLine) => string) {
  const rollups = new Map<string, { label: string; rollup: MutableGrossProfitRollup }>();
  for (const line of lines) {
    const label = labelForLine(line);
    const key = rowKey(label);
    const current = rollups.get(key) || { label, rollup: emptyLineRollup() };
    addLineToRollup(current.rollup, line);
    rollups.set(key, current);
  }
  return Array.from(rollups.entries())
    .map(([key, { label, rollup }]) => salesRowFromRollup(key, label, rollup))
    .sort((a, b) => Math.abs(b.netSales) - Math.abs(a.netSales));
}

function summarizeBusinessLineSplits(lines: GrossProfitCenterLine[]): CompanyDashboardBusinessLineSummary[] {
  const allRollup = rollupLines(lines);
  const stemRollup = rollupLines(lines.filter((line) => classifyBusinessLine(line) === "stem"));
  const grwRollup = rollupLines(lines.filter((line) => classifyBusinessLine(line) === "grw"));
  return [
    businessLineSummary("stem", "Stem Core", stemRollup, allRollup.netSales),
    businessLineSummary("grw", "GRW Broker", grwRollup, allRollup.netSales)
  ];
}

function businessLineSummary(
  key: Exclude<CompanyDashboardBusinessLine, "all">,
  label: string,
  rollup: MutableGrossProfitRollup,
  totalNetSales: number
): CompanyDashboardBusinessLineSummary {
  const grossProfit = rollup.grossProfit ?? 0;
  return {
    key,
    label,
    grossSales: rollup.invoiceSales,
    credits: rollup.creditMemos,
    netSales: rollup.netSales,
    invoiceCount: rollup.invoiceCount,
    creditMemoCount: rollup.creditMemoCount,
    averageInvoice: rollup.invoiceCount > 0 ? rollup.invoiceSales / rollup.invoiceCount : 0,
    sampleCost: rollup.sampleCost,
    grossProfit,
    grossProfitPercent: marginPct(grossProfit, rollup.netSales),
    grossProfitUnavailableReason: null,
    salesShare: totalNetSales === 0 ? 0 : rollup.netSales / totalNetSales
  };
}

function rollupLines(lines: GrossProfitCenterLine[]) {
  const rollup = emptyLineRollup();
  lines.forEach((line) => addLineToRollup(rollup, line));
  return rollup;
}

function emptyLineRollup(): MutableGrossProfitRollup {
  return {
    invoiceSales: 0,
    creditMemos: 0,
    netSales: 0,
    invoiceCount: 0,
    creditMemoCount: 0,
    sampleCost: 0,
    grossProfit: 0,
    grossProfitPercent: null,
    invoiceTxnIds: new Set(),
    creditMemoTxnIds: new Set()
  };
}

function addLineToRollup(rollup: MutableGrossProfitRollup, line: GrossProfitCenterLine) {
  if (line.confidenceBucket === "sample_zero_dollar_or_100_discount") {
    rollup.sampleCost += Math.abs(money(line.effectiveCost ?? line.grossCostBeforeBillback));
    return;
  }

  const amount = money(line.qbGrossSales);
  if (line.transactionType === "invoice") {
    rollup.invoiceSales += amount;
    if (line.transactionId) rollup.invoiceTxnIds.add(line.transactionId);
  } else {
    rollup.creditMemos += Math.abs(amount);
    if (line.transactionId) rollup.creditMemoTxnIds.add(line.transactionId);
  }
  rollup.netSales += amount;
  rollup.invoiceCount = rollup.invoiceTxnIds.size;
  rollup.creditMemoCount = rollup.creditMemoTxnIds.size;
  rollup.grossProfit = money(rollup.grossProfit) + money(line.grossProfit);
  rollup.grossProfitPercent = marginPct(rollup.grossProfit, rollup.netSales);
}

function salesRowFromRollup(key: string, label: string, rollup: GrossProfitRollup): QuickBooksSalesSummaryRow {
  return {
    key,
    label,
    invoiceSales: rollup.invoiceSales,
    creditMemos: rollup.creditMemos,
    netSales: rollup.netSales,
    invoiceCount: rollup.invoiceCount,
    creditMemoCount: rollup.creditMemoCount,
    creditMemoRate: rollup.invoiceSales > 0 ? rollup.creditMemos / rollup.invoiceSales : 0,
    grossProfit: rollup.grossProfit,
    grossProfitPercent: rollup.grossProfitPercent,
    sampleCost: rollup.sampleCost
  };
}

function mergeGrossProfitRows(rows: QuickBooksSalesSummaryRow[], rollups: Map<string, GrossProfitRollup>) {
  return rows.map((row) => {
    const rollup = rollups.get(row.key) || rollups.get(rowKey(row.label));
    return {
      ...row,
      grossProfit: rollup?.grossProfit ?? null,
      grossProfitPercent: rollup?.grossProfitPercent ?? null,
      sampleCost: rollup?.sampleCost ?? row.sampleCost ?? 0
    };
  });
}

function emptyBusinessLineSummaries(): CompanyDashboardBusinessLineSummary[] {
  return [
    { key: "stem", label: "Stem Core", salesShare: 0, ...emptySummary(null) },
    { key: "grw", label: "GRW Broker", salesShare: 0, ...emptySummary(null) }
  ];
}

function emptySummary(reason: string | null): CompanyDashboardSummary {
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

function rowKey(label: string) {
  return label.trim().toLowerCase();
}

function cleanLabel(value: string | null | undefined, fallback: string) {
  const text = value?.trim();
  return text || fallback;
}

function classifyBusinessLine(line: GrossProfitCenterLine): Exclude<CompanyDashboardBusinessLine, "all"> {
  if (isGrwCode(line.vinosmithWineCode)) return "grw";
  if (isGrwCode(line.itemFullName)) return "grw";
  if (isGrwCode(line.description)) return "grw";
  if (normalizeBusinessLineCue(line.vinosmithImporterName) === "grw") return "grw";
  return "stem";
}

function isGrwCode(value: string | null | undefined) {
  const cue = normalizeBusinessLineCue(value);
  if (!cue) return false;
  return cue
    .split(/[:/\\|\-_\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => part.startsWith("grw"));
}

function normalizeBusinessLineCue(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function money(value: number | null | undefined) {
  return value || 0;
}

function marginPct(grossProfit: number | null, grossSales: number | null) {
  if (grossProfit === null || grossSales === null || grossSales === 0) return null;
  return grossProfit / grossSales;
}

function isStatementTimeout(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("statement timeout");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseCompanyDashboardPeriod(value: string | null): CompanyDashboardPeriod {
  if (value === "yesterday") return "previous-day";
  if (value === "previous-day" || value === "ytd" || value === "custom") return value;
  return "mtd";
}

export function parseCompanyDashboardBusinessLine(value: string | null | undefined): CompanyDashboardBusinessLine {
  if (value === "stem" || value === "grw") return value;
  return "all";
}

function rangeForPeriod(period: CompanyDashboardPeriod) {
  const today = todayInTimeZone();
  if (period === "previous-day") {
    const previousDay = previousBusinessDay(today);
    return { from: previousDay, to: previousDay };
  }
  if (period === "ytd") {
    return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function lastYearSameRange(range: { from: string; to: string }) {
  return {
    from: shiftYear(range.from, -1),
    to: shiftYear(range.to, -1)
  };
}

function comparableLastYearRange(range: { from: string; to: string }) {
  const comparisonRange = lastYearSameRange(range);
  return comparisonRange.from < QUICKBOOKS_SALES_HISTORY_FROM ? null : comparisonRange;
}

function canAutoLoadGrossProfitRange(range: { from: string; to: string }) {
  const from = dateFromIso(range.from);
  const to = dateFromIso(range.to);
  const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  return days > 0 && days <= MAX_AUTO_GROSS_PROFIT_DAYS;
}

function todayInTimeZone() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(value: string, days: number) {
  const date = dateFromIso(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromDate(date);
}

function previousBusinessDay(value: string) {
  let date = addDays(value, -1);
  while (isWeekend(date)) {
    date = addDays(date, -1);
  }
  return date;
}

function isWeekend(value: string) {
  const day = dateFromIso(value).getUTCDay();
  return day === 0 || day === 6;
}

function shiftYear(value: string, delta: number) {
  const year = Number(value.slice(0, 4)) + delta;
  const month = Number(value.slice(5, 7));
  const day = Math.min(Number(value.slice(8, 10)), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateFromIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoFromDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function periodLabel(period: CompanyDashboardPeriod) {
  if (period === "previous-day") return "Previous Day";
  if (period === "ytd") return "YTD";
  if (period === "custom") return "Custom";
  return "MTD";
}

function comparisonLabel(period: CompanyDashboardPeriod) {
  if (period === "mtd") return "Last Year MTD";
  if (period === "ytd") return "Last Year YTD";
  if (period === "previous-day") return "Same Day Last Year";
  return "Same Range Last Year";
}

function cleanFilter(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
