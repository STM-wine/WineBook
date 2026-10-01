"use client";

import { useEffect, useState } from "react";
import { dateTimeLabel } from "@/lib/date-labels";
import { asNumber, formatCurrency, formatInteger, rowReplenishmentPolicy } from "@/lib/order-data";
import type { Recommendation } from "@/lib/types";
import type { ProductWorkspaceListRow, ProductWorkspacePage, ProductWorkspaceCounts, ProductSnapshotMeta, ProductWorkspaceRow, ProductWorkspaceStatusKey } from "@/lib/product-workspace-types";
import {
  REPLENISHMENT_POLICIES,
  policySupportsAutomaticRecommendations,
  replenishmentPolicyLabel,
  type ReplenishmentPolicy
} from "@/lib/replenishment-policy";
import { WineLoadingProgress } from "./wine-loading-progress";
import { MetricCard } from "./metric-card";

type SortKey =
  | "itemCode"
  | "productName"
  | "vintage"
  | "pack"
  | "supplierName"
  | "revenueCenter"
  | "replenishmentPolicy"
  | "recommendationsSuppressed"
  | "fob"
  | "laidIn"
  | "landedCost"
  | "frontline"
  | "bestPrice"
  | "lowestGpPercent"
  | "active"
  | "sourceHealth";

const SOURCE_LABELS: Record<string, string> = {
  quickbooks: "QB",
  vinosmith: "VS",
  supplier_hub: "Supplier Hub",
  stem: "Stem"
};

type OrderingMarker = ProductWorkspaceRow["orderingMarker"];

type StatusFilter = "All" | "gaps" | "vs_status_unknown" | ProductWorkspaceStatusKey;

const STATUS_FILTERS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "All" },
  { label: "True status gaps", value: "gaps" },
  { label: "VS status unknown", value: "vs_status_unknown" },
  { label: "QB active / VS inactive", value: "qb_active_vs_inactive" },
  { label: "QB active / no VS", value: "qb_active_vs_missing" },
  { label: "QB active / non-product", value: "qb_active_non_product" },
  { label: "QB inactive / VS active", value: "qb_inactive_vs_active" },
  { label: "VS active / no QB", value: "vs_active_qb_missing" },
  { label: "Active match", value: "active_match" },
  { label: "Inactive match", value: "inactive_match" }
];

export function ProductWorkspaceView({ canManageMarkers }: { canManageMarkers: boolean; previewRows?: Recommendation[] }) {
  const [data, setData] = useState<ProductWorkspacePage | null>(null);
  const [counts, setCounts] = useState<ProductWorkspaceCounts | null>(null);
  const [includeInactive, onSetIncludeInactive] = useState(false);
  const [isReloading, setIsReloading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const onReload = () => setReload((value) => value + 1);
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [health, setHealth] = useState("All");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "productName", direction: "asc" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatingMarkerCode, setUpdatingMarkerCode] = useState<string | null>(null);
  const [markerError, setMarkerError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => {
    const linkedItem = new URLSearchParams(window.location.search).get("item")?.trim();
    if (linkedItem) setSearch(linkedItem);
  }, []);
  const filterKey = JSON.stringify({ search, supplier, status: statusFilter, health, sort: sort.key, direction: sort.direction, includeInactive });
  const params = new URLSearchParams(JSON.parse(filterKey));
  params.set("offset", String(offset));
  // Pagination remains pinned to one immutable generation until filters or Reload change.
  const [pageSnapshot, setPageSnapshot] = useState<string | null>(null);
  if (pageSnapshot) params.set("snapshot", pageSnapshot);
  const requestKey = params.toString();
  useEffect(() => { setOffset(0); setPageSnapshot(null); }, [filterKey, reload]);
  useEffect(() => {
    const controller = new AbortController();
    setIsReloading(true);
    setLoadError("");
    const timer = setTimeout(async () => {
      try {
        const page = await fetchProducts<ProductWorkspacePage>(requestKey, controller.signal);
        if (controller.signal.aborted) return;
        setData(page);
        performance.mark("winebook:products-usable");
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Products could not load.");
      } finally { if (!controller.signal.aborted) setIsReloading(false); }
    }, search ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [requestKey, reload]);
  useEffect(() => {
    if (!data) return;
    const controller = new AbortController();
    setCounts(null);
    const query = new URLSearchParams(requestKey);
    query.set("snapshot", data.snapshotId);
    query.set("mode", "counts");
    fetchProducts<ProductSnapshotMeta & { data: ProductWorkspaceCounts }>(query.toString(), controller.signal)
      .then((result) => { if (!controller.signal.aborted) setCounts(result.data); })
      .catch((error) => { if (!controller.signal.aborted) setLoadError(`Counts unavailable: ${error.message}`); });
    return () => controller.abort();
  }, [data]);
  const supplierOptions = ["All", ...(counts?.suppliers || (supplier !== "All" ? [supplier] : []))];
  const visibleRows = data?.rows || [];
  const renderedRows = visibleRows;
  const statusGapCount = counts?.lifecycleMismatches;
  const needsReviewCount = counts?.needsReview;
  const gpRiskCounts = { red: counts?.gpRed, yellow: counts?.gpYellow };
  const selectedRow = visibleRows.find((row) => row.id === selectedId) || null;
  const countLabel = (value: number | undefined) => value === undefined ? "…" : formatInteger(value);
  function onMarkerUpdated(itemCode: string, marker: OrderingMarker) {
    setData((current) => current ? { ...current, isStale: true, rows: current.rows.map((row) =>
      normalizeCode(row.itemCode) === normalizeCode(itemCode) ? { ...row, orderingMarker: marker, sourceBadges: sourceBadgesWithStem(row.sourceBadges) } : row
    ) } : null);
  }

  async function exportPricingModel() {
    setIsExporting(true);
    setExportError(null);
    try {
      const query = new URLSearchParams(requestKey);
      query.set("mode", "download");
      query.set("snapshot", data!.snapshotId);
      const response = await fetch(`/api/products/workspace?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error || "Export failed.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `stem-pricing-model-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export the pricing model.");
    } finally {
      setIsExporting(false);
    }
  }

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

  async function saveOrderingMarker(row: ProductWorkspaceListRow, marker: OrderingMarker) {
    const previousMarker = row.orderingMarker;
    const note = "Manual Product Workspace marker update";
    setMarkerError(null);
    setUpdatingMarkerCode(row.itemCode);
    onMarkerUpdated(row.itemCode, {
      ...marker,
      markerNote: note,
      noteSource: "manual",
      updatedAt: new Date().toISOString()
    });

    try {
      const response = await fetch("/api/products/workspace/markers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemCode: row.itemCode,
          quickbooksItemListId: row.quickbooks.listId || null,
          replenishmentPolicy: marker.replenishmentPolicy,
          recommendationsSuppressed: marker.recommendationsSuppressed,
          suppressionReason: marker.suppressionReason,
          suppressedUntil: marker.suppressedUntil,
          note
        })
      });
      const body = await response.json().catch(() => null) as { error?: string; orderingMarker?: OrderingMarker } | null;
      if (!response.ok) {
        throw new Error(body?.error || "Could not save ordering marker.");
      }
      if (body?.orderingMarker) {
        onMarkerUpdated(row.itemCode, body.orderingMarker);
      }
    } catch (error) {
      onMarkerUpdated(row.itemCode, previousMarker);
      setMarkerError(error instanceof Error ? error.message : "Could not save ordering marker.");
    } finally {
      setUpdatingMarkerCode((current) => current === row.itemCode ? null : current);
    }
  }

  return (
    <>
      {isExporting ? <WineLoadingProgress inline message="Building pricing workbook" detail="Exporting every product matching the current filters." /> : null}
      {isReloading ? <WineLoadingProgress inline message={data ? "Refreshing products — previous results remain visible" : "Loading products"} detail="Search, sort, and counts cover all matching products." /> : null}
      {loadError ? <p role="alert">{loadError} <button onClick={onReload} type="button">Retry</button></p> : null}
      <section className="metric-grid product-workspace-metrics">
        <MetricCard label="True Status Gaps" value={countLabel(statusGapCount)} detail="Confirmed QB and VS mismatch" tone={statusGapCount ? "red" : "green"} />
        <MetricCard label="VS Status Unknown" value={countLabel(counts?.vsStatusUnknown)} detail={`${countLabel(counts?.qbActiveVsUnknown)} active QB rows`} tone={counts?.vsStatusUnknown ? "gold" : "green"} />
        <MetricCard label="Needs Review" value={countLabel(needsReviewCount)} detail="Missing core source data" tone={needsReviewCount ? "red" : "green"} />
        <MetricCard label="GP Risk" value={`${countLabel(gpRiskCounts.red)} / ${countLabel(gpRiskCounts.yellow)}`} detail="Red / yellow low-GP items" tone={gpRiskCounts.red ? "red" : gpRiskCounts.yellow ? "gold" : "green"} />
      </section>

      <section className="panel product-workspace-header">
        <div className="section-heading product-workspace-titlebar">
          <div>
            <p className="eyebrow">Products / Items</p>
            <h1>Product Workspace</h1>
            <p>QuickBooks and source proof table with Stem-owned replenishment policies.</p>
            <small className="product-workspace-cache-note">
              {data ? `Snapshot ${dateTimeLabel(data.generatedAt)} · source ${data.sourceVersion}${data.isStale ? " · refresh queued; showing previous snapshot" : ""}` : "Loading product snapshot"}
            </small>
          </div>
          <div className="product-workspace-actions">
            <button className="button button-outline button-small" disabled={isExporting || isReloading || visibleRows.length === 0} onClick={exportPricingModel} type="button" title="Export all matching products with editable prices and GP formulas">
              {isExporting ? "Exporting..." : "Export pricing model"}
            </button>
            <button className="button button-outline button-small" disabled={isReloading} onClick={onReload} type="button">
              {isReloading ? "Reloading..." : "Reload"}
            </button>
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
        {markerError ? <p className="form-error">{markerError}</p> : null}
        {exportError ? <p className="form-error" role="alert">{exportError}</p> : null}

        <div className="product-workspace-layout">
          <div className="table-shell product-workspace-table">
            <table>
              <colgroup>
                <col className="product-col-code" />
                <col className="product-col-name" />
                <col className="product-col-supplier" />
                <col className="product-col-revenue" />
                <col className="product-col-marker" />
                <col className="product-col-marker" />
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
                  <SortableHeader label="Supplier" sortKey="supplierName" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Revenue" sortKey="revenueCenter" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Replenishment" sortKey="replenishmentPolicy" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Auto reorder" sortKey="recommendationsSuppressed" sort={sort} onSort={changeSort} />
                  <SortableHeader label="FOB" sortKey="fob" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Laid-in" sortKey="laidIn" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Frontline" sortKey="frontline" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Best" sortKey="bestPrice" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Lowest GP" sortKey="lowestGpPercent" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Status" sortKey="active" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Source" sortKey="sourceHealth" sort={sort} onSort={changeSort} />
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => (
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
                    <td title={row.supplierSource || "No supplier source matched"}>{row.supplierName || "Unmatched"}</td>
                    <td>{row.revenueCenter}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <PolicySelect
                        policy={row.orderingMarker.replenishmentPolicy}
                        disabled={!canManageMarkers || isReloading || data?.isStale || updatingMarkerCode === row.itemCode}
                        onChange={(policy) => saveOrderingMarker(row, {
                          ...row.orderingMarker,
                          replenishmentPolicy: policy,
                          familyDefaultPolicy: policy,
                          isCore: policy === "Core",
                          isBtg: false,
                          recommendationsSuppressed: policySupportsAutomaticRecommendations(policy)
                            ? row.orderingMarker.recommendationsSuppressed
                            : false,
                          suppressionReason: policySupportsAutomaticRecommendations(policy)
                            ? row.orderingMarker.suppressionReason
                            : null,
                          suppressedUntil: policySupportsAutomaticRecommendations(policy)
                            ? row.orderingMarker.suppressedUntil
                            : null
                        })}
                      />
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <RecommendationModeControl
                        marker={row.orderingMarker}
                        disabled={!canManageMarkers || isReloading || data?.isStale || updatingMarkerCode === row.itemCode}
                        onChange={(suppressed) => {
                          if (suppressed) {
                            setMarkerError("Turn off automatic reorders from the wine's Edit Replenishment popup in Order Summary so the reason is recorded.");
                            return;
                          }
                          saveOrderingMarker(row, {
                            ...row.orderingMarker,
                            recommendationsSuppressed: false,
                            suppressionReason: null,
                            suppressedUntil: null
                          });
                        }}
                      />
                    </td>
                    <td title={row.fobSource || "Missing QuickBooks FOB"}>{moneyOrDash(row.fob)}</td>
                    <td title={row.laidInSource || "Missing Supplier Logistics laid-in"}>{moneyOrDash(row.laidIn)}</td>
                    <td>{moneyOrDash(row.frontline)}</td>
                    <td>{moneyOrDash(row.bestPrice)}</td>
                    <td className={`gp-cell ${gpToneClass(row)}`}>{percentOrDash(row.lowestGpPercent)}</td>
                    <td title={row.statusDetail}>{row.statusLabel}</td>
                    <td>
                      <span className={`source-health source-health-${row.sourceHealth}`}>{row.sourceHealthLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="product-workspace-table-footer">
              <span>Showing {formatInteger(renderedRows.length)} of {countLabel(counts?.visible)} matching items (page starts at {offset + 1})</span>
              <button className="ghost-button" disabled={isReloading || offset === 0} onClick={() => { setPageSnapshot(data!.snapshotId); setOffset(Math.max(0, offset - 75)); }} type="button">Previous</button>
              <button className="ghost-button" disabled={isReloading || !data?.hasMore} onClick={() => { setPageSnapshot(data!.snapshotId); setOffset(offset + 75); }} type="button">Next 75</button>
            </div>
          </div>
          <ProductWorkspaceDetail row={selectedRow} snapshotId={data?.snapshotId} />
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
        <h3>Replenishment</h3>
        <dl>
          <div><dt>Policy</dt><dd>{replenishmentPolicyLabel(row.orderingMarker.replenishmentPolicy)}</dd></div>
          <div><dt>Family</dt><dd>{row.orderingMarker.policyFamilyName || "Item only"}</dd></div>
          <div><dt>Recommendation</dt><dd>{recommendationModeLabel(row.orderingMarker)}</dd></div>
          <div><dt>Updated</dt><dd>{dateTimeLabel(row.orderingMarker.updatedAt)} <small>{row.orderingMarker.noteSource || "No marker row"}</small></dd></div>
          <div><dt>Note</dt><dd>{row.orderingMarker.markerNote || "No note"}</dd></div>
        </dl>
      </div>
      <div className="drawer-section">
        <h3>Source Proof</h3>
        <dl>
          <div><dt>QB Status</dt><dd>{row.active === false ? "Inactive" : row.active === true ? "Active" : "Unknown"} <small>{dateTimeLabel(row.quickbooks.lastSeenAt)}</small></dd></div>
          <div><dt>VS Status</dt><dd>{vinosmithStatusLabel(row)} <small>{row.vinosmith ? dateTimeLabel(row.vinosmith.lastSeenAt) : "No VS match"}</small></dd></div>
          <div><dt>Blocker</dt><dd>{sourceBlockerLabel(row)}</dd></div>
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

function PolicySelect({
  policy,
  disabled,
  onChange
}: {
  policy: ReplenishmentPolicy;
  disabled: boolean;
  onChange: (policy: ReplenishmentPolicy) => void;
}) {
  return (
    <select
      aria-label="Replenishment policy"
      className="policy-select"
      disabled={disabled}
      value={policy}
      onChange={(event) => onChange(event.target.value as ReplenishmentPolicy)}
    >
      {REPLENISHMENT_POLICIES.map((option) => (
        <option key={option} value={option}>{replenishmentPolicyLabel(option)}</option>
      ))}
    </select>
  );
}

function RecommendationModeControl({
  marker,
  disabled,
  onChange
}: {
  marker: OrderingMarker;
  disabled: boolean;
  onChange: (suppressed: boolean) => void;
}) {
  if (!policySupportsAutomaticRecommendations(marker.replenishmentPolicy)) {
    return <span className="policy-mode-static">Manual</span>;
  }
  return (
    <label className={`marker-toggle${marker.recommendationsSuppressed ? "" : " marker-toggle-on"}${disabled ? " marker-toggle-disabled" : ""}`} title="Toggle automatic reorder recommendations for this exact item number">
      <input
        aria-label="Automatic reorder"
        checked={!marker.recommendationsSuppressed}
        disabled={disabled}
        onChange={(event) => onChange(!event.target.checked)}
        type="checkbox"
      />
      <span>{marker.recommendationsSuppressed ? "Paused" : "On"}</span>
    </label>
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

function gpToneClass(row: Pick<ProductWorkspaceRow, "lowestGpPercent" | "revenueCenter">) {
  const value = row.lowestGpPercent;
  if (value === null) return "";
  if (row.revenueCenter === "GRW Broker") return value < 8 ? "gp-cell-critical" : "";
  if (value < 26.5) return "gp-cell-critical";
  if (value < 28) return "gp-cell-warning";
  return "";
}

function isLifecycleMismatch(statusKey: ProductWorkspaceStatusKey) {
  return statusKey === "qb_active_vs_inactive" ||
    statusKey === "qb_active_vs_missing" ||
    statusKey === "qb_inactive_vs_active" ||
    statusKey === "vs_active_qb_missing";
}

function isVinosmithStatusUnknown(statusKey: ProductWorkspaceStatusKey) {
  return statusKey === "qb_active_vs_unknown" || statusKey === "qb_inactive_vs_unknown";
}

function vinosmithStatusLabel(row: ProductWorkspaceRow) {
  if (!row.vinosmith) return "Missing";
  if (row.vinosmith.active === true && row.vinosmith.orderable === true) return "Active + orderable";
  if (row.vinosmith.active === true) return "Active";
  if (row.vinosmith.orderable === true) return "Orderable";
  if (row.vinosmith.active === false || row.vinosmith.orderable === false) return "Inactive";
  return "Unknown";
}

function sourceBlockerLabel(row: ProductWorkspaceRow) {
  if (row.statusKey === "qb_active_non_product") return "No Vinosmith wine expected for this QuickBooks item.";
  if (isVinosmithStatusUnknown(row.statusKey)) return "Vinosmith status is blank in Stem.";
  if (isLifecycleMismatch(row.statusKey)) return row.statusDetail;
  if (row.sourceHealth === "needs_review") return "Core source data is missing.";
  if (row.sourceHealth === "partial") return "Some source data is available, but not all cost/price inputs are matched.";
  return "Source inputs are ready for review.";
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

function sourceBadgesWithStem(sourceBadges: ProductWorkspaceRow["sourceBadges"]): ProductWorkspaceRow["sourceBadges"] {
  return sourceBadges.includes("stem") ? sourceBadges : [...sourceBadges, "stem"];
}

async function fetchProducts<T>(query: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/products/workspace?${query}`, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Products unavailable.");
  return body;
}

function ProductWorkspaceDetail({ row, snapshotId }: { row: ProductWorkspaceListRow | null; snapshotId?: string }) {
  const [detail, setDetail] = useState<ProductWorkspaceRow | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setDetail(null); setError("");
    if (!row || !snapshotId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ mode: "detail", id: row.id, snapshot: snapshotId });
    fetchProducts<ProductSnapshotMeta & { data: ProductWorkspaceRow }>(params.toString(), controller.signal)
      .then((body) => { if (!controller.signal.aborted) setDetail(body.data); })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [row?.id, snapshotId, retry]);
  if (row && !detail) return <aside className="product-workspace-drawer">
    {error ? <p role="alert">{error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button></p>
      : <WineLoadingProgress inline message={`Loading ${row.productName}`} detail="Pricing levels and source explanations" />}
  </aside>;
  return <ProductWorkspaceDrawer row={detail && row ? { ...detail, orderingMarker: row.orderingMarker } : null} />;
}

function recommendationModeLabel(marker: OrderingMarker) {
  if (!policySupportsAutomaticRecommendations(marker.replenishmentPolicy)) return "Manual only";
  if (marker.recommendationsSuppressed) {
    const until = marker.suppressedUntil ? ` until ${marker.suppressedUntil}` : "";
    return `Paused${until}${marker.suppressionReason ? `: ${marker.suppressionReason}` : ""}`;
  }
  return "Automatic";
}

function moneyOrDash(value: number | null) {
  return value === null ? "-" : formatCurrency(asNumber(value));
}

function percentOrDash(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}
