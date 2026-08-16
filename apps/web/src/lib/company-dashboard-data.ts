import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildGrossProfitWorkflowProof } from "@/lib/supabase/gross-profit-center";
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
  const includeGrossProfit = filters.includeGrossProfit !== false && !cleanFilter(filters.rep);

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
    ? { grossProfit: null, grossProfitPercent: null, unavailableReason: null }
    : await fetchGrossProfitSummary(supabase, range);

  return {
    byRep: sales.byRep,
    byAccount: sales.byAccount,
    unavailableReason: sales.unavailableReason || null,
    summary: {
      grossSales: sales.invoiceSales,
      credits: sales.creditMemos,
      netSales: sales.netSales,
      invoiceCount: sales.invoiceCount,
      creditMemoCount: sales.creditMemoCount,
      averageInvoice: sales.invoiceCount > 0 ? sales.invoiceSales / sales.invoiceCount : 0,
      grossProfit: grossProfit.grossProfit,
      grossProfitPercent: grossProfit.grossProfitPercent,
      grossProfitUnavailableReason: grossProfit.unavailableReason
    }
  };
}

async function fetchGrossProfitSummary(supabase: SupabaseClient, range: { from: string; to: string }) {
  try {
    const proof = await buildGrossProfitProofWithRetry(supabase, range);
    return {
      grossProfit: numberOrNull(proof.grossProfit),
      grossProfitPercent: numberOrNull(proof.grossMarginPct),
      unavailableReason: null
    };
  } catch (error) {
    return {
      grossProfit: null,
      grossProfitPercent: null,
      unavailableReason: error instanceof Error ? error.message : "Gross profit is not available."
    };
  }
}

async function buildGrossProfitProofWithRetry(supabase: SupabaseClient, range: { from: string; to: string }) {
  const options = {
    includeLines: false,
    lineLimit: 0
  };
  try {
    return await buildGrossProfitWorkflowProof(supabase, range.from, range.to, options);
  } catch (error) {
    if (!isStatementTimeout(error)) throw error;
    await sleep(500);
    return buildGrossProfitWorkflowProof(supabase, range.from, range.to, options);
  }
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

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanFilter(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
