import { useEffect, useMemo, useState } from "react";
import type { SupplierLogistics } from "@/lib/types";
import { asNumber, formatCurrency, formatInteger, uniqueSorted } from "@/lib/order-data";

export function SupplierHubView({
  suppliers,
  isPending,
  onSaveSupplier
}: {
  suppliers: SupplierLogistics[];
  isPending: boolean;
  onSaveSupplier: (supplier: SupplierLogistics) => void;
}) {
  const [draftRows, setDraftRows] = useState<SupplierLogistics[]>([]);
  const [search, setSearch] = useState("");
  const [pickupLocation, setPickupLocation] = useState("All");
  const [showInactive, setShowInactive] = useState(false);
  const rows = useMemo(() => [...draftRows, ...suppliers], [draftRows, suppliers]);
  const pickupOptions = useMemo(
    () => ["All", ...uniqueSorted(rows.map((supplier) => supplier.pick_up_location))],
    [rows]
  );
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return rows.filter((supplier) => {
      const isDraft = supplier.id.startsWith("new-");
      if (!showInactive && supplier.active === false && !isDraft) return false;
      if (pickupLocation !== "All" && (supplier.pick_up_location?.trim() || "") !== pickupLocation) return false;
      if (!needle) return true;

      return [
        supplier.name,
        supplier.importer_id,
        supplier.tdm,
        supplier.pick_up_location,
        supplier.freight_forwarder,
        supplier.order_frequency,
        supplier.notes
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [pickupLocation, rows, search, showInactive]);
  const activeCount = suppliers.filter((supplier) => supplier.active !== false).length;
  const inactiveCount = suppliers.length - activeCount;
  const averageLaidIn =
    activeCount > 0
      ? suppliers
          .filter((supplier) => supplier.active !== false)
          .reduce((sum, supplier) => sum + asNumber(supplier.trucking_cost_per_bottle), 0) / activeCount
      : 0;

  function addDraftRow() {
    setDraftRows((current) => [
      {
        id: `new-${Date.now()}`,
        importer_id: null,
        name: "",
        eta_days: 0,
        pick_up_location: "",
        freight_forwarder: "",
        order_frequency: "",
        tdm: "",
        trucking_cost_per_bottle: 0,
        notes: "",
        active: true
      },
      ...current
    ]);
  }

  function discardDraftRow(id: string) {
    setDraftRows((current) => current.filter((supplier) => supplier.id !== id));
  }

  return (
    <section className="panel supplier-hub-panel" id="supplier-hub">
      <div className="section-heading">
        <div>
          <h1>Supplier Hub</h1>
          <p>Manage logistics used by Order Review, freight rollups, TDM filtering, and PO landed-cost math.</p>
        </div>
        <button className="button button-small" onClick={addDraftRow} disabled={isPending}>
          Add Supplier
        </button>
      </div>
      <div className="supplier-hub-summary">
        <div>
          <span>Active</span>
          <strong>{formatInteger(activeCount)}</strong>
        </div>
        <div>
          <span>Inactive</span>
          <strong>{formatInteger(inactiveCount)}</strong>
        </div>
        <div>
          <span>Avg Laid In</span>
          <strong>{formatCurrency(averageLaidIn)}</strong>
        </div>
      </div>
      <div className="supplier-hub-toolbar">
        <label className="search-field">
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Supplier, TDM, pickup, notes"
          />
        </label>
        <label>
          Pickup
          <select value={pickupLocation} onChange={(event) => setPickupLocation(event.target.value)}>
            {pickupOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="check-control">
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          Show inactive
        </label>
        <span>{formatInteger(filteredRows.length)} shown</span>
      </div>
      <div className="table-shell logistics-table-shell">
        <table className="logistics-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Importer ID</th>
              <th>TDM</th>
              <th>Pickup</th>
              <th>Freight Forwarder</th>
              <th>Frequency</th>
              <th>ETA</th>
              <th>Laid In / Bottle</th>
              <th>Active</th>
              <th>Notes</th>
              <th>Save</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((supplier) => (
              <SupplierLogisticsRow
                key={supplier.id}
                supplier={supplier}
                disabled={isPending}
                onSaveSupplier={onSaveSupplier}
                onDiscardDraft={discardDraftRow}
              />
            ))}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={11}>
                  <div className="empty-inline">No suppliers match the current filters.</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SupplierLogisticsRow({
  supplier,
  disabled,
  onSaveSupplier,
  onDiscardDraft
}: {
  supplier: SupplierLogistics;
  disabled: boolean;
  onSaveSupplier: (supplier: SupplierLogistics) => void;
  onDiscardDraft: (id: string) => void;
}) {
  const [row, setRow] = useState(supplier);

  useEffect(() => {
    setRow(supplier);
  }, [supplier]);

  function patch(patchRow: Partial<SupplierLogistics>) {
    setRow((current) => ({ ...current, ...patchRow }));
  }

  const isNew = row.id.startsWith("new-");
  const isDirty = JSON.stringify(row) !== JSON.stringify(supplier);
  const rowClassName = [
    row.active === false ? "inactive-row" : "",
    isNew ? "draft-row" : "",
    !isNew && isDirty ? "dirty-row" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <tr className={rowClassName || undefined}>
      <td>
        <input aria-label="Supplier name" value={row.name} onChange={(event) => patch({ name: event.target.value })} />
      </td>
      <td>
        <input aria-label="Importer ID" value={row.importer_id || ""} onChange={(event) => patch({ importer_id: event.target.value })} />
      </td>
      <td>
        <input aria-label="TDM" value={row.tdm || ""} onChange={(event) => patch({ tdm: event.target.value })} />
      </td>
      <td>
        <input aria-label="Pickup location" value={row.pick_up_location || ""} onChange={(event) => patch({ pick_up_location: event.target.value })} />
      </td>
      <td>
        <input aria-label="Freight forwarder" value={row.freight_forwarder || ""} onChange={(event) => patch({ freight_forwarder: event.target.value })} />
      </td>
      <td>
        <input aria-label="Order frequency" value={row.order_frequency || ""} onChange={(event) => patch({ order_frequency: event.target.value })} />
      </td>
      <td>
        <input
          aria-label="ETA days"
          type="number"
          min={0}
          value={asNumber(row.eta_days)}
          onChange={(event) => patch({ eta_days: Number(event.target.value) })}
        />
      </td>
      <td>
        <input
          aria-label="Laid in per bottle"
          type="number"
          min={0}
          step={0.01}
          value={asNumber(row.trucking_cost_per_bottle)}
          onChange={(event) => patch({ trucking_cost_per_bottle: Number(event.target.value) })}
        />
      </td>
      <td>
        <input
          aria-label="Active"
          className="approval-input"
          type="checkbox"
          checked={row.active ?? true}
          onChange={(event) => patch({ active: event.target.checked })}
        />
      </td>
      <td>
        <input aria-label="Notes" value={row.notes || ""} onChange={(event) => patch({ notes: event.target.value })} />
      </td>
      <td>
        <div className="supplier-row-actions">
          {isNew ? <span className="row-state-badge">New</span> : null}
          {!isNew && isDirty ? <span className="row-state-badge">Unsaved</span> : null}
          <button className="button button-tiny" disabled={disabled || !row.name.trim() || (!isNew && !isDirty)} onClick={() => onSaveSupplier(row)}>
            {isNew ? "Add" : "Save"}
          </button>
          {isNew ? (
            <button className="ghost-button supplier-reset-button" disabled={disabled} onClick={() => onDiscardDraft(row.id)}>
              Cancel
            </button>
          ) : null}
          {!isNew && isDirty ? (
            <button className="ghost-button supplier-reset-button" disabled={disabled} onClick={() => setRow(supplier)}>
              Reset
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
