import type { CompanyDashboardData } from "./company-dashboard-data";

export function dashboardBreakdownLoaded(data: CompanyDashboardData, kind: "rep" | "account") {
  return (kind === "rep" ? data.repBreakdownLoaded : data.accountBreakdownLoaded) ?? data.breakdownsLoaded;
}

// A late summary request must not erase a completed drilldown, or combine generations.
export function mergeDashboardSnapshot(previous: CompanyDashboardData | undefined, incoming: CompanyDashboardData): CompanyDashboardData {
  if (!previous || incoming.sourceVersion === undefined || previous.sourceVersion !== incoming.sourceVersion
    || previous.dateFrom !== incoming.dateFrom || previous.dateTo !== incoming.dateTo
    || previous.businessLine !== incoming.businessLine || previous.selectedRep !== incoming.selectedRep) return incoming;
  const repBreakdownLoaded = dashboardBreakdownLoaded(incoming, "rep") || dashboardBreakdownLoaded(previous, "rep");
  const accountBreakdownLoaded = dashboardBreakdownLoaded(incoming, "account") || dashboardBreakdownLoaded(previous, "account");
  return {
    ...incoming,
    comparison: incoming.comparison || previous.comparison,
    breakdownsLoaded: repBreakdownLoaded && accountBreakdownLoaded,
    repBreakdownLoaded,
    accountBreakdownLoaded,
    byRep: dashboardBreakdownLoaded(incoming, "rep") ? incoming.byRep : previous.byRep,
    byAccount: dashboardBreakdownLoaded(incoming, "account") ? incoming.byAccount : previous.byAccount
  };
}
