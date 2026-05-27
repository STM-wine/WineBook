"use client";

import Link from "next/link";
import { ActiveView, NAV_VIEW_LABELS } from "./dashboard-types";
import { SignOutButton } from "./sign-out-button";

type AppTopbarProps = {
  activeModule?: "grw-converter";
  activeView?: ActiveView;
  dataDate?: string;
  isPending?: boolean;
  profileLabel: string;
  onCreateDrafts?: () => void;
  onSelectView?: (view: ActiveView) => void;
};

function viewHref(view: ActiveView) {
  return view === "order-review" ? "/" : `/?view=${view}`;
}

export function AppTopbar({
  activeModule,
  activeView,
  dataDate,
  isPending,
  profileLabel,
  onCreateDrafts,
  onSelectView
}: AppTopbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <img alt="" src="/brand/stem-intelligence-logo-cropped.png" />
        </div>
        <div>
          <strong>Stem Intelligence</strong>
          <span>{profileLabel}</span>
        </div>
      </div>
      <nav className="nav-tabs" aria-label="Primary">
        {NAV_VIEW_LABELS.map((view) =>
          onSelectView ? (
            <button
              key={view.id}
              className={activeView === view.id ? "active" : ""}
              onClick={() => onSelectView(view.id)}
              type="button"
            >
              {view.label}
            </button>
          ) : (
            <Link key={view.id} className={activeView === view.id ? "active" : ""} href={viewHref(view.id)}>
              {view.label}
            </Link>
          )
        )}
        <div className="nav-dropdown">
          <button
            className={activeModule === "grw-converter" ? "nav-dropdown-trigger active" : "nav-dropdown-trigger"}
            type="button"
            aria-haspopup="menu"
          >
            Modules
          </button>
          <div className="nav-dropdown-menu" role="menu">
            <Link href="/modules/grw-converter" role="menuitem">
              GRW Converter
            </Link>
          </div>
        </div>
      </nav>
      <div className="topbar-actions">
        {dataDate ? <span className="data-pill">Data Date {dataDate}</span> : null}
        {onCreateDrafts ? (
          <button className="button button-small" onClick={onCreateDrafts} disabled={isPending}>
            Create PO Drafts
          </button>
        ) : null}
        <SignOutButton />
      </div>
    </header>
  );
}
