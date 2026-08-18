"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveQuickBooksVendorMappings } from "@/app/actions";
import { formatInteger } from "@/lib/order-data";
import type {
  QuickBooksVendor,
  QuickBooksVendorClassification,
  QuickBooksVendorMapping,
  SupplierLogistics
} from "@/lib/types";

const VENDOR_CLASSIFICATIONS: Array<{ value: QuickBooksVendorClassification; label: string }> = [
  { value: "unclassified", label: "Unclassified" },
  { value: "inventory_wine", label: "Inventory / Wine" },
  { value: "freight_logistics", label: "Freight / Logistics" },
  { value: "service_expense", label: "Service / Expense" },
  { value: "other", label: "Other" }
];

export function QuickBooksVendorsSettingsView({
  vendors,
  mappings,
  suppliers
}: {
  vendors: QuickBooksVendor[];
  mappings: QuickBooksVendorMapping[];
  suppliers: SupplierLogistics[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editedMappings, setEditedMappings] = useState<QuickBooksVendorMapping[]>(mappings);
  const [search, setSearch] = useState("");
  const [classification, setClassification] = useState<QuickBooksVendorClassification | "All">("All");
  const [matchStatus, setMatchStatus] = useState<"All" | "matched" | "unmatched">("All");
  const [showInactive, setShowInactive] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const mappingByVendorId = useMemo(
    () => new Map(editedMappings.map((mapping) => [mapping.quickbooks_vendor_list_id, mapping])),
    [editedMappings]
  );
  const originalByVendorId = useMemo(
    () => new Map(mappings.map((mapping) => [mapping.quickbooks_vendor_list_id, mapping])),
    [mappings]
  );
  const supplierOptions = useMemo(
    () => suppliers.filter((supplier) => supplier.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [suppliers]
  );
  const activeVendors = vendors.filter((vendor) => vendor.is_active !== false).length;
  const matchedVendors = vendors.filter((vendor) => Boolean(mappingByVendorId.get(vendor.list_id)?.supplier_id)).length;
  const inventoryWineVendors = vendors.filter((vendor) => mappingForVendor(vendor, mappingByVendorId).vendor_classification === "inventory_wine").length;
  const changedMappings = useMemo(
    () => editedMappings.filter((mapping) => JSON.stringify(mappingForCompare(mapping)) !== JSON.stringify(mappingForCompare(originalByVendorId.get(mapping.quickbooks_vendor_list_id)))),
    [editedMappings, originalByVendorId]
  );

  const filteredVendors = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return vendors.filter((vendor) => {
      const mapping = mappingForVendor(vendor, mappingByVendorId);
      const supplier = mapping.supplier_id ? supplierById.get(mapping.supplier_id) || null : null;
      if (!showInactive && vendor.is_active === false) return false;
      if (classification !== "All" && mapping.vendor_classification !== classification) return false;
      if (matchStatus === "matched" && !mapping.supplier_id) return false;
      if (matchStatus === "unmatched" && mapping.supplier_id) return false;
      if (!needle) return true;
      return [vendor.name, vendor.full_name, vendorTypeLabel(vendor), supplier?.name, mapping.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [classification, mappingByVendorId, matchStatus, search, showInactive, supplierById, vendors]);

  function patchMapping(vendor: QuickBooksVendor, patch: Partial<QuickBooksVendorMapping>) {
    setMessage("");
    setErrorMessage("");
    setEditedMappings((current) => {
      const nextMapping = {
        ...mappingForVendor(vendor, new Map(current.map((mapping) => [mapping.quickbooks_vendor_list_id, mapping]))),
        ...patch
      };
      const withoutCurrent = current.filter((mapping) => mapping.quickbooks_vendor_list_id !== vendor.list_id);
      return [...withoutCurrent, nextMapping];
    });
  }

  function resetMapping(vendor: QuickBooksVendor) {
    const original = originalByVendorId.get(vendor.list_id);
    setEditedMappings((current) => {
      const withoutCurrent = current.filter((mapping) => mapping.quickbooks_vendor_list_id !== vendor.list_id);
      return original ? [...withoutCurrent, original] : withoutCurrent;
    });
  }

  function saveChanges() {
    if (changedMappings.length === 0) return;
    setMessage(`Saving ${changedMappings.length.toLocaleString()} vendor classification change(s)...`);
    setErrorMessage("");

    startTransition(async () => {
      try {
        const result = await saveQuickBooksVendorMappings({
          mappings: changedMappings.map((row) => ({
            quickBooksVendorListId: row.quickbooks_vendor_list_id,
            supplierId: row.supplier_id || null,
            vendorClassification: row.vendor_classification,
            notes: row.notes || null
          }))
        });
        setMessage(`Vendor classifications saved (${result.saved.toLocaleString()} change(s)).`);
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not save vendor classifications.");
        setMessage("");
      }
    });
  }

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Accounting Sources</p>
        <h1>QuickBooks Vendors</h1>
        <p className="muted">Classify QB vendors and match inventory suppliers to Stem logistics rows. QuickBooks remains the vendor source of truth.</p>
      </header>

      <section className="settings-panel supplier-hub-workspace">
        <div className="settings-panel-header">
          <div>
            <h2>Vendor Mapping</h2>
            <p className="muted">Admin-only setup for accounting vendors, supplier matching, and future expense workflows.</p>
          </div>
          <button
            className="button button-small"
            disabled={isPending || changedMappings.length === 0}
            onClick={saveChanges}
            type="button"
          >
            Save Changes
          </button>
        </div>

        {message ? <p className="muted">{message}</p> : null}
        {errorMessage ? <div className="warning-banner">{errorMessage}</div> : null}

        <div className="supplier-hub-summary logistics-summary">
          <div>
            <span>QB Vendors</span>
            <strong>{formatInteger(vendors.length)}</strong>
          </div>
          <div>
            <span>Active</span>
            <strong>{formatInteger(activeVendors)}</strong>
          </div>
          <div>
            <span>Inventory / Wine</span>
            <strong>{formatInteger(inventoryWineVendors)}</strong>
          </div>
          <div>
            <span>Matched</span>
            <strong>{formatInteger(matchedVendors)}</strong>
          </div>
        </div>

        <div className="supplier-hub-toolbar">
          <label className="search-field">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Vendor, supplier, type, notes"
            />
          </label>
          <label>
            Type
            <select value={classification} onChange={(event) => setClassification(event.target.value as typeof classification)}>
              <option>All</option>
              {VENDOR_CLASSIFICATIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Match
            <select value={matchStatus} onChange={(event) => setMatchStatus(event.target.value as typeof matchStatus)}>
              <option>All</option>
              <option value="matched">Matched</option>
              <option value="unmatched">Unmatched</option>
            </select>
          </label>
          <label className="check-control">
            <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
            Show inactive
          </label>
          <span>{formatInteger(filteredVendors.length)} shown</span>
          <span>{formatInteger(changedMappings.length)} unsaved</span>
        </div>

        <div className="table-shell qb-vendor-table-shell">
          <table>
            <thead>
              <tr>
                <th>QB Vendor</th>
                <th>QB Type</th>
                <th>Active</th>
                <th>Stem Type</th>
                <th>Matched Supplier</th>
                <th>Notes</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {filteredVendors.map((vendor) => {
                const mapping = mappingForVendor(vendor, mappingByVendorId);
                const original = originalByVendorId.get(vendor.list_id);
                const isDirty = JSON.stringify(mappingForCompare(mapping)) !== JSON.stringify(mappingForCompare(original));
                return (
                  <tr key={vendor.list_id} className={`${vendor.is_active === false ? "inactive-row" : ""} ${isDirty ? "dirty-row" : ""}`.trim() || undefined}>
                    <td>
                      <strong>{vendor.name || vendor.full_name}</strong>
                      <span>{vendor.list_id}</span>
                    </td>
                    <td>{vendorTypeLabel(vendor) || "-"}</td>
                    <td>{vendor.is_active === false ? "Inactive" : "Active"}</td>
                    <td>
                      <select
                        value={mapping.vendor_classification}
                        onChange={(event) => patchMapping(vendor, { vendor_classification: event.target.value as QuickBooksVendorClassification })}
                        disabled={isPending}
                      >
                        {VENDOR_CLASSIFICATIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={mapping.supplier_id || ""}
                        onChange={(event) => patchMapping(vendor, { supplier_id: event.target.value || null })}
                        disabled={isPending}
                      >
                        <option value="">No supplier match</option>
                        {supplierOptions.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={mapping.notes || ""}
                        onChange={(event) => patchMapping(vendor, { notes: event.target.value })}
                        disabled={isPending}
                        placeholder="Review note"
                      />
                    </td>
                    <td>
                      {isDirty ? (
                        <button className="ghost-button small-ghost" onClick={() => resetMapping(vendor)} disabled={isPending} type="button">
                          Reset
                        </button>
                      ) : (
                        <StatusPill value={mapping.supplier_id ? "matched" : mapping.vendor_classification} />
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredVendors.length === 0 ? <EmptyRow colSpan={7} label="No QuickBooks vendors match the current filters." /> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function mappingForVendor(vendor: QuickBooksVendor, mappingByVendorId: Map<string, QuickBooksVendorMapping>): QuickBooksVendorMapping {
  return mappingByVendorId.get(vendor.list_id) || {
    quickbooks_vendor_list_id: vendor.list_id,
    supplier_id: null,
    vendor_classification: "unclassified",
    notes: null,
    updated_by: null,
    updated_at: null
  };
}

function mappingForCompare(mapping: QuickBooksVendorMapping | undefined) {
  if (!mapping) return null;
  return {
    quickbooks_vendor_list_id: mapping.quickbooks_vendor_list_id,
    supplier_id: mapping.supplier_id || null,
    vendor_classification: mapping.vendor_classification,
    notes: mapping.notes || null
  };
}

function vendorTypeLabel(vendor: QuickBooksVendor) {
  const rawData = vendor.raw_data || {};
  const vendorTypeRef = rawData.vendor_type_ref;
  if (!vendorTypeRef || typeof vendorTypeRef !== "object" || Array.isArray(vendorTypeRef)) return "";
  const fullName = (vendorTypeRef as Record<string, unknown>).FullName;
  return typeof fullName === "string" ? fullName : "";
}

function StatusPill({ value }: { value: string | null | undefined }) {
  const text = value || "unknown";
  const className = text.includes("matched") || text.includes("inventory") ? "status-good" : text.includes("unclassified") ? "status-progress" : "status-muted";
  return <span className={`status-pill ${className}`}>{text.replace(/_/g, " ")}</span>;
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="empty-inline">{label}</div>
      </td>
    </tr>
  );
}
