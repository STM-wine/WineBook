import Link from "next/link";
import type React from "react";
import { AppTopbar } from "@/components/app-topbar";
import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";

const SETTINGS_NAV = [
  { href: "/settings", label: "Overview" },
  { href: "/settings/logic", label: "Logic Settings" },
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
          <nav>
            {SETTINGS_NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <section className="settings-content">{children}</section>
      </div>
    </main>
  );
}
