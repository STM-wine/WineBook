import { useEffect, useState } from "react";
import type {
  ApprovalEvent,
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
  rowReplenishmentPolicy,
  type SupplierGroupSortMode
} from "@/lib/order-data";
import { MetricCard } from "./metric-card";
import { WorkbenchGrid } from "./workbench-grid";
import { supplierCatalogWineToInput, type SupplierCatalogWineInput } from "@/lib/supplier-catalog";
import {
  REPLENISHMENT_POLICIES,
  REORDER_SUPPRESSION_REASONS,
  policySupportsAutomaticRecommendations,
  reorderSuppressionReason,
  replenishmentPolicyLabel,
  type ReplenishmentPolicy,
  type ReplenishmentPolicyFilter,
  type ReorderSuppressionReason
} from "@/lib/replenishment-policy";
import { auditActorName, formatAuditTimestamp } from "@/lib/audit-trail";

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
  replenishmentPolicyFilter,
  setReplenishmentPolicyFilter,
  suggestedOnly,
  supplier,
  supplierGroups,
  supplierSort,
  supplierOptions,
  supplierCatalogWines,
  supplierTargetWeeks,
  globalTargetWeeks,
  visibleCount,
  onSaveApproval,
  onSaveOrderPath,
  onSaveWorkingQty,
  onSetWorkingQty,
  onSetSupplierTargetWeeks,
  onSetGlobalTargetWeeks,
  onRestoreInactiveWine,
  onSaveCatalogWine,
  onDeleteCatalogWine,
  onAddWine,
  onSaveReplenishmentPolicy,
  canManageMarkers,
  approvalEvents,
  auditActorNames,
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
  replenishmentPolicyFilter: ReplenishmentPolicyFilter;
  setReplenishmentPolicyFilter: (value: ReplenishmentPolicyFilter) => void;
  suggestedOnly: boolean;
  supplier: string;
  supplierGroups: SupplierGroup[];
  supplierSort: SupplierGroupSortMode;
  supplierOptions: string[];
  supplierCatalogWines: SupplierCatalogWine[];
  supplierTargetWeeks: Record<string, string>;
  globalTargetWeeks: string;
  visibleCount: number;
  onSaveApproval: (row: Recommendation, approved: boolean, qtyOverride?: number) => void;
  onSaveOrderPath: (row: Recommendation, orderPath: "stateside" | "di") => void;
  onSaveWorkingQty: (row: Recommendation, qty: number) => void;
  onSetWorkingQty: (row: Recommendation, qty: number) => void;
  onSetSupplierTargetWeeks: (supplierName: string, value: string) => void;
  onSetGlobalTargetWeeks: (value: string) => void;
  onRestoreInactiveWine: (listId: string) => void;
  onSaveCatalogWine: (input: SaveCatalogWineInput, onSuccess?: () => void) => void;
  onDeleteCatalogWine: (input: { id: string }) => void;
  onAddWine: (supplierName: string) => void;
  onSaveReplenishmentPolicy: (
    row: Recommendation,
    policy: ReplenishmentPolicy,
    recommendationsSuppressed: boolean,
    suppressionReason: ReorderSuppressionReason | null,
    suppressedUntil: string | null
  ) => Promise<void>;
  canManageMarkers?: boolean;
  approvalEvents: ApprovalEvent[];
  auditActorNames: Record<string, string>;
  isPending: boolean;
}) {
  const [editingWine, setEditingWine] = useState<SupplierCatalogWine | null>(null);
  const [editingReplenishment, setEditingReplenishment] = useState<Recommendation | null>(null);
  const parsedGlobalTargetWeeks = Number(globalTargetWeeks);
  const hasGlobalTargetWeeks =
    globalTargetWeeks.trim() !== "" && Number.isFinite(parsedGlobalTargetWeeks) && parsedGlobalTargetWeeks >= 0;

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
        <MetricCard label="PO Approved" value={formatInteger(metrics.approvedBottles)} detail="Net bottles ready for PO" tone="blue" />
        <MetricCard label="Approved Value" value={formatCurrency(metrics.poValue)} detail="Net unprocessed value" tone="plum" />
        <MetricCard label="Suppliers" value={formatInteger(metrics.supplierCount)} detail="With suggested orders" tone="ink" />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>Order Summary</h1>
            <p>Supplier groups sorted by suggested bottles by default. Approval decisions are retained as business history.</p>
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
              <option value="default">Suggested Bottles: High to Low</option>
              <option value="value">Suggested Value: High to Low</option>
              <option value="az">A-Z</option>
              <option value="za">Z-A</option>
            </select>
          </label>
          <label className="compact-select-control global-target-weeks-control">
            Global target weeks
            <input
              aria-label="Global target weeks"
              min="0"
              step="0.1"
              inputMode="decimal"
              type="number"
              value={globalTargetWeeks}
              onChange={(event) => onSetGlobalTargetWeeks(event.target.value)}
              placeholder="Per supplier"
            />
          </label>
          {hasGlobalTargetWeeks ? (
            <button className="ghost-button global-target-reset" onClick={() => onSetGlobalTargetWeeks("")} type="button">
              Use supplier targets
            </button>
          ) : null}
          <label className="compact-select-control">
            Replenishment
            <select
              value={replenishmentPolicyFilter}
              onChange={(event) => setReplenishmentPolicyFilter(event.target.value as ReplenishmentPolicyFilter)}
            >
              <option value="All">All policies</option>
              {REPLENISHMENT_POLICIES.map((policy) => (
                <option key={policy} value={policy}>{replenishmentPolicyLabel(policy)}</option>
              ))}
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
            onSaveOrderPath={onSaveOrderPath}
            onSetWorkingQty={onSetWorkingQty}
            onSaveWorkingQty={onSaveWorkingQty}
            targetWeeks={
              hasGlobalTargetWeeks
                ? globalTargetWeeks
                : (supplierTargetWeeks[group.supplier] ?? String(DEFAULT_SUPPLIER_TARGET_WEEKS))
            }
            onSetTargetWeeks={(value) => onSetSupplierTargetWeeks(group.supplier, value)}
            targetWeeksOverridden={hasGlobalTargetWeeks}
            onRestoreInactiveWine={onRestoreInactiveWine}
            onEditReplenishment={setEditingReplenishment}
            onEditNewItem={editNewItem}
            onDeleteNewItem={deleteNewItem}
            onAddWine={onAddWine}
            approvalEvents={approvalEvents}
            auditActorNames={auditActorNames}
            isPending={isPending}
          />
        ))}
      </section>
      {editingWine ? (
        <NewItemEditDialog
          wine={editingWine}
          isPending={isPending}
          onClose={() => setEditingWine(null)}
          onSave={(input) => onSaveCatalogWine(input, () => setEditingWine(null))}
        />
      ) : null}
      {editingReplenishment ? (
        <ReplenishmentEditDialog
          canManage={canManageMarkers === true}
          row={editingReplenishment}
          auditActorNames={auditActorNames}
          onClose={() => setEditingReplenishment(null)}
          onSave={async (policy, recommendationsSuppressed, suppressionReason, suppressedUntil) => {
            await onSaveReplenishmentPolicy(
              editingReplenishment,
              policy,
              recommendationsSuppressed,
              suppressionReason,
              suppressedUntil
            );
            setEditingReplenishment(null);
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
              <th>PO Approved Qty</th>
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
  onSaveOrderPath,
  onSetWorkingQty,
  onSaveWorkingQty,
  targetWeeks,
  targetWeeksOverridden,
  onSetTargetWeeks,
  onRestoreInactiveWine,
  onEditReplenishment,
  onEditNewItem,
  onDeleteNewItem,
  onAddWine,
  approvalEvents,
  auditActorNames,
  isPending
}: {
  group: SupplierGroup;
  expandAll: boolean;
  onSaveApproval: (row: Recommendation, approved: boolean, qtyOverride?: number) => void;
  onSaveOrderPath: (row: Recommendation, orderPath: "stateside" | "di") => void;
  onSetWorkingQty: (row: Recommendation, qty: number) => void;
  onSaveWorkingQty: (row: Recommendation, qty: number) => void;
  targetWeeks: string;
  targetWeeksOverridden: boolean;
  onSetTargetWeeks: (value: string) => void;
  onRestoreInactiveWine: (listId: string) => void;
  onEditReplenishment: (row: Recommendation) => void;
  onEditNewItem: (row: Recommendation) => void;
  onDeleteNewItem: (row: Recommendation) => void;
  onAddWine: (supplierName: string) => void;
  approvalEvents: ApprovalEvent[];
  auditActorNames: Record<string, string>;
  isPending: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [isOpen, setIsOpen] = useState(expandAll);
  const [showInactive, setShowInactive] = useState(false);
  const [inactiveSearch, setInactiveSearch] = useState("");
  const tdmNames = Array.from(new Set(group.rows.map((row) => row.brand_manager?.trim() || "").filter(Boolean)));
  const tdmLabel = tdmNames.length === 0 ? "Unassigned" : tdmNames.length === 1 ? tdmNames[0] : "Multiple";
  const hasApprovedOrders = group.approvedBottles !== 0;
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
          <span>{formatInteger(group.skuCount)} SKUs</span>
        </div>
      </summary>
      {isOpen ? (
        <>
          <div className="supplier-metrics">
            <MetricCard label="SKUs" value={formatInteger(group.skuCount)} detail="In this supplier" tone="ink" />
            <MetricCard label="Urgent" value={formatInteger(group.urgentCount)} detail="Need review" tone="red" />
            <MetricCard label="Suggested" value={formatInteger(group.recommendedBottles)} detail="Bottles" tone="green" />
            <MetricCard label="PO Approved" value={formatInteger(group.approvedBottles)} detail="Net bottles" tone="blue" />
            <MetricCard label="Suggested Value" value={formatCurrency(group.suggestedValue)} detail="Full recommended order" tone="gold" />
            <MetricCard
              label="Approved Value"
              value={formatCurrency(group.approvedValue)}
              detail={hasApprovedOrders ? `${formatInteger(approvedPercent)}% of suggested` : "No approved lines"}
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
                disabled={targetWeeksOverridden}
                min="0"
                step="0.1"
                inputMode="decimal"
                value={targetWeeks}
                onChange={(event) => onSetTargetWeeks(event.target.value)}
                placeholder="Default"
                title={targetWeeksOverridden ? "Controlled by the global target-weeks override" : undefined}
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
            onEditReplenishment={onEditReplenishment}
            onEditNewItem={onEditNewItem}
            onDeleteNewItem={onDeleteNewItem}
            approvalEvents={approvalEvents}
            auditActorNames={auditActorNames}
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

function ReplenishmentEditDialog({
  row,
  canManage,
  auditActorNames,
  onClose,
  onSave
}: {
  row: Recommendation;
  canManage: boolean;
  auditActorNames: Record<string, string>;
  onClose: () => void;
  onSave: (
    policy: ReplenishmentPolicy,
    recommendationsSuppressed: boolean,
    suppressionReason: ReorderSuppressionReason | null,
    suppressedUntil: string | null
  ) => Promise<void>;
}) {
  const [policy, setPolicy] = useState<ReplenishmentPolicy>(rowReplenishmentPolicy(row));
  const [recommendationsSuppressed, setRecommendationsSuppressed] = useState(row.recommendations_suppressed === true);
  const [suppressionReason, setSuppressionReason] = useState<ReorderSuppressionReason | "">(
    reorderSuppressionReason(row.suppression_reason) || ""
  );
  const [suppressedUntil, setSuppressedUntil] = useState(row.suppressed_until || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const itemCode = row.product_code?.trim() || row.planning_sku?.trim() || "No item number";
  const tomorrow = addPhoenixDays(1);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSaving, onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    const suppressionEnabled = policySupportsAutomaticRecommendations(policy) && recommendationsSuppressed;
    if (suppressionEnabled && !suppressionReason) {
      setError("Choose why automatic reorder recommendations are being turned off.");
      return;
    }
    if (suppressionEnabled && suppressionReason === "Supplier OOS" && (!suppressedUntil || suppressedUntil < tomorrow)) {
      setError("Choose a future date when Supplier OOS recommendations should resume.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await onSave(
        policy,
        suppressionEnabled,
        suppressionEnabled ? suppressionReason || null : null,
        suppressionEnabled && suppressionReason === "Supplier OOS" ? suppressedUntil : null
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the replenishment policy.");
      setIsSaving(false);
    }
  }

  return (
    <div className="new-item-edit-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !isSaving && onClose()}>
      <form className="new-item-edit-dialog replenishment-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="replenishment-edit-title" onSubmit={submit}>
        <div className="new-item-edit-header">
          <div>
            <p className="eyebrow">Order Summary</p>
            <h2 id="replenishment-edit-title">Edit Replenishment</h2>
            <p>{row.product_name || row.planning_sku || "Unnamed wine"} · {itemCode}</p>
          </div>
          <button aria-label="Close replenishment dialog" className="ghost-button" disabled={isSaving} type="button" onClick={onClose}>Close</button>
        </div>

        <div className="replenishment-edit-fields">
          <label className="replenishment-policy-control">
            <span>
              <strong>Replenishment policy</strong>
              <small>Choose how this wine should be replenished.</small>
            </span>
            <select disabled={!canManage || isSaving} value={policy} onChange={(event) => setPolicy(event.target.value as ReplenishmentPolicy)}>
              {REPLENISHMENT_POLICIES.map((option) => (
                <option key={option} value={option}>{replenishmentPolicyLabel(option)}</option>
              ))}
            </select>
          </label>

          {policySupportsAutomaticRecommendations(policy) ? (
            <label className="replenishment-auto-toggle">
              <input
                checked={!recommendationsSuppressed}
                disabled={!canManage || isSaving}
                onChange={(event) => setRecommendationsSuppressed(!event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Automatic reorder recommendations</strong>
                <small>Turn this off when this exact item or vintage cannot be reordered.</small>
              </span>
            </label>
          ) : null}

          {policySupportsAutomaticRecommendations(policy) && recommendationsSuppressed ? (
            <div className="replenishment-suppression-fields">
              <label>
                <span>
                  <strong>Reason automatic reorders are off</strong>
                  <small>This is required and retained with the user and timestamp.</small>
                </span>
                <select
                  aria-label="Reason automatic reorders are off"
                  disabled={!canManage || isSaving}
                  required
                  value={suppressionReason}
                  onChange={(event) => {
                    const reason = reorderSuppressionReason(event.target.value) || "";
                    setSuppressionReason(reason);
                    if (reason !== "Supplier OOS") setSuppressedUntil("");
                  }}
                >
                  <option value="">Choose a reason</option>
                  {REORDER_SUPPRESSION_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>

              {suppressionReason === "Supplier OOS" ? (
                <label>
                  <span>
                    <strong>Resume automatic reorders on</strong>
                    <small>The item becomes recommendation-eligible again on this date.</small>
                  </span>
                  <input
                    aria-label="Resume automatic reorders on"
                    disabled={!canManage || isSaving}
                    min={tomorrow}
                    required
                    type="date"
                    value={suppressedUntil}
                    onChange={(event) => setSuppressedUntil(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <p className="replenishment-family-note">
            The automatic-reorder switch applies only to this item number. End of Vintage and End of Allocation stay off until manually restored;
            Supplier OOS resumes on the selected date. A new vintage with a new item number starts eligible for recommendations.
          </p>
          {row.suppression_changed_at ? (
            <div className="replenishment-audit-note">
              <strong>{row.recommendations_suppressed ? "Automatic reorders turned off" : "Automatic reorder setting changed"}</strong>
              <span>
                {formatAuditTimestamp(row.suppression_changed_at)} · {auditActorName(row.suppression_changed_by, auditActorNames)}
              </span>
              {row.suppression_reason ? <span>Reason: {row.suppression_reason}</span> : null}
              {row.suppression_reason === "Supplier OOS" && row.suppressed_until
                ? <span>Automatic resume: {formatCalendarDate(row.suppressed_until)}</span>
                : null}
            </div>
          ) : null}
          {!canManage ? <p className="form-error">You do not have permission to change replenishment policies.</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>

        <div className="new-item-edit-footer">
          <button className="ghost-button" disabled={isSaving} type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={!canManage || isSaving} type="submit">
            {isSaving ? "Saving..." : "Save Policy"}
          </button>
        </div>
      </form>
    </div>
  );
}

function addPhoenixDays(days: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));
  const date = new Date(Date.UTC(values.get("year") || 1970, (values.get("month") || 1) - 1, values.get("day") || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatCalendarDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
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
  if (approvedValue === 0) return "No approved value";
  return `${formatInteger(Math.round((approvedValue / suggestedValue) * 100))}% of suggested`;
}
