"use client";

import Link from "next/link";
import { AppUserMenu } from "./app-user-menu";
import { ActiveView, DEFAULT_VIEW, VIEW_LABELS } from "./dashboard-types";

type AppTopbarProps = {
  activeModule?: "grw-converter" | "supplier-offer-compiler" | "settings";
  activeView?: ActiveView;
  canViewSettings?: boolean;
  dataLabel?: string;
  dataTitle?: string;
  qbDataLabel?: string | null;
  qbDataTitle?: string;
  isPending?: boolean;
  onCreateDrafts?: () => void;
  onRefreshReports?: () => void;
  onSelectView?: (view: ActiveView) => void;
};

function viewHref(view: ActiveView) {
  return view === DEFAULT_VIEW ? "/" : "/?view=" + view;
}

const HOME_VIEW: ActiveView = "company-dashboard";
const SALES_VIEW: ActiveView = "sales-dashboard";
const ORDERING_VIEWS: ActiveView[] = ["product-workspace", "order-review", "po-drafts", "supplier-hub", "freight", "quickbooks-items"];

export function AppTopbar({
  activeModule,
  activeView,
  canViewSettings,
  dataLabel,
  dataTitle,
  qbDataLabel,
  qbDataTitle,
  isPending,
  onCreateDrafts,
  onRefreshReports,
  onSelectView
}: AppTopbarProps) {
  const orderingViews = VIEW_LABELS.filter(
    (view) => ORDERING_VIEWS.includes(view.id) && !view.hidden && (!view.requiresSettings || canViewSettings)
  );
  const isOrderingActive = Boolean(activeView && ORDERING_VIEWS.includes(activeView));
  const brandContent = (
    <div className="brand-mark">
      <img alt="Stem home" src="/brand/stem-intelligence-logo-cropped.png" />
    </div>
  );

  return (
    <header className="topbar">
      {onSelectView ? (
        <button className="brand brand-home-button" onClick={() => onSelectView(DEFAULT_VIEW)} type="button">
          {brandContent}
        </button>
      ) : (
        <Link className="brand brand-home-button" href="/">
          {brandContent}
        </Link>
      )}
      <nav className="nav-tabs" aria-label="Primary">
        <TopbarViewLink activeView={activeView} label="Home" onSelectView={onSelectView} view={HOME_VIEW} />
        <TopbarViewLink activeView={activeView} label="Sales" onSelectView={onSelectView} view={SALES_VIEW} />
        <div className="nav-dropdown">
          {onSelectView ? (
            <button
              className={isOrderingActive ? "nav-dropdown-trigger active" : "nav-dropdown-trigger"}
              onClick={() => onSelectView("product-workspace")}
              type="button"
              aria-haspopup="menu"
            >
              Products
            </button>
          ) : (
            <Link className={isOrderingActive ? "nav-dropdown-trigger active" : "nav-dropdown-trigger"} href="/products" aria-haspopup="menu">
              Products
            </Link>
          )}
          <div className="nav-dropdown-menu" role="menu">
            {orderingViews.map((view) =>
              onSelectView ? (
                <button
                  key={view.id}
                  className={activeView === view.id ? "active" : ""}
                  onClick={() => onSelectView(view.id)}
                  type="button"
                  role="menuitem"
                >
                  {view.label}
                </button>
              ) : (
                <Link key={view.id} className={activeView === view.id ? "active" : ""} href={viewHref(view.id)} role="menuitem">
                  {view.label}
                </Link>
              )
            )}
          </div>
        </div>
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
        <div className="topbar-context-controls" id="topbar-context-controls" />
        {dataLabel ? (
          <span className="data-pill source-data-pill" title={dataTitle}>
            {dataLabel}
          </span>
        ) : null}
        {qbDataLabel ? (
          <span className="data-pill source-data-pill source-data-pill-qb" title={qbDataTitle}>
            {qbDataLabel}
          </span>
        ) : null}
        {onRefreshReports ? (
          <button className="button button-small button-outline" onClick={onRefreshReports} disabled={isPending} type="button">
            Refresh Reports
          </button>
        ) : null}
        {onCreateDrafts ? (
          <button className="button button-small" onClick={onCreateDrafts} disabled={isPending} type="button">
            Create PO Drafts
          </button>
        ) : null}
        <AppUserMenu canViewSettings={canViewSettings} isSettingsActive={activeModule === "settings"} />
      </div>
    </header>
  );
}

function TopbarViewLink({
  activeView,
  label,
  onSelectView,
  view
}: {
  activeView?: ActiveView;
  label: string;
  onSelectView?: (view: ActiveView) => void;
  view: ActiveView;
}) {
  if (onSelectView) {
    return (
      <button className={activeView === view ? "active" : ""} onClick={() => onSelectView(view)} type="button">
        {label}
      </button>
    );
  }

  return (
    <Link className={activeView === view ? "active" : ""} href={viewHref(view)}>
      {label}
    </Link>
  );
}
