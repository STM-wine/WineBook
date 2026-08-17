"use client";

import { useEffect, useMemo, useState } from "react";
import { asNumber, formatCurrency, formatInteger } from "@/lib/order-data";
import type { ProductWorkspaceResponse, ProductWorkspaceRow, ProductWorkspaceStatusKey } from "@/lib/product-workspace-types";
import { MetricCard } from "./metric-card";
import { QuickBooksItemMasterView } from "./quickbooks-item-master-view";

type LoadState =
  | { status: "loading"; data: null; error: null }
  | { status: "loaded"; data: ProductWorkspaceResponse; error: null }
  | { status: "error"; data: null; error: string };

type SortKey =
  | "itemCode"
  | "productName"
  | "vintage"
  | "pack"
  | "supplierName"
  | "revenueCenter"
  | "fob"
  | "laidIn"
  | "landedCost"
  | "frontline"
  | "bestPrice"
  | "averageGpPercent"
  | "active"
  | "sourceHealth";

const SOURCE_LABELS: Record<string, string> = {
  quickbooks: "QB",
  vinosmith: "VS",
  supplier_hub: "Supplier Hub",
  stem: "Stem"
};

const STATUS_FILTERS: Array<{ label: string; value: "All" | "gaps" | ProductWorkspaceStatusKey }> = [
  { label: "All", value: "All" },
  { label: "Status gaps", value: "gaps" },
  { label: "QB active / VS inactive", value: "qb_active_vs_inactive" },
  { label: "QB active / no VS", value: "qb_active_vs_missing" },
  { label: "QB inactive / VS active", value: "qb_inactive_vs_active" },
  { label: "VS active / no QB", value: "vs_active_qb_missing" },
  { label: "Active match", value: "active_match" },
  { label: "Inactive match", value: "inactive_match" }
];

export function ProductWorkspaceView({ canViewDiagnostics }: { canViewDiagnostics?: boolean }) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "loading", data: null, error: null });

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      setState({ status: "loading", data: null, error: null });
      try {
        const params = new URLSearchParams();
        if (includeInactive) params.set("includeInactive", "true");
        const response = await fetch(`/api/products/workspace${params.size ? `?${params}` : ""}`, { cache: "no-store" });
        const body = await response.json().catch(() => null) as ProductWorkspaceResponse | { error?: string } | null;

        if (!response.ok) {
          throw new Error(body && "error" in body && body.error ? body.error : "Could not load Product Workspace.");
        }
        if (!body || !("rows" in body)) {
          throw new Error("Product Workspace response was incomplete.");
        }
        if (!cancelled) {
          setState({ status: "loaded", data: body, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Could not load Product Workspace."
          });
        }
      }
    }

    loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, [includeInactive]);

  if (diagnosticsOpen && canViewDiagnostics) {
    return (
      <>
        <section className="panel product-workspace-header">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Products / Items</p>
              <h1>QuickBooks Item Diagnostics</h1>
              <p>Read-only health checks preserved from the existing item master view.</p>
            </div>
            <button className="button button-outline button-small" onClick={() => setDiagnosticsOpen(false)} type="button">
              Back to Workspace
            </button>
          </div>
        </section>
        <QuickBooksItemMasterView />
      </>
    );
  }

  if (state.status === "loading") {
    return (
      <section className="panel product-workspace-header">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Products / Items</p>
            <h1>Product Workspace</h1>
            <p>Loading active products...</p>
          </div>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="panel product-workspace-header">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Products / Items</p>
            <h1>Product Workspace</h1>
            <p>{state.error}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <ProductWorkspaceTable
      canViewDiagnostics={canViewDiagnostics}
      data={state.data}
      includeInactive={includeInactive}
      onOpenDiagnostics={() => setDiagnosticsOpen(true)}
      onSetIncludeInactive={setIncludeInactive}
    />
  );
}

function ProductWorkspaceTable({
  canViewDiagnostics,
  data,
  includeInactive,
  onOpenDiagnostics,
  onSetIncludeInactive
}: {
  canViewDiagnostics?: boolean;
  data: ProductWorkspaceResponse;
  includeInactive: boolean;
  onOpenDiagnostics: () => void;
  onSetIncludeInactive: (value: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"All" | "gaps" | ProductWorkspaceStatusKey>("All");
  const [health, setHealth] = useState("All");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "productName", direction: "asc" });
  const [selectedId, setSelectedId] = useState<string | null>(data.rows[0]?.id || null);
  const supplierOptions = useMemo(
    () => ["All", ...Array.from(new Set(data.rows.map((row) => row.supplierName || "Unknown").sort((a, b) => a.localeCompare(b))))],
    [data.rows]
  );
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...data.rows]
      .filter((row) => {
        if (supplier !== "All" && (row.supplierName || "Unknown") !== supplier) return false;
        if (statusFilter === "gaps" && !isLifecycleMismatch(row.statusKey)) return false;
        if (statusFilter !== "All" && statusFilter !== "gaps" && row.statusKey !== statusFilter) return false;
        if (health !== "All" && row.sourceHealth !== health) return false;
        if (!query) return true;
        return [
          row.itemCode,
          row.productName,
          row.brand,
          row.vintage,
          row.pack,
          row.supplierName,
          row.quickbooks.fullName
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((a, b) => compareRows(a, b, sort.key, sort.direction));
  }, [data.rows, health, search, sort, statusFilter, supplier]);
  const selectedRow = visibleRows.find((row) => row.id === selectedId) || visibleRows[0] || null;

  useEffect(() => {
    if (selectedRow && selectedRow.id !== selectedId) {
      setSelectedId(selectedRow.id);
    }
  }, [selectedId, selectedRow]);

  function changeSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  }

  return (
    <>
      <section className="metric-grid product-workspace-metrics">
        <MetricCard label="Visible Items" value={formatInteger(data.summary.visible)} detail={includeInactive ? "Active and inactive" : "Active plus status gaps"} tone="ink" />
        <MetricCard label="Active" value={formatInteger(data.summary.active)} detail="QuickBooks active items" tone="green" />
        <MetricCard label="Inactive" value={formatInteger(data.summary.inactive)} detail="Available when included" tone="gold" />
        <MetricCard label="Status Gaps" value={formatInteger(data.summary.lifecycleMismatches)} detail="QB and VS do not match" tone={data.summary.lifecycleMismatches ? "red" : "green"} />
        <MetricCard label="Ready" value={formatInteger(data.summary.ready)} detail="Cost and price sources present" tone="blue" />
        <MetricCard label="Needs Review" value={formatInteger(data.summary.needsReview)} detail="Missing core source data" tone={data.summary.needsReview ? "red" : "green"} />
      </section>

      <section className="panel product-workspace-header">
        <div className="section-heading product-workspace-titlebar">
          <div>
            <p className="eyebrow">Products / Items</p>
            <h1>Product Workspace</h1>
            <p>Read-only table using QuickBooks FOB, Supplier Logistics laid-in, and matched Vinosmith or Supplier Hub prices where available.</p>
          </div>
          <div className="product-workspace-actions">
            {canViewDiagnostics ? (
              <button className="button button-outline button-small" onClick={onOpenDiagnostics} type="button">
                QB Diagnostics
              </button>
            ) : null}
          </div>
        </div>

        <div className="product-workspace-controls">
          <label className="field-control product-search">
            <span>Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={includeInactive ? "Search active and inactive products" : "Search active products"}
            />
          </label>
          <label className="field-control">
            <span>Supplier</span>
            <select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
              {supplierOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="field-control">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="field-control">
            <span>Source health</span>
            <select value={health} onChange={(event) => setHealth(event.target.value)}>
              <option>All</option>
              <option value="ready">Ready</option>
              <option value="partial">Partial</option>
              <option value="needs_review">Needs review</option>
            </select>
          </label>
          <label className="toggle-control" title="Active QuickBooks products stay the default. Enable this only for inactive lookup.">
            <input checked={includeInactive} onChange={(event) => onSetIncludeInactive(event.target.checked)} type="checkbox" />
            <span>Include inactive</span>
          </label>
        </div>

        <div className="product-workspace-layout">
          <div className="table-shell product-workspace-table">
            <table>
              <colgroup>
                <col className="product-col-code" />
                <col className="product-col-name" />
                <col className="product-col-vintage" />
                <col className="product-col-pack" />
                <col className="product-col-supplier" />
                <col className="product-col-revenue" />
                <col className="product-col-money" />
                <col className="product-col-money" />
                <col className="product-col-money" />
                <col className="product-col-money-wide" />
                <col className="product-col-money" />
                <col className="product-col-gp" />
                <col className="product-col-status" />
                <col className="product-col-health" />
              </colgroup>
              <thead>
                <tr>
                  <SortableHeader label="Item #" sortKey="itemCode" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Product / brand" sortKey="productName" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Vintage" sortKey="vintage" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Pack" sortKey="pack" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Supplier" sortKey="supplierName" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Revenue" sortKey="revenueCenter" sort={sort} onSort={changeSort} />
                  <SortableHeader label="FOB" sortKey="fob" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Laid-in" sortKey="laidIn" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Landed" sortKey="landedCost" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Frontline" sortKey="frontline" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Best" sortKey="bestPrice" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Avg GP" sortKey="averageGpPercent" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Status" sortKey="active" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Source" sortKey="sourceHealth" sort={sort} onSort={changeSort} />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.id}
                    className={selectedRow?.id === row.id ? "selected" : ""}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <td className="mono-cell">{row.itemCode}</td>
                    <td>
                      <strong>{row.productName}</strong>
                      <small>{row.brand || "Brand not matched"}</small>
                    </td>
                    <td>{row.vintage || "-"}</td>
                    <td>{row.pack || "-"}</td>
                    <td title={row.supplierSource || "No supplier source matched"}>{row.supplierName || "Unmatched"}</td>
                    <td>{row.revenueCenter}</td>
                    <td title={row.fobSource || "Missing QuickBooks FOB"}>{moneyOrDash(row.fob)}</td>
                    <td title={row.laidInSource || "Missing Supplier Logistics laid-in"}>{moneyOrDash(row.laidIn)}</td>
                    <td>{moneyOrDash(row.landedCost)}</td>
                    <td>{moneyOrDash(row.frontline)}</td>
                    <td>{moneyOrDash(row.bestPrice)}</td>
                    <td>{percentOrDash(row.averageGpPercent)}</td>
                    <td title={row.statusDetail}>{row.statusLabel}</td>
                    <td>
                      <span className={`source-health source-health-${row.sourceHealth}`}>{row.sourceHealthLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ProductWorkspaceDrawer row={selectedRow} />
        </div>
      </section>
    </>
  );
}

function ProductWorkspaceDrawer({ row }: { row: ProductWorkspaceRow | null }) {
  if (!row) {
    return (
      <aside className="product-workspace-drawer">
        <p>No product selected.</p>
      </aside>
    );
  }

  return (
    <aside className="product-workspace-drawer">
      <div>
        <p className="eyebrow">Selected product</p>
        <h2>{row.productName}</h2>
        <span>{row.itemCode}</span>
      </div>
      <div className="source-badge-row">
        {row.sourceBadges.map((source) => (
          <span key={source} className="source-badge">{SOURCE_LABELS[source]}</span>
        ))}
      </div>
      <div className="drawer-section">
        <h3>Overview</h3>
        <dl>
          <div><dt>Supplier</dt><dd>{row.supplierName || "Unmatched"} <small>{row.supplierSource || "No source"}</small></dd></div>
          <div><dt>Vintage</dt><dd>{row.vintage || "-"}</dd></div>
          <div><dt>Pack</dt><dd>{row.pack || "-"}</dd></div>
          <div><dt>Revenue center</dt><dd>{row.revenueCenter}</dd></div>
          <div><dt>Status</dt><dd title={row.statusDetail}>{row.statusLabel}</dd></div>
          <div><dt>Last sold</dt><dd>{row.lastSold || "Not loaded"}</dd></div>
          <div><dt>YTD sales</dt><dd>{row.ytdSales === null ? "Not loaded" : formatInteger(row.ytdSales)}</dd></div>
        </dl>
      </div>
      <div className="drawer-section">
        <h3>Cost Basis</h3>
        <dl>
          <div><dt>FOB</dt><dd title={row.fobSource || undefined}>{moneyOrDash(row.fob)} <small>{row.fobSource || "No QB cost"}</small></dd></div>
          <div><dt>Laid-in</dt><dd title={row.laidInSource || undefined}>{moneyOrDash(row.laidIn)} <small>{row.laidInSource || "No supplier logistics match"}</small></dd></div>
          <div><dt>Landed cost</dt><dd>{moneyOrDash(row.landedCost)}</dd></div>
        </dl>
      </div>
      <div className="drawer-section">
        <h3>Pricing</h3>
        {row.priceLevels.length ? (
          <div className="drawer-price-list">
            {row.priceLevels.slice(0, 6).map((level) => (
              <div key={`${level.source}-${level.id}`}>
                <span>{level.name}</span>
                <strong>{moneyOrDash(level.bottlePrice)}</strong>
                <small>{level.source} / DA {moneyOrDash(level.depletionAllowance)} / GP {percentOrDash(level.calculatedGpPercent)}</small>
              </div>
            ))}
          </div>
        ) : (
          <p>No matched price levels yet.</p>
        )}
      </div>
      <div className="drawer-section">
        <h3>GP Math</h3>
        <p title={row.gpExplanation}>{row.gpExplanation}</p>
      </div>
      <div className="drawer-section">
        <h3>Sources</h3>
        <dl>
          <div><dt>QuickBooks</dt><dd>{row.quickbooks.fullName || row.quickbooks.listId}</dd></div>
          <div><dt>Vinosmith</dt><dd>{row.vinosmith ? `${row.vinosmith.code || "No code"} / ${row.vinosmith.name || "Unnamed"}` : "No match"}</dd></div>
          <div><dt>Supplier Hub</dt><dd>{row.supplierCatalog ? row.supplierCatalog.displayName : "No match"}</dd></div>
        </dl>
      </div>
    </aside>
  );
}

function SortableHeader({
  label,
  sort,
  sortKey,
  onSort
}: {
  label: string;
  sort: { key: SortKey; direction: "asc" | "desc" };
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th>
      <button className="table-sort-button" onClick={() => onSort(sortKey)} type="button">
        {label}
        <span>{active ? (sort.direction === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

function compareRows(a: ProductWorkspaceRow, b: ProductWorkspaceRow, key: SortKey, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  const left = sortValue(a, key);
  const right = sortValue(b, key);
  if (typeof left === "number" && typeof right === "number") return (left - right) * multiplier;
  return String(left).localeCompare(String(right)) * multiplier;
}

function sortValue(row: ProductWorkspaceRow, key: SortKey) {
  const value = row[key];
  if (key === "active") return row.statusLabel;
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return "";
  return value;
}

function moneyOrDash(value: number | null) {
  return value === null ? "-" : formatCurrency(asNumber(value));
}

function percentOrDash(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function isLifecycleMismatch(statusKey: ProductWorkspaceStatusKey) {
  return statusKey === "qb_active_vs_inactive" ||
    statusKey === "qb_active_vs_missing" ||
    statusKey === "qb_inactive_vs_active" ||
    statusKey === "vs_active_qb_missing";
}
