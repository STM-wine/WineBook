import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildGrossProfitCenter, type GrossProfitCenterLine } from "@/lib/supabase/gross-profit-center";
import { fetchQuickBooksSalesDashboardData } from "@/lib/supabase/quickbooks-sales-dashboard";
import type { QuickBooksSalesSummaryRow } from "@/lib/quickbooks-sales-types";

export type CompanyDashboardPeriod = "previous-day" | "mtd" | "ytd" | "custom";

export type CompanyDashboardSummary = {
  grossSales: number;
  credits: number;
  netSales: number;
  invoiceCount: number;
  creditMemoCount: number;
  averageInvoice: number;
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

export type CompanyDashboardData = {
  generatedAt: string;
  period: CompanyDashboardPeriod;
  periodLabel: string;
  dateFrom: string;
  dateTo: string;
  summary: CompanyDashboardSummary;
  comparison: CompanyDashboardComparison | null;
  byRep: QuickBooksSalesSummaryRow[];
  byAccount: QuickBooksSalesSummaryRow[];
  selectedRep: string | null;
  unavailableReason: string | null;
};

const DASHBOARD_TIME_ZONE = "America/Phoenix";

export async function fetchCompanyDashboardData(
  supabase: SupabaseClient,
  period: CompanyDashboardPeriod = "mtd",
  filters: { dateFrom?: string; dateTo?: string; rep?: string; includeGrossProfit?: boolean } = {}
): Promise<CompanyDashboardData> {
  const range =
    filters.dateFrom && filters.dateTo
      ? { from: filters.dateFrom, to: filters.dateTo }
      : rangeForPeriod(period);
  const comparisonRange = !filters.rep ? lastYearSameRange(range) : null;
  const includeGrossProfit = filters.includeGrossProfit !== false;

  const [current, comparison] = await Promise.all([
    fetchPeriodDashboardData(supabase, range, filters.rep, { includeGrossProfit }),
    comparisonRange ? fetchPeriodDashboardData(supabase, comparisonRange, undefined, { includeGrossProfit }) : Promise.resolve(null)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    period,
    periodLabel: periodLabel(period),
    dateFrom: range.from,
    dateTo: range.to,
    summary: current.summary,
    comparison: comparison
      ? {
          label: comparisonLabel(period),
          dateFrom: comparisonRange?.from || "",
          dateTo: comparisonRange?.to || "",
          summary: comparison.summary
        }
      : null,
    byRep: current.byRep,
    byAccount: current.byAccount,
    selectedRep: cleanFilter(filters.rep) || null,
    unavailableReason: current.unavailableReason
  };
}

export function unavailableCompanyDashboardData(
  reason: string,
  period: CompanyDashboardPeriod = "mtd",
  filters: { dateFrom?: string; dateTo?: string; rep?: string } = {}
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
    grossProfit: null,
    grossProfitPercent: null,
    grossProfitUnavailableReason: reason
  };

  return {
    generatedAt: new Date().toISOString(),
    period,
    periodLabel: periodLabel(period),
    dateFrom: range.from,
    dateTo: range.to,
    summary: emptySummary,
    comparison: comparisonRange
      ? {
          label: comparisonLabel(period),
          dateFrom: comparisonRange.from,
          dateTo: comparisonRange.to,
          summary: emptySummary
        }
      : null,
    byRep: [],
    byAccount: [],
    selectedRep: cleanFilter(filters.rep) || null,
    unavailableReason: reason
  };
}

async function fetchPeriodDashboardData(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  rep?: string,
  options: { includeGrossProfit?: boolean } = {}
) {
  const sales = await fetchQuickBooksSalesDashboardData(supabase, {
    dateFrom: range.from,
    dateTo: range.to,
    rep: cleanFilter(rep),
    includeTransactions: false,
    includeItems: false
  });
  const grossProfit = options.includeGrossProfit === false
    ? emptyGrossProfitRollups()
    : await fetchGrossProfitRollups(supabase, range, rep);

  return {
    byRep: mergeGrossProfitRows(sales.byRep, grossProfit.byRep),
    byAccount: mergeGrossProfitRows(sales.byAccount, grossProfit.byAccount),
    unavailableReason: sales.unavailableReason || null,
    summary: {
      grossSales: sales.invoiceSales,
      credits: sales.creditMemos,
      netSales: sales.netSales,
      invoiceCount: sales.invoiceCount,
      creditMemoCount: sales.creditMemoCount,
      averageInvoice: sales.invoiceCount > 0 ? sales.invoiceSales / sales.invoiceCount : 0,
      grossProfit: grossProfit.summary.grossProfit,
      grossProfitPercent: grossProfit.summary.grossProfitPercent,
      grossProfitUnavailableReason: grossProfit.unavailableReason
    }
  };
}

type GrossProfitRollup = {
  grossSales: number;
  grossProfit: number | null;
  grossProfitPercent: number | null;
};

type GrossProfitRollups = {
  summary: GrossProfitRollup;
  byRep: Map<string, GrossProfitRollup>;
  byAccount: Map<string, GrossProfitRollup>;
  unavailableReason: string | null;
};

async function fetchGrossProfitRollups(supabase: SupabaseClient, range: { from: string; to: string }, rep?: string): Promise<GrossProfitRollups> {
  try {
    const grossProfitCenter = await buildGrossProfitCenterWithRetry(supabase, range);
    const filteredLines = filterGrossProfitLines(grossProfitCenter.lines, rep);
    return {
      summary: summarizeGrossProfitLines(filteredLines),
      byRep: rollupGrossProfitLines(filteredLines, (line) => cleanLabel(line.salesRep, "Unassigned Rep")),
      byAccount: rollupGrossProfitLines(filteredLines, (line) => cleanLabel(line.customerFullName, "Unknown Account")),
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
    summary: { grossSales: 0, grossProfit: null, grossProfitPercent: null },
    byRep: new Map(),
    byAccount: new Map(),
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

function rollupGrossProfitLines(lines: GrossProfitCenterLine[], labelForLine: (line: GrossProfitCenterLine) => string) {
  const rollups = new Map<string, GrossProfitRollup>();
  for (const line of lines) {
    const label = labelForLine(line);
    const key = rowKey(label);
    const current = rollups.get(key) || { grossSales: 0, grossProfit: 0, grossProfitPercent: null };
    current.grossSales += money(line.qbGrossSales);
    current.grossProfit = money(current.grossProfit) + money(line.grossProfit);
    current.grossProfitPercent = marginPct(current.grossProfit, current.grossSales);
    rollups.set(key, current);
  }
  return rollups;
}

function summarizeGrossProfitLines(lines: GrossProfitCenterLine[]) {
  const grossSales = lines.reduce((sum, line) => sum + money(line.qbGrossSales), 0);
  const grossProfit = lines.reduce((sum, line) => sum + money(line.grossProfit), 0);
  return {
    grossSales,
    grossProfit,
    grossProfitPercent: marginPct(grossProfit, grossSales)
  };
}

function mergeGrossProfitRows(rows: QuickBooksSalesSummaryRow[], rollups: Map<string, GrossProfitRollup>) {
  return rows.map((row) => {
    const rollup = rollups.get(row.key) || rollups.get(rowKey(row.label));
    return {
      ...row,
      grossProfit: rollup?.grossProfit ?? null,
      grossProfitPercent: rollup?.grossProfitPercent ?? null
    };
  });
}

function rowKey(label: string) {
  return label.trim().toLowerCase();
}

function cleanLabel(value: string | null | undefined, fallback: string) {
  const text = value?.trim();
  return text || fallback;
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
