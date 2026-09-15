"use client";

import type { CompanyDashboardData } from "@/lib/company-dashboard-data";
import { AppTopbar } from "./app-topbar";
import { CompanyDashboardView } from "./company-dashboard-view";

type CompanyHomeProps = {
  companyDashboard: CompanyDashboardData;
  canViewSettings?: boolean;
};

export function CompanyHome({ companyDashboard, canViewSettings }: CompanyHomeProps) {
  return (
    <main className="app-shell">
      <AppTopbar activeView="company-dashboard" canViewSettings={canViewSettings} />
      <CompanyDashboardView initialData={companyDashboard} />
    </main>
  );
}
