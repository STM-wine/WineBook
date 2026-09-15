import { useEffect, useState } from "react";
import type {
  DashboardMetrics,
  InactiveQuickBooksItem,
  Recommendation,
  SupplierCatalogWine,
  SupplierGroup
} from "@/lib/types";
import {
  activeFreeGoodsForRow,
  DEFAULT_SUPPLIER_TARGET_WEEKS,
  formatCurrency,
  formatInteger,
  freeGoodsSummary,
  type SupplierGroupSortMode
} from "@/lib/order-data";
import { MetricCard } from "./metric-card";
import { WorkbenchGrid } from "./workbench-grid";
import { supplierCatalogWineToInput, type SupplierCatalogWineInput } from "@/lib/supplier-catalog";

type SaveCatalogWineInput = SupplierCatalogWineInput & {
  existingCatalogWineId?: string | null;
  priceChangeReason?: string;
};

export function OrderReviewView({
  brandManager,
  brandManagerOptions,
  expandAll,
  metrics,
  search,
  setBrandManager,
  setExpandAll,
  setSearch,
  setSuggestedOnly,
  setSupplier,
  setSupplierSort,
  suggestedOnly,
  supplier,
  supplierGroups,
  supplierSort,
  supplierOptions,
  supplierCatalogWines,
  supplierTargetWeeks,
  visibleCount,
  onSaveApproval,
  onClearSupplierApprovals,
  onSaveOrderPath,
  onSaveWorkingQty,
  onSetWorkingQty,
  onSetSupplierTargetWeeks,
  onRestoreInactiveWine,
  onSaveCatalogWine,
  onDeleteCatalogWine,
  onAddWine,
  isPending
}: {
  brandManager: string;
  brandManagerOptions: string[];
  expandAll: boolean;
  metrics: DashboardMetrics;
  search: string;
  setBrandManager: (value: string) => void;
  setExpandAll: (value: boolean) => void;
  setSearch: (value: string) => void;
  setSuggestedOnly: (value: boolean) => void;
  setSupplier: (value: string) => void;
  setSupplierSort: (value: SupplierGroupSortMode) => void;
  suggestedOnly: boolean;
  supplier: string;
  supplierGroups: SupplierGroup[];
  supplierSort: SupplierGroupSortMode;
  supplierOptions: string[];
  supplierCatalogWines: SupplierCatalogWine[];
  supplierTargetWeeks: Record<string, string>;
  visibleCount: number;
  onSaveApproval: (row: Recommendation, approved: boolean, qtyOverride?: number) => void;
  onClearSupplierApprovals: (supplierName: string) => void;
  onSaveOrderPath: (row: Recommendation, orderPath: "stateside" | "di") => void;
  onSaveWorkingQty: (row: Recommendation, qty: number) => void;
  onSetWorkingQty: (row: Recommendation, qty: number) => void;
  onSetSupplierTargetWeeks: (supplierName: string, value: string) => void;
  onRestoreInactiveWine: (listId: string) => void;
  onSaveCatalogWine: (input: SaveCatalogWineInput) => void;
  onDeleteCatalogWine: (input: { id: string }) => void;
  onAddWine: (supplierName: string) => void;
  isPending: boolean;
}) {
  const [editingWine, setEditingWine] = useState<SupplierCatalogWine | null>(null);

  function editNewItem(row: Recommendation) {
    const wine = supplierCatalogWines.find((candidate) => candidate.id === row.supplier_catalog_wine_id);
    if (wine) setEditingWine(wine);
  }

  function deleteNewItem(row: Recommendation) {
    if (!row.supplier_catalog_wine_id) return;
    const name = row.product_name || row.planning_sku || "this new item";
    if (!window.confirm(`Delete ${name}? This removes the draft item from the workbench and Supplier Hub.`)) return;
    onDeleteCatalogWine({ id: row.supplier_catalog_wine_id });
  }

  return (
    <>
      <section className="metric-grid">
        <MetricCard label="Urgent" value={formatInteger(metrics.urgent)} detail="SKUs need action" tone="red" />
        <MetricCard label="Low" value={formatInteger(metrics.low)} detail="Below target" tone="gold" />
        <MetricCard label="Recommended" value={formatInteger(metrics.recommendedBottles)} detail="Bottles" tone="green" />
        <MetricCard label="Approved" value={formatInteger(metrics.approvedBottles)} detail="Bottles ready for PO" tone="blue" />
        <MetricCard label="PO Value" value={formatCurrency(metrics.poValue)} detail="Approved lines" tone="plum" />
        <MetricCard label="Suppliers" value={formatInteger(metrics.supplierCount)} detail="With suggested orders" tone="ink" />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>Order Summary</h1>
            <p>Supplier groups sorted by suggested order value. Rows are live from the latest completed report run.</p>
          </div>
        </div>
        <div className="filter-bar">
          <label>
            Supplier
            <select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
              {supplierOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Brand Manager
            <select value={brandManager} onChange={(event) => setBrandManager(event.target.value)}>
              {brandManagerOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="search-field">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Wine, supplier, item #"
            />
          </label>
          <label className="check-control">
            <input
              type="checkbox"
              checked={suggestedOnly}
              onChange={(event) => setSuggestedOnly(event.target.checked)}
            />
            Suggested only
          </label>
        </div>
        <SummaryTable groups={supplierGroups} />
      </section>

      <div className="workbench-controls">
        <div className="workbench-control-group">
          <label className="check-control">
            <input type="checkbox" checked={expandAll} onChange={(event) => setExpandAll(event.target.checked)} />
            Expand all supplier workbenches
          </label>
          <label className="compact-select-control">
            Sort
            <select value={supplierSort} onChange={(event) => setSupplierSort(event.target.value as SupplierGroupSortMode)}>
              <option value="default">Supplier Suggested Orders</option>
              <option value="az">A-Z</option>
              <option value="za">Z-A</option>
            </select>
          </label>
        </div>
        <span>{formatInteger(visibleCount)} visible SKUs</span>
      </div>

      <section className="supplier-stack">
        {supplierGroups.map((group) => (
          <SupplierSection
            key={group.supplier}
            group={group}
            expandAll={expandAll || supplier !== "All"}
            onSaveApproval={onSaveApproval}
            onClearSupplierApprovals={onClearSupplierApprovals}
            onSaveOrderPath={onSaveOrderPath}
            onSetWorkingQty={onSetWorkingQty}
            onSaveWorkingQty={onSaveWorkingQty}
            targetWeeks={supplierTargetWeeks[group.supplier] ?? String(DEFAULT_SUPPLIER_TARGET_WEEKS)}
            onSetTargetWeeks={(value) => onSetSupplierTargetWeeks(group.supplier, value)}
            onRestoreInactiveWine={onRestoreInactiveWine}
            onEditNewItem={editNewItem}
            onDeleteNewItem={deleteNewItem}
            onAddWine={onAddWine}
            isPending={isPending}
          />
        ))}
      </section>
      {editingWine ? (
        <NewItemEditDialog
          wine={editingWine}
          isPending={isPending}
          onClose={() => setEditingWine(null)}
          onSave={(input) => {
            onSaveCatalogWine(input);
            setEditingWine(null);
          }}
        />
      ) : null}
    </>
  );
}

function SummaryTable({ groups }: { groups: SupplierGroup[] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleGroups = showAll ? groups : groups.slice(0, 7);

  return (
    <>
      <div className="summary-table-actions">
        <span>
          Showing {formatInteger(visibleGroups.length)} of {formatInteger(groups.length)} suppliers
        </span>
        <div>
          <button className="ghost-button" onClick={() => setShowAll(true)} type="button">
            Expand All
          </button>
          <button className="ghost-button" onClick={() => setShowAll(false)} type="button">
            Collapse All
          </button>
        </div>
      </div>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>SKUs</th>
              <th>Urgent</th>
              <th>Free Goods</th>
              <th>Suggested Qty</th>
              <th>Suggested Value</th>
              <th>Approved Qty</th>
              <th>Approved Value</th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((group) => (
              <tr key={group.supplier}>
                <td>{group.supplier}</td>
                <td>{formatInteger(group.skuCount)}</td>
                <td>{formatInteger(group.urgentCount)}</td>
                <td>{formatInteger(group.freeGoodProgramCount)}</td>
                <td>{formatInteger(group.recommendedBottles)}</td>
                <td>{formatCurrency(group.suggestedValue)}</td>
                <td>{formatInteger(group.approvedBottles)}</td>
                <td>
                  <strong className={group.approvedValue > 0 ? "approved-value-strong" : undefined}>
                    {formatCurrency(group.approvedValue)}
                  </strong>
                  <span className="value-comparison">
                    {approvedValueComparison(group.approvedValue, group.suggestedValue)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SupplierSection({
  group,
  expandAll,
  onSaveApproval,
  onClearSupplierApprovals,
  onSaveOrderPath,
  onSetWorkingQty,
  onSaveWorkingQty,
  targetWeeks,
  onSetTargetWeeks,
  onRestoreInactiveWine,
  onEditNewItem,
  onDeleteNewItem,
  onAddWine,
  isPending
}: {
  group: SupplierGroup;
  expandAll: boolean;
  onSaveApproval: (row: Recommendation, approved: boolean, qtyOverride?: number) => void;
  onClearSupplierApprovals: (supplierName: string) => void;
  onSaveOrderPath: (row: Recommendation, orderPath: "stateside" | "di") => void;
  onSetWorkingQty: (row: Recommendation, qty: number) => void;
  onSaveWorkingQty: (row: Recommendation, qty: number) => void;
  targetWeeks: string;
  onSetTargetWeeks: (value: string) => void;
  onRestoreInactiveWine: (listId: string) => void;
  onEditNewItem: (row: Recommendation) => void;
  onDeleteNewItem: (row: Recommendation) => void;
  onAddWine: (supplierName: string) => void;
  isPending: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [isOpen, setIsOpen] = useState(expandAll);
  const [showInactive, setShowInactive] = useState(false);
  const [inactiveSearch, setInactiveSearch] = useState("");
  const tdmNames = Array.from(new Set(group.rows.map((row) => row.brand_manager?.trim() || "").filter(Boolean)));
  const tdmLabel = tdmNames.length === 0 ? "Unassigned" : tdmNames.length === 1 ? tdmNames[0] : "Multiple";
  const hasApprovedOrders = group.approvedBottles > 0;
  const approvedPercent = group.suggestedValue > 0 ? Math.round((group.approvedValue / group.suggestedValue) * 100) : 0;
  const freeGoodsRows = group.rows
    .map((row) => ({ row, programs: activeFreeGoodsForRow(row) }))
    .filter((entry) => entry.programs.length > 0);

  useEffect(() => {
    setIsOpen(expandAll);
  }, [expandAll]);

  return (
    <details className="supplier-section" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>
        <div>
          <span className="supplier-chip">{group.supplier}</span>
          <span className="supplier-chip supplier-chip-muted">{tdmLabel}</span>
          <strong>{formatInteger(group.recommendedBottles)} bottles</strong>
          <span>{formatCurrency(group.suggestedValue)} suggested</span>
          <span className={hasApprovedOrders ? "supplier-approved-value" : "supplier-approved-value is-empty"}>
            {formatCurrency(group.approvedValue)} approved
          </span>
          {group.freeGoodProgramCount > 0 ? <span className="free-goods-chip">{formatInteger(group.freeGoodProgramCount)} free-goods</span> : null}
        </div>
        <div className="supplier-summary-actions">
          {group.supplier !== "Unknown Supplier" ? (
            <button
              className="ghost-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onAddWine(group.supplier);
              }}
              type="button"
            >
              Add Wine
            </button>
          ) : null}
          <button
            className="ghost-button clear-approvals-button"
            disabled={!hasApprovedOrders}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClearSupplierApprovals(group.supplier);
            }}
            type="button"
          >
            Clear Approved Orders
          </button>
          <span>{formatInteger(group.skuCount)} SKUs</span>
        </div>
      </summary>
      {isOpen ? (
        <>
          <div className="supplier-metrics">
            <MetricCard label="SKUs" value={formatInteger(group.skuCount)} detail="In this supplier" tone="ink" />
            <MetricCard label="Urgent" value={formatInteger(group.urgentCount)} detail="Need review" tone="red" />
            <MetricCard label="Suggested" value={formatInteger(group.recommendedBottles)} detail="Bottles" tone="green" />
            <MetricCard label="Approved" value={formatInteger(group.approvedBottles)} detail="Bottles" tone="blue" />
            <MetricCard label="Suggested Value" value={formatCurrency(group.suggestedValue)} detail="Full recommended order" tone="gold" />
            <MetricCard
              label="Approved Value"
              value={formatCurrency(group.approvedValue)}
              detail={hasApprovedOrders ? `${formatInteger(approvedPercent)}% of suggested` : "No approved lines yet"}
              tone="plum"
            />
          </div>
          {freeGoodsRows.length > 0 ? (
            <div className="free-goods-opportunities">
              {freeGoodsRows.map(({ row, programs }) => (
                <div className="free-goods-opportunity" key={row.id}>
                  <strong>{row.product_name || row.planning_sku || "Unnamed wine"}</strong>
                  <span>{freeGoodsSummary(programs)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="supplier-workbench-options">
            <label className="target-weeks-control">
              Target weeks
              <input
                min="0"
                step="0.1"
                inputMode="decimal"
                value={targetWeeks}
                onChange={(event) => onSetTargetWeeks(event.target.value)}
                placeholder="Default"
              />
            </label>
            <label className="check-control">
              <input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />
              Show 60/90d sales
            </label>
            <label className="check-control">
              <input type="checkbox" checked={showForecast} onChange={(event) => setShowForecast(event.target.checked)} />
              Show LY 60/90d forecast
            </label>
          </div>
          <InactiveWineSearch
            supplierName={group.supplier}
            isOpen={showInactive}
            search={inactiveSearch}
            onOpenChange={setShowInactive}
            onSearchChange={setInactiveSearch}
            workbenchRows={group.rows}
            onRestore={onRestoreInactiveWine}
            isPending={isPending}
          />
          <WorkbenchGrid
            rows={group.rows}
            showForecast={showForecast}
            showHistory={showHistory}
            onSaveApproval={onSaveApproval}
            onSaveOrderPath={onSaveOrderPath}
            onSetWorkingQty={onSetWorkingQty}
            onSaveWorkingQty={onSaveWorkingQty}
            onEditNewItem={onEditNewItem}
            onDeleteNewItem={onDeleteNewItem}
          />
        </>
      ) : null}
    </details>
  );
}

function NewItemEditDialog({
  wine,
  isPending,
  onClose,
  onSave
}: {
  wine: SupplierCatalogWine;
  isPending: boolean;
  onClose: () => void;
  onSave: (input: SaveCatalogWineInput) => void;
}) {
  const [producer, setProducer] = useState(wine.producer);
  const [wineName, setWineName] = useState(wine.wine_name);
  const [vintage, setVintage] = useState(wine.vintage || "NV");
  const [packSize, setPackSize] = useState(String(wine.pack_size || 12));
  const [bottleSize, setBottleSize] = useState(wine.bottle_size || "750ml");
  const usesCaseFob = wine.pricing_basis === "case";
  const [fobCost, setFobCost] = useState(String(usesCaseFob ? wine.fob_case ?? "" : wine.fob_bottle ?? ""));
  const [laidInPerBottle, setLaidInPerBottle] = useState(String(wine.laid_in_per_bottle ?? "0"));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      ...supplierCatalogWineToInput(wine),
      existingCatalogWineId: wine.id,
      producer: producer.trim(),
      wineName: wineName.trim(),
      vintage: vintage.trim() || "NV",
      packSize: Math.max(1, Math.trunc(Number(packSize) || 1)),
      bottleSize: bottleSize.trim() || "750ml",
      fobBottle: usesCaseFob ? null : fobCost.trim() ? Number(fobCost) : null,
      fobCase: usesCaseFob ? (fobCost.trim() ? Number(fobCost) : null) : null,
      laidInPerBottle: laidInPerBottle.trim() ? Number(laidInPerBottle) : 0,
      priceChangeReason: "Order Summary draft edit"
    });
  }

  return (
    <div className="new-item-edit-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="new-item-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="new-item-edit-title" onSubmit={submit}>
        <div className="new-item-edit-header">
          <div>
            <h2 id="new-item-edit-title">Edit New Item</h2>
            <p>Update the draft before it becomes an official QuickBooks item.</p>
          </div>
          <button aria-label="Close edit dialog" className="ghost-button" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="new-item-edit-grid">
          <label>
            Producer
            <input required value={producer} onChange={(event) => setProducer(event.target.value)} />
          </label>
          <label className="wide-field">
            Wine name
            <input required value={wineName} onChange={(event) => setWineName(event.target.value)} />
          </label>
          <label>
            Vintage
            <input required value={vintage} onChange={(event) => setVintage(event.target.value)} />
          </label>
          <label>
            Pack size
            <input min="1" required type="number" value={packSize} onChange={(event) => setPackSize(event.target.value)} />
          </label>
          <label>
            Bottle size
            <input required value={bottleSize} onChange={(event) => setBottleSize(event.target.value)} />
          </label>
          <label>
            {usesCaseFob ? "FOB / case" : "FOB / bottle"}
            <input min="0" step="0.01" type="number" value={fobCost} onChange={(event) => setFobCost(event.target.value)} />
          </label>
          <label>
            Laid-in / bottle
            <input min="0" step="0.01" type="number" value={laidInPerBottle} onChange={(event) => setLaidInPerBottle(event.target.value)} />
          </label>
        </div>
        <div className="new-item-edit-footer">
          <button className="ghost-button" disabled={isPending} type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={isPending} type="submit">Save Changes</button>
        </div>
      </form>
    </div>
  );
}

function InactiveWineSearch({
  supplierName,
  isOpen,
  search,
  onOpenChange,
  onSearchChange,
  workbenchRows,
  onRestore,
  isPending
}: {
  supplierName: string;
  isOpen: boolean;
  search: string;
  onOpenChange: (value: boolean) => void;
  onSearchChange: (value: string) => void;
  workbenchRows: Recommendation[];
  onRestore: (listId: string) => void;
  isPending: boolean;
}) {
  const query = search.trim();
  const [matches, setMatches] = useState<InactiveQuickBooksItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const workbenchItemNumbers = new Set(
    workbenchRows.map((row) => row.product_code?.trim().toUpperCase() || "").filter(Boolean)
  );

  useEffect(() => {
    if (!isOpen || query.length < 2) {
      setMatches([]);
      setIsSearching(false);
      setSearchError("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError("");
      try {
        const params = new URLSearchParams({ supplier: supplierName, q: query });
        const response = await fetch(`/api/order-review/inactive-items?${params}`, { signal: controller.signal });
        const result = await response.json() as { items?: InactiveQuickBooksItem[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not search inactive QuickBooks items.");
        setMatches(result.items || []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setMatches([]);
        setSearchError(error instanceof Error ? error.message : "Could not search inactive QuickBooks items.");
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, query, supplierName]);

  return (
    <div className="inactive-wine-search">
      <label className="check-control">
        <input type="checkbox" checked={isOpen} onChange={(event) => onOpenChange(event.target.checked)} />
        Search inactive items
      </label>
      {isOpen ? (
        <div className="inactive-wine-search-panel">
          <label>
            Find an inactive item for this supplier
            <input
              autoFocus
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Wine name, producer, or item #"
            />
          </label>
          {query.length < 2 ? (
            <p className="inactive-wine-empty">Enter at least two characters to search this supplier&apos;s inactive QuickBooks items.</p>
          ) : isSearching ? (
            <p className="inactive-wine-empty">Searching QuickBooks items...</p>
          ) : searchError ? (
            <p className="inactive-wine-empty status-danger" role="alert">{searchError}</p>
          ) : matches.length > 0 ? (
            <div className="inactive-wine-results" role="list">
              {matches.map((item) => {
                const isOnWorkbench = workbenchItemNumbers.has(item.itemNumber.trim().toUpperCase());
                return (
                  <div className="inactive-wine-result" key={item.listId} role="listitem">
                    <div>
                      <strong>{item.displayName}</strong>
                      <span>{[item.producer, item.vintage, item.packLabel, item.purchaseCost === null ? null : `${formatCurrency(item.purchaseCost)} cost`].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="inactive-wine-result-meta">
                      <span>Item #{item.itemNumber}</span>
                      <div>
                        <span className="status-pill">QB Inactive</span>
                        <button
                          className="ghost-button inactive-wine-restore-button"
                          disabled={isPending || isOnWorkbench}
                          onClick={() => onRestore(item.listId)}
                          type="button"
                        >
                          {isOnWorkbench ? "On Workbench" : "Re-add to Workbench"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="inactive-wine-empty">No inactive QuickBooks items match that search for this supplier.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function approvedValueComparison(approvedValue: number, suggestedValue: number) {
  if (suggestedValue <= 0) return "No suggested value";
  if (approvedValue <= 0) return "No approved value";
  return `${formatInteger(Math.round((approvedValue / suggestedValue) * 100))}% of suggested`;
}
