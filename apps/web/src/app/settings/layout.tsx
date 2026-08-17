import type React from "react";
import { AppTopbar } from "@/components/app-topbar";
import { SettingsNavigation } from "@/components/settings-navigation";
import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";

const SETTINGS_NAV = [
  { href: "/settings", label: "Overview" },
  { href: "/settings/data-sync", label: "Data Health" },
  { href: "/settings/logic", label: "Logic Settings" },
  { href: "/settings/gross-profit-center", label: "Gross Profit Center" },
  { href: "/settings/laid-in-coverage", label: "Laid-In Coverage" },
  { href: "/settings/requests", label: "Change Requests" },
  { href: "/settings/access", label: "User Access" },
  { href: "/settings/suppliers", label: "Supplier Settings" },
  { href: "/settings/history", label: "History" }
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const context = await getAppContext();
  if ("pendingEmail" in context) {
    return <AccountPending email={context.pendingEmail} />;
  }

  if (!hasPermission(context.permissions, "view_settings")) {
    return (
      <main className="app-shell settings-shell">
        <AppTopbar activeModule="settings" />
        <section className="empty-state">
          <p className="eyebrow">Settings</p>
          <h1>Settings access required</h1>
          <p className="muted">Your account is enabled, but it does not have Settings access.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell settings-shell">
      <AppTopbar activeModule="settings" canViewSettings />
      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="Settings sections">
          <p className="eyebrow">Settings</p>
          <SettingsNavigation items={SETTINGS_NAV} />
        </aside>
        <section className="settings-content">{children}</section>
      </div>
    </main>
  );
}
