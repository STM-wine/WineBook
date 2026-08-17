"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { WineLoadingProgress } from "@/components/wine-loading-progress";
import type { CompanyDashboardBusinessLine, CompanyDashboardData, CompanyDashboardPeriod } from "@/lib/company-dashboard-data";
import type { QuickBooksSalesSummaryRow } from "@/lib/quickbooks-sales-types";

type CompanyDashboardViewProps = {
  initialData: CompanyDashboardData;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1
});

const number = new Intl.NumberFormat("en-US");

const RANGE_PLACEHOLDER = "- Choose -";
const CUSTOM_RANGE_LABEL = "Custom";

const DATE_RANGE_LABELS = [
  RANGE_PLACEHOLDER,
  CUSTOM_RANGE_LABEL,
  "Today",
  "Tomorrow",
  "This Week",
  "This Week-to-date",
  "This Month",
  "This Month-to-date",
  "This Month: 1st Half (1 - 15)",
  "This Month: 2nd Half (16 - End)",
  "This Quarter",
  "This Quarter-to-date",
  "This Year",
  "This Year-to-date",
  "This Year-to-last-month",
  "Yesterday",
  "Last Week",
  "Last Week-to-date",
  "Last Month",
  "Last Month-to-date",
  "Last Month: 1st Half (1 - 15)",
  "Last Month: 2nd Half (16 - End)",
  "Last Quarter",
  "Last Quarter-to-date",
  "Last Year - This Month",
  "Last Year - Next Month",
  "Last Year - Last Month",
  "Last Year: Beginning of Year - Today",
  "Last Year: Beginning of Year to Last Month",
  "Last Year: This Month-to-Date",
  "Last Year",
  "Last Year-to-date",
  "Last Year - Since 365 Days Ago",
  "2 Days Ago",
  "Since 2 Days Ago",
  "Since 7 Days Ago",
  "Since 30 Days Ago",
  "Since 60 Days Ago",
  "Since 90 Days Ago",
  "Since 365 Days Ago"
] as const;

type DateRangeLabel = (typeof DATE_RANGE_LABELS)[number];

type SortKey = "label" | "gross" | "credits" | "net" | "gp" | "samples" | "invoices";
type SortState = {
  key: SortKey;
  direction: "asc" | "desc";
};

export function CompanyDashboardView({ initialData }: CompanyDashboardViewProps) {
  const [topbarControlTarget, setTopbarControlTarget] = useState<HTMLElement | null>(null);
  const [dataByPeriod, setDataByPeriod] = useState<Record<string, CompanyDashboardData>>({
    [cacheKey(initialData)]: initialData
  });
  const [activePeriod, setActivePeriod] = useState<CompanyDashboardPeriod>(initialData.period);
  const [selectedRangeLabel, setSelectedRangeLabel] = useState<DateRangeLabel>(labelForInitialPeriod(initialData.period));
  const [dateFrom, setDateFrom] = useState(initialData.dateFrom);
  const [dateTo, setDateTo] = useState(initialData.dateTo);
  const [selectedBusinessLine, setSelectedBusinessLine] = useState<CompanyDashboardBusinessLine>(initialData.businessLine);
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const [accountData, setAccountData] = useState<CompanyDashboardData>(initialData);
  const [repSort, setRepSort] = useState<SortState>({ key: "net", direction: "desc" });
  const [accountSort, setAccountSort] = useState<SortState>({ key: "net", direction: "desc" });
  const [isLoading, setIsLoading] = useState(false);
  const [isProfitLoading, setIsProfitLoading] = useState(false);
  const [isDrilldownLoading, setIsDrilldownLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const activeKey = cacheKeyFor(activePeriod, dateFrom, dateTo, selectedBusinessLine);
  const data = dataByPeriod[activeKey] || initialData;
  const displayPeriodLabel = selectedRangeLabel === RANGE_PLACEHOLDER || selectedRangeLabel === CUSTOM_RANGE_LABEL
    ? data.periodLabel
    : selectedRangeLabel;
  const scopedPeriodLabel = data.businessLine === "all" ? displayPeriodLabel : `${displayPeriodLabel} ${businessLineLabel(data.businessLine)}`;
  const compactScopedPeriodLabel = compactDashboardPeriodLabel(scopedPeriodLabel);
  const comparison = data.comparison;
  const netSalesDelta = comparison ? data.summary.netSales - comparison.summary.netSales : null;
  const netSalesDeltaRate = comparison ? changeRate(data.summary.netSales, comparison.summary.netSales) : null;
  const gpDelta = comparison && data.summary.grossProfitPercent !== null && comparison.summary.grossProfitPercent !== null
    ? data.summary.grossProfitPercent - comparison.summary.grossProfitPercent
    : null;
  const sampleCostRate = data.summary.netSales === 0 ? null : data.summary.sampleCost / data.summary.netSales;
  const loadingStatus = dashboardLoadingStatus({ isDrilldownLoading, isLoading, isProfitLoading });
  const topReps = useMemo(() => sortSummaryRows(data.byRep, repSort).slice(0, 20), [data.byRep, repSort]);
  const accountRows = useMemo(() => sortSummaryRows(accountData.byAccount, accountSort), [accountData.byAccount, accountSort]);

  useEffect(() => {
    setTopbarControlTarget(document.getElementById("topbar-context-controls"));
    return () => setTopbarControlTarget(null);
  }, []);

  async function selectDateRange(rangeLabel: DateRangeLabel) {
    setSelectedRangeLabel(rangeLabel);
    if (rangeLabel === RANGE_PLACEHOLDER) return;
    if (rangeLabel === CUSTOM_RANGE_LABEL) {
      setActivePeriod("custom");
      return;
    }

    const preset = dateRangeForLabel(rangeLabel);
    const nextPeriod = preset.period || "custom";
    const nextKey = cacheKeyFor(nextPeriod, preset.dateFrom, preset.dateTo, selectedBusinessLine);
    setActivePeriod(nextPeriod);
    setDateFrom(preset.dateFrom);
    setDateTo(preset.dateTo);
    setSelectedRep(null);
    setErrorMessage("");
    const cachedData = dataByPeriod[nextKey];
    if (cachedData) {
      setDateFrom(cachedData.dateFrom);
      setDateTo(cachedData.dateTo);
      setAccountData(cachedData);
      if (cachedData.summary.grossProfitPercent === null) {
        void hydrateProfit(cachedData);
      }
      return;
    }

    setIsLoading(true);
    try {
      const requiresProfit = selectedBusinessLine !== "all";
      const dashboardData = await loadCompanyDashboard({
        dateFrom: preset.period ? undefined : preset.dateFrom,
        dateTo: preset.period ? undefined : preset.dateTo,
        period: preset.period,
        includeProfit: requiresProfit,
        businessLine: selectedBusinessLine
      });
      setDateFrom(dashboardData.dateFrom);
      setDateTo(dashboardData.dateTo);
      setAccountData(dashboardData);
      setDataByPeriod((current) => ({ ...current, [cacheKey(dashboardData)]: dashboardData }));
      if (!requiresProfit) void hydrateProfit(dashboardData);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load company dashboard.");
    } finally {
      setIsLoading(false);
    }
  }

  async function applyCustomRange() {
    setActivePeriod("custom");
    setSelectedRangeLabel(CUSTOM_RANGE_LABEL);
    setSelectedRep(null);
    setErrorMessage("");
    const key = cacheKeyFor("custom", dateFrom, dateTo, selectedBusinessLine);
    if (dataByPeriod[key]) {
      setAccountData(dataByPeriod[key]);
      if (dataByPeriod[key].summary.grossProfitPercent === null) {
        void hydrateProfit(dataByPeriod[key]);
      }
      return;
    }

    setIsLoading(true);
    try {
      const requiresProfit = selectedBusinessLine !== "all";
      const dashboardData = await loadCompanyDashboard({
        dateFrom,
        dateTo,
        includeProfit: requiresProfit,
        businessLine: selectedBusinessLine
      });
      setAccountData(dashboardData);
      setDataByPeriod((current) => ({ ...current, [cacheKey(dashboardData)]: dashboardData }));
      if (!requiresProfit) void hydrateProfit(dashboardData);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load company dashboard.");
    } finally {
      setIsLoading(false);
    }
  }

  async function selectRep(row: QuickBooksSalesSummaryRow) {
    setSelectedRep(row.label);
    setErrorMessage("");
    setIsDrilldownLoading(true);
    try {
      const drilldownData = await loadCompanyDashboard({
        period: activePeriod === "custom" ? undefined : activePeriod,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
        rep: row.label,
        businessLine: selectedBusinessLine
      });
      setAccountData(drilldownData);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load rep accounts.");
    } finally {
      setIsDrilldownLoading(false);
    }
  }

  function clearRep() {
    setSelectedRep(null);
    setAccountData(data);
  }

  async function selectBusinessLine(nextBusinessLine: CompanyDashboardBusinessLine) {
    if (nextBusinessLine === selectedBusinessLine) return;
    setSelectedBusinessLine(nextBusinessLine);
    setSelectedRep(null);
    setErrorMessage("");

    const key = cacheKeyFor(activePeriod, dateFrom, dateTo, nextBusinessLine);
    const cachedData = dataByPeriod[key];
    if (cachedData) {
      setAccountData(cachedData);
      if (cachedData.summary.grossProfitPercent === null) {
        void hydrateProfit(cachedData);
      }
      return;
    }

    setIsLoading(true);
    try {
      const dashboardData = await loadCompanyDashboard({
        dateFrom: activePeriod === "custom" ? dateFrom : undefined,
        dateTo: activePeriod === "custom" ? dateTo : undefined,
        period: activePeriod === "custom" ? undefined : activePeriod,
        includeProfit: true,
        businessLine: nextBusinessLine
      });
      setDateFrom(dashboardData.dateFrom);
      setDateTo(dashboardData.dateTo);
      setAccountData(dashboardData);
      setDataByPeriod((current) => ({ ...current, [cacheKey(dashboardData)]: dashboardData }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load business line.");
    } finally {
      setIsLoading(false);
    }
  }

  async function hydrateProfit(baseData: CompanyDashboardData) {
    if (baseData.selectedRep) return;
    setIsProfitLoading(true);
    try {
      const dashboardData = await loadCompanyDashboard({
        dateFrom: baseData.period === "custom" ? baseData.dateFrom : undefined,
        dateTo: baseData.period === "custom" ? baseData.dateTo : undefined,
        period: baseData.period === "custom" ? undefined : baseData.period,
        includeProfit: true,
        businessLine: baseData.businessLine
      });
      setDataByPeriod((current) => ({ ...current, [cacheKey(dashboardData)]: dashboardData }));
      setAccountData((current) =>
        current.selectedRep || current.dateFrom !== baseData.dateFrom || current.dateTo !== baseData.dateTo ? current : dashboardData
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not calculate gross profit.");
    } finally {
      setIsProfitLoading(false);
    }
  }

  return (
    <section className="company-dashboard-view">
      {loadingStatus ? <WineLoadingProgress message={loadingStatus.message} detail={loadingStatus.detail} /> : null}
      {topbarControlTarget
        ? createPortal(
            <DashboardDateControls
              dateFrom={dateFrom}
              dateTo={dateTo}
              isLoading={isLoading}
              onApplyCustomRange={applyCustomRange}
              onSelectBusinessLine={selectBusinessLine}
              onDateFromChange={(value) => {
                setSelectedRangeLabel(CUSTOM_RANGE_LABEL);
                setDateFrom(value);
              }}
              onDateToChange={(value) => {
                setSelectedRangeLabel(CUSTOM_RANGE_LABEL);
                setDateTo(value);
              }}
              onSelectDateRange={selectDateRange}
              selectedBusinessLine={selectedBusinessLine}
              selectedRangeLabel={selectedRangeLabel}
            />,
            topbarControlTarget
          )
        : null}
      <div className="company-dashboard-heading">
        <div>
          <p className="eyebrow">Stem Intelligence</p>
          <h1>Company Dashboard</h1>
          <p className="muted">{formatDateRange(data.dateFrom, data.dateTo)}</p>
        </div>
        <span className="company-dashboard-updated">Updated {formatDateTime(data.generatedAt)}</span>
      </div>

      {data.unavailableReason ? <div className="status-card error">Sales data is not available yet.</div> : null}
      {errorMessage ? <div className="status-card error">{errorMessage}</div> : null}

      <div className="company-kpi-grid">
        <DashboardMetric
          label={`${compactScopedPeriodLabel} Sales`}
          value={currency.format(data.summary.netSales)}
          detail={`Gross ${currency.format(data.summary.grossSales)} / Net ${currency.format(data.summary.netSales)}`}
          meta={`${number.format(data.summary.invoiceCount)} invoices, ${number.format(data.summary.creditMemoCount)} credits`}
          helpText="QuickBooks invoice subtotals create gross sales. QuickBooks credit memo subtotals are subtracted to create net sales for the selected date range."
        />
        <DashboardMetric
          label={comparison ? salesComparisonLabel(data.period) : "Sales Trend"}
          value={comparison ? formatSignedCurrency(netSalesDelta) : "-"}
          detail={comparison ? `${formatSignedPercent(netSalesDeltaRate)} vs ${comparison.label}` : "Comparison unavailable"}
          tone={toneFor(netSalesDelta)}
          helpText="Compares current QuickBooks net sales against the same date range last year."
        />
        <DashboardMetric
          label={`${compactScopedPeriodLabel} GP %`}
          value={isProfitLoading && data.summary.grossProfitPercent === null ? "Calculating..." : formatPercent(data.summary.grossProfitPercent)}
          detail={
            isProfitLoading && data.summary.grossProfit === null
              ? "Calculating GP from QB + VS"
              : data.summary.grossProfit === null
                ? "Gross profit unavailable"
                : `${currency.format(data.summary.grossProfit)} gross profit`
          }
          meta={isProfitLoading && data.summary.grossProfitPercent === null ? "Background calculation running" : data.summary.grossProfitUnavailableReason || "QuickBooks + Vinosmith cost basis"}
          helpText="Gross profit uses QuickBooks sales lines, current QuickBooks item FOB cost, and the Stem laid-in per bottle from Supplier Logistics. When Vinosmith order and price data can be matched, Vinosmith billbacks reduce effective cost."
        />
        <DashboardMetric
          label={comparison ? gpComparisonLabel(data.period) : "GP Trend"}
          value={isProfitLoading && gpDelta === null ? "Calculating..." : comparison ? formatSignedPoints(gpDelta) : "-"}
          detail={
            isProfitLoading && gpDelta === null
              ? "Calculating LY comparison"
              : comparison
                ? `${formatPercent(comparison.summary.grossProfitPercent)} last year`
                : "Comparison unavailable"
          }
          tone={toneFor(gpDelta)}
          helpText="Compares this period's GP percentage against the same date range last year using the same QuickBooks cost, Supplier Logistics laid-in, and Vinosmith billback method."
        />
        <DashboardMetric
          label={`${compactScopedPeriodLabel} Samples`}
          value={isProfitLoading && data.summary.grossProfitPercent === null ? "Calculating..." : currency.format(data.summary.sampleCost)}
          detail={`${formatPercent(sampleCostRate)} of net sales`}
          meta="Landed sample cost"
          helpText="Samples as a percent of net sales is landed sample cost divided by QuickBooks net sales for the selected date range. Landed sample cost is quantity pulled multiplied by QuickBooks FOB plus Supplier Logistics laid-in cost."
        />
        <DashboardMetric
          label={`${compactScopedPeriodLabel} Avg Invoice`}
          value={currency.format(data.summary.averageInvoice)}
          detail={`${number.format(data.summary.invoiceCount)} invoice basis`}
          helpText="Average invoice is QuickBooks gross invoice sales divided by the number of QuickBooks invoices in the selected range. Credit memos are not included in this average."
        />
      </div>

      <BusinessLineSplit
        activeBusinessLine={selectedBusinessLine}
        isLoading={isProfitLoading || isLoading}
        rows={data.businessLineSummaries}
        onSelectBusinessLine={selectBusinessLine}
      />

      <section className="company-dashboard-panel">
        <div className="panel-heading-row">
          <div>
            <h2>{scopedPeriodLabel} Sales by Rep</h2>
            <p>Click a rep to drill into account sales.</p>
          </div>
          {isLoading ? <span className="data-pill">Loading</span> : null}
        </div>
        <div className="table-scroll">
          <table className="data-table company-rep-table">
            <thead>
              <tr>
                <SortableHeader label="Rep" sortKey="label" sort={repSort} onSort={setRepSort} />
                <SortableHeader label="Gross" sortKey="gross" sort={repSort} onSort={setRepSort} numeric />
                <SortableHeader label="Credits" sortKey="credits" sort={repSort} onSort={setRepSort} numeric />
                <SortableHeader label="Net" sortKey="net" sort={repSort} onSort={setRepSort} numeric />
                <SortableHeader
                  label="GP %"
                  sortKey="gp"
                  sort={repSort}
                  onSort={setRepSort}
                  numeric
                  helpText="Calculated from QuickBooks sales lines using current QuickBooks item cost. Matched Vinosmith billbacks reduce effective cost where available."
                />
                <SortableHeader
                  label="Samples"
                  sortKey="samples"
                  sort={repSort}
                  onSort={setRepSort}
                  numeric
                  helpText="Landed cost of sample, zero-dollar, or fully discounted lines. Shown for manager visibility; excluded from GP %."
                />
                <SortableHeader label="Invoices" sortKey="invoices" sort={repSort} onSort={setRepSort} numeric />
              </tr>
            </thead>
            <tbody>
              {topReps.map((row) => (
                <SummaryRow
                  key={row.key}
                  row={row}
                  selected={selectedRep === row.label}
                  showProfitLoading={isProfitLoading && row.grossProfitPercent == null}
                  onSelect={() => void selectRep(row)}
                />
              ))}
              {topReps.length === 0 ? (
                <tr>
                  <td colSpan={7}>No sales found for this period.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="company-dashboard-panel">
        <div className="panel-heading-row">
          <div>
            <h2>{selectedRep ? `${selectedRep} Account Summary` : `${scopedPeriodLabel} Account Summary`}</h2>
            <p>{selectedRep ? "Filtered from the selected rep." : "Company account sales, descending by net sales."}</p>
          </div>
          <div className="company-panel-actions">
            {isDrilldownLoading ? <span className="data-pill">Loading</span> : null}
            {selectedRep ? (
              <button className="button button-tiny button-outline" onClick={clearRep} type="button">
                All Reps
              </button>
            ) : null}
          </div>
        </div>
        <div className="table-scroll company-account-scroll">
          <table className="data-table company-account-table">
            <thead>
              <tr>
                <SortableHeader label="Account" sortKey="label" sort={accountSort} onSort={setAccountSort} />
                <SortableHeader label="Gross" sortKey="gross" sort={accountSort} onSort={setAccountSort} numeric />
                <SortableHeader label="Credits" sortKey="credits" sort={accountSort} onSort={setAccountSort} numeric />
                <SortableHeader label="Net" sortKey="net" sort={accountSort} onSort={setAccountSort} numeric />
                <SortableHeader
                  label="GP %"
                  sortKey="gp"
                  sort={accountSort}
                  onSort={setAccountSort}
                  numeric
                  helpText="Calculated from QuickBooks sales lines using current QuickBooks item cost. Matched Vinosmith billbacks reduce effective cost where available."
                />
                <SortableHeader
                  label="Samples"
                  sortKey="samples"
                  sort={accountSort}
                  onSort={setAccountSort}
                  numeric
                  helpText="Landed cost of sample, zero-dollar, or fully discounted lines. Shown for manager visibility; excluded from GP %."
                />
                <SortableHeader label="Invoices" sortKey="invoices" sort={accountSort} onSort={setAccountSort} numeric />
              </tr>
            </thead>
            <tbody>
              {accountRows.map((row) => (
                <SummaryRow
                  key={row.key}
                  row={row}
                  showProfitLoading={!selectedRep && isProfitLoading && row.grossProfitPercent == null}
                />
              ))}
              {accountRows.length === 0 ? (
                <tr>
                  <td colSpan={7}>No accounts found for this period.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function DashboardDateControls({
  dateFrom,
  dateTo,
  isLoading,
  onApplyCustomRange,
  onSelectBusinessLine,
  onDateFromChange,
  onDateToChange,
  onSelectDateRange,
  selectedBusinessLine,
  selectedRangeLabel
}: {
  dateFrom: string;
  dateTo: string;
  isLoading: boolean;
  onApplyCustomRange: () => void;
  onSelectBusinessLine: (businessLine: CompanyDashboardBusinessLine) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onSelectDateRange: (rangeLabel: DateRangeLabel) => void;
  selectedBusinessLine: CompanyDashboardBusinessLine;
  selectedRangeLabel: DateRangeLabel;
}) {
  return (
    <div className="company-dashboard-controls">
      <select
        aria-label="Revenue center"
        className="company-revenue-select"
        disabled={isLoading}
        onChange={(event) => void onSelectBusinessLine(event.target.value as CompanyDashboardBusinessLine)}
        value={selectedBusinessLine}
      >
        {(["all", "stem", "grw"] as const).map((businessLine) => (
          <option key={businessLine} value={businessLine}>
            {revenueCenterOptionLabel(businessLine)}
          </option>
        ))}
      </select>
      <div className="company-date-controls" aria-label="Custom date range">
        <select
          aria-label="Date range preset"
          className="company-range-select"
          disabled={isLoading}
          onChange={(event) => onSelectDateRange(event.target.value as DateRangeLabel)}
          value={selectedRangeLabel}
        >
          {DATE_RANGE_LABELS.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
        <input
          aria-label="From date"
          type="date"
          value={dateFrom}
          onChange={(event) => onDateFromChange(event.target.value)}
        />
        <input
          aria-label="To date"
          type="date"
          value={dateTo}
          onChange={(event) => onDateToChange(event.target.value)}
        />
        <button className="button button-tiny button-outline" onClick={() => void onApplyCustomRange()} disabled={isLoading} type="button">
          Apply
        </button>
      </div>
    </div>
  );
}

function BusinessLineSplit({
  activeBusinessLine,
  isLoading,
  onSelectBusinessLine,
  rows
}: {
  activeBusinessLine: CompanyDashboardBusinessLine;
  isLoading: boolean;
  onSelectBusinessLine: (businessLine: CompanyDashboardBusinessLine) => void;
  rows: CompanyDashboardData["businessLineSummaries"];
}) {
  const totalNetSales = rows.reduce((sum, row) => sum + row.netSales, 0);
  return (
    <section className="business-line-split" aria-label="Business line split">
      <div className="business-line-split-header">
        <div>
          <h2>Business Line Split</h2>
          <p>Stem Core vs GRW Broker</p>
        </div>
      </div>
      <div className="business-line-split-rows">
        {rows.map((row) => (
          <button
            key={row.key}
            className={activeBusinessLine === row.key ? "business-line-row active" : "business-line-row"}
            disabled={isLoading}
            onClick={() => void onSelectBusinessLine(row.key)}
            type="button"
          >
            <span>{row.label}</span>
            <strong>{isLoading && totalNetSales === 0 ? "Calculating..." : currency.format(row.netSales)}</strong>
            <small>
              GP {formatPercent(row.grossProfitPercent)} · Share {percent.format(row.salesShare)}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function DashboardMetric({
  detail,
  helpText,
  label,
  meta,
  tone,
  value
}: {
  detail: string;
  helpText: string;
  label: string;
  meta?: string;
  tone?: "up" | "down" | "flat" | null;
  value: string;
}) {
  const className = tone ? `company-kpi company-kpi-${tone}` : "company-kpi";
  return (
    <div className={className}>
      <div className="company-kpi-label-row">
        <span>{label}</span>
        <span className="company-kpi-help" tabIndex={0} aria-label={helpText}>
          i
          <span className="company-kpi-tooltip" role="tooltip">
            {helpText}
          </span>
        </span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
      {meta ? <em>{meta}</em> : null}
    </div>
  );
}

function SortableHeader({
  helpText,
  label,
  numeric,
  onSort,
  sort,
  sortKey
}: {
  helpText?: string;
  label: string;
  numeric?: boolean;
  onSort: (sort: SortState) => void;
  sort: SortState;
  sortKey: SortKey;
}) {
  const active = sort.key === sortKey;
  const nextDirection = active ? (sort.direction === "asc" ? "desc" : "asc") : sortKey === "label" ? "asc" : "desc";
  return (
    <th className={numeric ? "numeric" : ""}>
      <button
        className={active ? "company-sort-button active" : "company-sort-button"}
        title={helpText}
        onClick={() => onSort({ key: sortKey, direction: nextDirection })}
        type="button"
      >
        {label}
        <span>{active ? (sort.direction === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

function SummaryRow({
  onSelect,
  row,
  selected,
  showProfitLoading
}: {
  onSelect?: () => void;
  row: QuickBooksSalesSummaryRow;
  selected?: boolean;
  showProfitLoading?: boolean;
}) {
  return (
    <tr className={selected ? "is-selected" : ""}>
      <td>
        {onSelect ? (
          <button className="company-drilldown-button" onClick={onSelect} type="button">
            {row.label}
          </button>
        ) : (
          row.label
        )}
      </td>
      <td className="numeric">{currency.format(row.invoiceSales)}</td>
      <td className="numeric negative">{currency.format(row.creditMemos)}</td>
      <td className={row.netSales < 0 ? "numeric negative" : "numeric"}>{currency.format(row.netSales)}</td>
      <td className="numeric">{formatRowProfitPercent(row, showProfitLoading)}</td>
      <td className="numeric">{formatSampleCost(row.sampleCost)}</td>
      <td className="numeric">{number.format(row.invoiceCount)}</td>
    </tr>
  );
}

async function loadCompanyDashboard({
  businessLine,
  dateFrom,
  dateTo,
  includeProfit,
  period,
  rep
}: {
  businessLine?: CompanyDashboardBusinessLine;
  dateFrom?: string;
  dateTo?: string;
  includeProfit?: boolean;
  period?: CompanyDashboardPeriod;
  rep?: string;
}) {
  const params = new URLSearchParams();
  if (dateFrom && dateTo) {
    params.set("from", dateFrom);
    params.set("to", dateTo);
  } else if (period) {
    params.set("period", period);
  }
  if (includeProfit === false) params.set("includeProfit", "false");
  if (businessLine && businessLine !== "all") params.set("businessLine", businessLine);
  if (rep) params.set("rep", rep);
  const response = await fetch(`/api/company-dashboard?${params.toString()}`);
  const result = (await response.json()) as CompanyDashboardData | { error?: string };
  if (!response.ok || "error" in result) {
    throw new Error("error" in result && result.error ? result.error : "Could not load company dashboard.");
  }
  return result as CompanyDashboardData;
}

function cacheKey(data: CompanyDashboardData) {
  return cacheKeyFor(data.period, data.dateFrom, data.dateTo, data.businessLine);
}

function cacheKeyFor(
  period: CompanyDashboardPeriod,
  dateFrom: string,
  dateTo: string,
  businessLine: CompanyDashboardBusinessLine
) {
  const rangeKey = period === "custom" ? customKey(dateFrom, dateTo) : period;
  return `${businessLine}:${rangeKey}`;
}

function customKey(dateFrom: string, dateTo: string) {
  return `custom:${dateFrom}:${dateTo}`;
}

function dashboardLoadingStatus({
  isDrilldownLoading,
  isLoading,
  isProfitLoading
}: {
  isDrilldownLoading: boolean;
  isLoading: boolean;
  isProfitLoading: boolean;
}) {
  if (isLoading) {
    return {
      message: "Refreshing dashboard",
      detail: "Loading sales first, then GP follows."
    };
  }
  if (isDrilldownLoading) {
    return {
      message: "Loading rep accounts",
      detail: "Filtering accounts for the selected rep."
    };
  }
  if (isProfitLoading) {
    return {
      message: "Calculating GP",
      detail: "Blending QuickBooks costs with Vinosmith billbacks."
    };
  }
  return null;
}

function labelForInitialPeriod(period: CompanyDashboardPeriod): DateRangeLabel {
  if (period === "mtd") return "This Month-to-date";
  if (period === "ytd") return "This Year-to-date";
  if (period === "previous-day") return "Yesterday";
  return CUSTOM_RANGE_LABEL;
}

function dateRangeForLabel(label: DateRangeLabel): { dateFrom: string; dateTo: string; period?: CompanyDashboardPeriod } {
  const today = startOfDay(new Date());
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const currentMonthStart = startOfMonth(today);
  const currentMonthEnd = endOfMonth(today);
  const previousMonthDate = addMonths(today, -1);
  const previousMonthStart = startOfMonth(previousMonthDate);
  const previousMonthEnd = endOfMonth(previousMonthDate);
  const currentQuarterStart = startOfQuarter(today);
  const currentQuarterEnd = endOfQuarter(today);
  const previousQuarterDate = addMonths(today, -3);
  const previousQuarterStart = startOfQuarter(previousQuarterDate);
  const previousQuarterEnd = endOfQuarter(previousQuarterDate);
  const currentYearStart = startOfYear(today);
  const currentYearEnd = endOfYear(today);
  const lastYearDate = addYears(today, -1);
  const lastYearStart = startOfYear(lastYearDate);
  const lastYearEnd = endOfYear(lastYearDate);

  if (label === "Today") return isoRange(today, today);
  if (label === "Tomorrow") return isoRange(tomorrow, tomorrow);
  if (label === "Yesterday") return { ...isoRange(yesterday, yesterday), period: "previous-day" };
  if (label === "This Week") return isoRange(startOfWeek(today), endOfWeek(today));
  if (label === "This Week-to-date") return isoRange(startOfWeek(today), today);
  if (label === "This Month") return isoRange(currentMonthStart, currentMonthEnd);
  if (label === "This Month-to-date") return { ...isoRange(currentMonthStart, today), period: "mtd" };
  if (label === "This Month: 1st Half (1 - 15)") return isoRange(currentMonthStart, dayOfMonth(today, 15));
  if (label === "This Month: 2nd Half (16 - End)") return isoRange(dayOfMonth(today, 16), currentMonthEnd);
  if (label === "This Quarter") return isoRange(currentQuarterStart, currentQuarterEnd);
  if (label === "This Quarter-to-date") return isoRange(currentQuarterStart, today);
  if (label === "This Year") return isoRange(currentYearStart, currentYearEnd);
  if (label === "This Year-to-date") return { ...isoRange(currentYearStart, today), period: "ytd" };
  if (label === "This Year-to-last-month") return isoRange(currentYearStart, previousMonthEnd);
  if (label === "Last Week") return isoRange(addDays(startOfWeek(today), -7), addDays(endOfWeek(today), -7));
  if (label === "Last Week-to-date") return isoRange(addDays(startOfWeek(today), -7), addDays(today, -7));
  if (label === "Last Month") return isoRange(previousMonthStart, previousMonthEnd);
  if (label === "Last Month-to-date") return isoRange(previousMonthStart, clampDay(previousMonthStart, today.getDate()));
  if (label === "Last Month: 1st Half (1 - 15)") return isoRange(previousMonthStart, dayOfMonth(previousMonthStart, 15));
  if (label === "Last Month: 2nd Half (16 - End)") return isoRange(dayOfMonth(previousMonthStart, 16), previousMonthEnd);
  if (label === "Last Quarter") return isoRange(previousQuarterStart, previousQuarterEnd);
  if (label === "Last Quarter-to-date") return isoRange(previousQuarterStart, clampElapsedDate(previousQuarterStart, today, previousQuarterEnd));
  if (label === "Last Year - This Month") return isoRange(startOfMonth(lastYearDate), endOfMonth(lastYearDate));
  if (label === "Last Year - Next Month") {
    const nextMonthLastYear = addMonths(lastYearDate, 1);
    return isoRange(startOfMonth(nextMonthLastYear), endOfMonth(nextMonthLastYear));
  }
  if (label === "Last Year - Last Month") {
    const previousMonthLastYear = addMonths(lastYearDate, -1);
    return isoRange(startOfMonth(previousMonthLastYear), endOfMonth(previousMonthLastYear));
  }
  if (label === "Last Year: Beginning of Year - Today") return isoRange(lastYearStart, lastYearDate);
  if (label === "Last Year: Beginning of Year to Last Month") return isoRange(lastYearStart, endOfMonth(addMonths(lastYearDate, -1)));
  if (label === "Last Year: This Month-to-Date") return isoRange(startOfMonth(lastYearDate), lastYearDate);
  if (label === "Last Year") return isoRange(lastYearStart, lastYearEnd);
  if (label === "Last Year-to-date") return isoRange(lastYearStart, lastYearDate);
  if (label === "Last Year - Since 365 Days Ago") return isoRange(lastYearStart, addDays(today, -365));
  if (label === "2 Days Ago") return isoRange(addDays(today, -2), addDays(today, -2));
  if (label === "Since 2 Days Ago") return isoRange(addDays(today, -2), today);
  if (label === "Since 7 Days Ago") return isoRange(addDays(today, -7), today);
  if (label === "Since 30 Days Ago") return isoRange(addDays(today, -30), today);
  if (label === "Since 60 Days Ago") return isoRange(addDays(today, -60), today);
  if (label === "Since 90 Days Ago") return isoRange(addDays(today, -90), today);
  if (label === "Since 365 Days Ago") return isoRange(addDays(today, -365), today);
  return isoRange(today, today);
}

function isoRange(from: Date, to: Date) {
  return { dateFrom: toIsoDate(from), dateTo: toIsoDate(to) };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number) {
  const nextDate = new Date(date.getFullYear(), date.getMonth() + months, 1);
  return clampDay(nextDate, date.getDate());
}

function addYears(date: Date, years: number) {
  return clampDay(new Date(date.getFullYear() + years, date.getMonth(), 1), date.getDate());
}

function startOfWeek(date: Date) {
  return addDays(date, -date.getDay());
}

function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function dayOfMonth(date: Date, day: number) {
  return clampDay(startOfMonth(date), day);
}

function clampDay(monthDate: Date, day: number) {
  const monthEnd = endOfMonth(monthDate).getDate();
  return new Date(monthDate.getFullYear(), monthDate.getMonth(), Math.min(day, monthEnd));
}

function startOfQuarter(date: Date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

function endOfQuarter(date: Date) {
  const quarterStart = startOfQuarter(date);
  return new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
}

function clampElapsedDate(rangeStart: Date, elapsedFrom: Date, rangeEnd: Date) {
  const elapsedDays = Math.floor((elapsedFrom.getTime() - startOfQuarter(elapsedFrom).getTime()) / 86400000);
  const target = addDays(rangeStart, elapsedDays);
  return target > rangeEnd ? rangeEnd : target;
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sortSummaryRows(rows: QuickBooksSalesSummaryRow[], sort: SortState) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const direction = sort.direction === "asc" ? 1 : -1;
    if (sort.key === "label") return a.label.localeCompare(b.label) * direction;
    const aValue = valueForSort(a, sort.key);
    const bValue = valueForSort(b, sort.key);
    return (aValue - bValue) * direction;
  });
  return sorted;
}

function valueForSort(row: QuickBooksSalesSummaryRow, key: SortKey) {
  if (key === "gross") return row.invoiceSales;
  if (key === "credits") return row.creditMemos;
  if (key === "gp") return row.grossProfitPercent ?? Number.NEGATIVE_INFINITY;
  if (key === "samples") return row.sampleCost ?? 0;
  if (key === "invoices") return row.invoiceCount;
  return row.netSales;
}

function changeRate(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

function toneFor(value: number | null) {
  if (value === null) return null;
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function salesComparisonLabel(period: CompanyDashboardPeriod) {
  if (period === "mtd") return "Sales vs LY MTD";
  if (period === "ytd") return "Sales vs LY YTD";
  return "Sales vs LY Range";
}

function gpComparisonLabel(period: CompanyDashboardPeriod) {
  if (period === "mtd") return "GP vs LY MTD";
  if (period === "ytd") return "GP vs LY YTD";
  return "GP vs LY Range";
}

function formatSignedCurrency(value: number | null) {
  if (value === null) return "-";
  const formatted = currency.format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatSampleCost(value: number | null | undefined) {
  if (!value) return "-";
  return currency.format(value);
}

function formatSignedPercent(value: number | null) {
  if (value === null) return "New activity";
  if (value > 0) return `+${percent.format(value)}`;
  if (value < 0) return `-${percent.format(Math.abs(value))}`;
  return percent.format(0);
}

function formatSignedPoints(value: number | null) {
  if (value === null) return "-";
  const points = Math.abs(value * 100).toFixed(1);
  if (value > 0) return `+${points} pts`;
  if (value < 0) return `-${points} pts`;
  return "0.0 pts";
}

function formatPercent(value: number | null) {
  return value === null ? "-" : percent.format(value);
}

function formatRowProfitPercent(row: QuickBooksSalesSummaryRow, showProfitLoading?: boolean) {
  if (showProfitLoading) return "Calculating...";
  return row.grossProfitPercent === null || row.grossProfitPercent === undefined ? "-" : percent.format(row.grossProfitPercent);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("month")} ${part("day")}, ${part("year")}`;
}

function formatDateRange(from: string | null, to: string | null) {
  if (!from && !to) return "-";
  if (from === to) return formatDate(from);
  return `${formatDate(from)} - ${formatDate(to)}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("month")} ${part("day")}, ${part("hour")}:${part("minute")} ${part("dayPeriod")}`;
}

function businessLineLabel(businessLine: CompanyDashboardBusinessLine) {
  if (businessLine === "grw") return "GRW";
  if (businessLine === "stem") return "Stem";
  return "All";
}

function compactDashboardPeriodLabel(label: string) {
  return label
    .replaceAll("This Month-to-date", "MTD")
    .replaceAll("This Month-To-Date", "MTD")
    .replaceAll("Last Month-to-date", "Last MTD")
    .replaceAll("Last Month-To-Date", "Last MTD")
    .replaceAll("Month-to-date", "MTD")
    .replaceAll("Month-To-Date", "MTD");
}

function revenueCenterOptionLabel(businessLine: CompanyDashboardBusinessLine) {
  if (businessLine === "grw") return "GRW Broker";
  if (businessLine === "stem") return "Stem Core";
  return "All Revenue";
}
