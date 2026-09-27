import type { CompanyDashboardData } from "./company-dashboard-data";

// A late summary request must not erase a completed drilldown, or combine generations.
export function mergeDashboardSnapshot(previous: CompanyDashboardData | undefined, incoming: CompanyDashboardData): CompanyDashboardData {
  if (!previous || incoming.sourceVersion === undefined || previous.sourceVersion !== incoming.sourceVersion
    || previous.dateFrom !== incoming.dateFrom || previous.dateTo !== incoming.dateTo
    || previous.businessLine !== incoming.businessLine || previous.selectedRep !== incoming.selectedRep) return incoming;
  return {
    ...incoming,
    comparison: incoming.comparison || previous.comparison,
    breakdownsLoaded: incoming.breakdownsLoaded || previous.breakdownsLoaded,
    byRep: incoming.breakdownsLoaded ? incoming.byRep : previous.byRep,
    byAccount: incoming.breakdownsLoaded ? incoming.byAccount : previous.byAccount
  };
}
