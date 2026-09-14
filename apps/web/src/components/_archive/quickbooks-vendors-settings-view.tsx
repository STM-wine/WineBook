"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveQuickBooksVendorMappings } from "@/app/actions";
import { dateTimeLabel } from "@/lib/date-labels";
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
const VENDOR_PAGE_SIZE = 100;
const GENERIC_SUPPLIER_WORDS = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "llc",
  "ltd",
  "merchant",
  "merchants",
  "selection",
  "selections",
  "vineyard",
  "vineyards",
  "wine",
  "winery",
  "wines"
]);

type SupplierIdentityCleanupRow = {
  vendor: QuickBooksVendor;
  currentSupplier: SupplierLogistics | null;
  supplierCandidates: SupplierLogistics[];
  vinosmithAliases: string[];
  status: "aligned" | "unmatched" | "duplicate_candidates" | "alias_mismatch";
  statusLabel: string;
  statusHelp: string;
};

export function QuickBooksVendorsSettingsView({
  vendors,
  mappings,
  suppliers,
  vinosmithImporters
}: {
  vendors: QuickBooksVendor[];
  mappings: QuickBooksVendorMapping[];
  suppliers: SupplierLogistics[];
  vinosmithImporters: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [editedMappings, setEditedMappings] = useState<QuickBooksVendorMapping[]>(mappings);
  const [baselineMappings, setBaselineMappings] = useState<QuickBooksVendorMapping[]>(mappings);
  const [search, setSearch] = useState("");
  const [classification, setClassification] = useState<QuickBooksVendorClassification | "All">("All");
  const [quickBooksType, setQuickBooksType] = useState("All");
  const [matchStatus, setMatchStatus] = useState<"All" | "matched" | "unmatched">("All");
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const mappingByVendorId = useMemo(
    () => new Map(editedMappings.map((mapping) => [mapping.quickbooks_vendor_list_id, mapping])),
    [editedMappings]
  );
  const originalByVendorId = useMemo(
    () => new Map(baselineMappings.map((mapping) => [mapping.quickbooks_vendor_list_id, mapping])),
    [baselineMappings]
  );
  const supplierOptions = useMemo(
    () => suppliers.filter((supplier) => supplier.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [suppliers]
  );
  const quickBooksTypeOptions = useMemo(() => {
    const labels = vendors.map(vendorTypeLabel).filter((label): label is string => Boolean(label));
    return ["All", ...Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b))];
  }, [vendors]);
  const activeVendors = vendors.filter((vendor) => vendor.is_active !== false).length;
  const matchedVendors = vendors.filter((vendor) => Boolean(mappingByVendorId.get(vendor.list_id)?.supplier_id)).length;
  const inventoryWineVendors = vendors.filter((vendor) => mappingForVendor(vendor, mappingByVendorId).vendor_classification === "inventory_wine").length;
  const changedMappings = useMemo(
    () => editedMappings.filter((mapping) => JSON.stringify(mappingForCompare(mapping)) !== JSON.stringify(mappingForCompare(originalByVendorId.get(mapping.quickbooks_vendor_list_id)))),
    [editedMappings, originalByVendorId]
  );
  const hasUnsavedChanges = changedMappings.length > 0;
  const [identitySearch, setIdentitySearch] = useState("");
  const [identityReviewOnly, setIdentityReviewOnly] = useState(true);

  useEffect(() => {
    setBaselineMappings(mappings);
    setEditedMappings(mappings);
  }, [mappings]);

  const identityCleanupRows = useMemo(
    () =>
      buildSupplierIdentityCleanupRows({
        vendors,
        suppliers,
        mappingByVendorId,
        supplierById,
        vinosmithImporters
      }),
    [mappingByVendorId, supplierById, suppliers, vendors, vinosmithImporters]
  );
  const visibleIdentityRows = useMemo(() => {
    const needle = identitySearch.trim().toLowerCase();
    return identityCleanupRows
      .filter((row) => !identityReviewOnly || row.status !== "aligned")
      .filter((row) => {
        if (!needle) return true;
        return [
          row.vendor.name,
          row.vendor.full_name,
          row.currentSupplier?.name,
          row.statusLabel,
          ...row.supplierCandidates.map((candidate) => candidate.name),
          ...row.vinosmithAliases
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .slice(0, 80);
  }, [identityCleanupRows, identityReviewOnly, identitySearch]);
  const reviewIdentityCount = identityCleanupRows.filter((row) => row.status !== "aligned").length;

  const filteredVendors = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return vendors.filter((vendor) => {
      const mapping = mappingForVendor(vendor, mappingByVendorId);
      const supplier = mapping.supplier_id ? supplierById.get(mapping.supplier_id) || null : null;
      const qbType = vendorTypeLabel(vendor);
      if (!showInactive && vendor.is_active === false) return false;
      if (classification !== "All" && mapping.vendor_classification !== classification) return false;
      if (quickBooksType !== "All" && qbType !== quickBooksType) return false;
      if (matchStatus === "matched" && !mapping.supplier_id) return false;
      if (matchStatus === "unmatched" && mapping.supplier_id) return false;
      if (!needle) return true;
      return [vendor.name, vendor.full_name, qbType, supplier?.name, mapping.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [classification, mappingByVendorId, matchStatus, quickBooksType, search, showInactive, supplierById, vendors]);
  const totalPages = Math.max(1, Math.ceil(filteredVendors.length / VENDOR_PAGE_SIZE));
  const pageStart = (Math.min(page, totalPages) - 1) * VENDOR_PAGE_SIZE;
  const visibleVendors = filteredVendors.slice(pageStart, pageStart + VENDOR_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [classification, matchStatus, quickBooksType, search, showInactive]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

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
    const mappingsToSave = changedMappings;
    setMessage(`Saving ${mappingsToSave.length.toLocaleString()} vendor classification change(s)...`);
    setErrorMessage("");

    startTransition(async () => {
      try {
        const result = await saveQuickBooksVendorMappings({
          mappings: mappingsToSave.map((row) => ({
            quickBooksVendorListId: row.quickbooks_vendor_list_id,
            supplierId: row.supplier_id || null,
            vendorClassification: row.vendor_classification,
            notes: row.notes || null
          }))
        });
        const savedAt = new Date().toISOString();
        setBaselineMappings((current) => mergeMappings(current, mappingsToSave));
        setEditedMappings((current) => mergeMappings(current, mappingsToSave));
        setMessage(`All changes saved at ${dateTimeLabel(savedAt)} (${result.saved.toLocaleString()} change(s)).`);
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
            aria-busy={isPending}
            className={`button button-small vendor-save-button ${isPending ? "vendor-save-button-saving" : ""}`}
            disabled={isPending || !hasUnsavedChanges}
            onClick={saveChanges}
            type="button"
          >
            <span>
              {isPending
                ? `Saving ${changedMappings.length.toLocaleString()}...`
                : hasUnsavedChanges
                  ? `Save ${changedMappings.length.toLocaleString()} Change${changedMappings.length === 1 ? "" : "s"}`
                  : "Saved"}
            </span>
          </button>
        </div>

        <div className={`vendor-save-state ${hasUnsavedChanges ? "vendor-save-state-dirty" : "vendor-save-state-clean"}`}>
          <strong>{hasUnsavedChanges ? `${changedMappings.length.toLocaleString()} unsaved change${changedMappings.length === 1 ? "" : "s"}` : "No unsaved changes"}</strong>
          <span>{message || (hasUnsavedChanges ? "Click Save Changes before leaving this page." : "Saved rows are written to Supabase vendor mappings.")}</span>
        </div>
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

        <section className="supplier-identity-cleanup" aria-label="Supplier identity cleanup">
          <div className="settings-panel-header">
            <div>
              <h2>Supplier Identity Cleanup</h2>
              <p className="muted">QuickBooks vendor is the canonical supplier identity. Pick which Supplier Logistics row attaches to it; duplicate rows stay intact for review.</p>
            </div>
            <span className="data-pill">{formatInteger(reviewIdentityCount)} need review</span>
          </div>
          <div className="supplier-hub-toolbar identity-cleanup-toolbar">
            <label className="search-field">
              Search
              <input
                value={identitySearch}
                onChange={(event) => setIdentitySearch(event.target.value)}
                placeholder="QB vendor, logistics row, Vinosmith importer"
              />
            </label>
            <label className="check-control">
              <input type="checkbox" checked={identityReviewOnly} onChange={(event) => setIdentityReviewOnly(event.target.checked)} />
              Review only
            </label>
            <span>{formatInteger(visibleIdentityRows.length)} shown</span>
          </div>
          <div className="table-shell identity-cleanup-table-shell">
            <table>
              <thead>
                <tr>
                  <th>QB Vendor</th>
                  <th>Canonical Logistics Row</th>
                  <th>Vinosmith Aliases</th>
                  <th>Duplicate Candidates</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleIdentityRows.map((row) => {
                  const mapping = mappingForVendor(row.vendor, mappingByVendorId);
                  const isDirty = JSON.stringify(mappingForCompare(mapping)) !== JSON.stringify(mappingForCompare(originalByVendorId.get(row.vendor.list_id)));
                  return (
                    <tr key={row.vendor.list_id} className={isDirty ? "dirty-row" : undefined}>
                      <td>
                        <strong>{row.vendor.name || row.vendor.full_name}</strong>
                        <span>{vendorTypeLabel(row.vendor) || "No QB type"}</span>
                      </td>
                      <td>
                        <select
                          value={mapping.supplier_id || ""}
                          onChange={(event) =>
                            patchMapping(row.vendor, {
                              supplier_id: event.target.value || null,
                              vendor_classification: event.target.value ? "inventory_wine" : mapping.vendor_classification
                            })
                          }
                          disabled={isPending}
                        >
                          <option value="">No supplier match</option>
                          {supplierOptions.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                          ))}
                        </select>
                        {row.currentSupplier ? <small>Current: {row.currentSupplier.name}</small> : <small>No current logistics row</small>}
                      </td>
                      <td>
                        {row.vinosmithAliases.length ? (
                          <div className="identity-chip-list">
                            {row.vinosmithAliases.slice(0, 4).map((alias) => <span key={alias}>{alias}</span>)}
                          </div>
                        ) : (
                          <small>No Vinosmith alias found</small>
                        )}
                      </td>
                      <td>
                        {row.supplierCandidates.length ? (
                          <div className="identity-candidate-list">
                            {row.supplierCandidates.slice(0, 4).map((supplier) => (
                              <button
                                className={mapping.supplier_id === supplier.id ? "identity-candidate active" : "identity-candidate"}
                                disabled={isPending}
                                key={supplier.id}
                                onClick={() => patchMapping(row.vendor, { supplier_id: supplier.id, vendor_classification: "inventory_wine" })}
                                type="button"
                              >
                                <strong>{supplier.name}</strong>
                                <small>ETA {formatInteger(Number(supplier.eta_days || 0))} / {moneyLabel(supplier.trucking_cost_per_bottle)}</small>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <small>No logistics candidates</small>
                        )}
                      </td>
                      <td>
                        <StatusPill value={row.statusLabel} />
                        <small>{row.statusHelp}</small>
                      </td>
                    </tr>
                  );
                })}
                {visibleIdentityRows.length === 0 ? <EmptyRow colSpan={5} label="No supplier identity rows match the current filters." /> : null}
              </tbody>
            </table>
          </div>
        </section>

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
            Stem Type
            <select value={classification} onChange={(event) => setClassification(event.target.value as typeof classification)}>
              <option>All</option>
              {VENDOR_CLASSIFICATIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            QB Type
            <select value={quickBooksType} onChange={(event) => setQuickBooksType(event.target.value)}>
              {quickBooksTypeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
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
          <span>
            {formatInteger(filteredVendors.length)} matched; showing {formatInteger(visibleVendors.length)}
          </span>
          <span>{formatInteger(changedMappings.length)} unsaved</span>
        </div>

        <div className="vendor-table-pager" aria-label="Vendor table pages">
          <span>
            Rows {filteredVendors.length === 0 ? "0" : formatInteger(pageStart + 1)}-
            {formatInteger(Math.min(pageStart + VENDOR_PAGE_SIZE, filteredVendors.length))} of {formatInteger(filteredVendors.length)}
          </span>
          <div>
            <button
              className="ghost-button small-ghost"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              Previous
            </button>
            <span>Page {formatInteger(page)} of {formatInteger(totalPages)}</span>
            <button
              className="ghost-button small-ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              type="button"
            >
              Next
            </button>
          </div>
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
              {visibleVendors.map((vendor) => {
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

function buildSupplierIdentityCleanupRows({
  vendors,
  suppliers,
  mappingByVendorId,
  supplierById,
  vinosmithImporters
}: {
  vendors: QuickBooksVendor[];
  suppliers: SupplierLogistics[];
  mappingByVendorId: Map<string, QuickBooksVendorMapping>;
  supplierById: Map<string, SupplierLogistics>;
  vinosmithImporters: string[];
}): SupplierIdentityCleanupRow[] {
  const activeSuppliers = suppliers.filter((supplier) => supplier.active !== false);
  const importerKeys = vinosmithImporters.map((name) => ({ name, keys: identityKeys(name) }));

  return vendors
    .filter((vendor) => {
      const mapping = mappingForVendor(vendor, mappingByVendorId);
      return vendor.is_active !== false && (vendorTypeLabel(vendor) === "Suppliers" || mapping.vendor_classification === "inventory_wine");
    })
    .map((vendor) => {
      const vendorKeys = identityKeys(vendor.name || vendor.full_name);
      const mapping = mappingForVendor(vendor, mappingByVendorId);
      const currentSupplier = mapping.supplier_id ? supplierById.get(mapping.supplier_id) || null : null;
      const candidateMap = new Map<string, SupplierLogistics>();
      activeSuppliers.forEach((supplier) => {
        if (hasIdentityOverlap(vendorKeys, identityKeys(supplier.name))) {
          candidateMap.set(supplier.id, supplier);
        }
      });
      if (currentSupplier) {
        candidateMap.set(currentSupplier.id, currentSupplier);
      }

      const candidateKeys = Array.from(candidateMap.values()).flatMap((supplier) => identityKeys(supplier.name));
      const vinosmithAliases = importerKeys
        .filter((importer) => hasIdentityOverlap(vendorKeys, importer.keys) || hasIdentityOverlap(candidateKeys, importer.keys))
        .map((importer) => importer.name)
        .slice(0, 8);

      const supplierCandidates = Array.from(candidateMap.values()).sort((a, b) => {
        if (a.id === mapping.supplier_id) return -1;
        if (b.id === mapping.supplier_id) return 1;
        const aAlias = vinosmithAliases.some((alias) => hasIdentityOverlap(identityKeys(alias), identityKeys(a.name)));
        const bAlias = vinosmithAliases.some((alias) => hasIdentityOverlap(identityKeys(alias), identityKeys(b.name)));
        if (aAlias !== bAlias) return aAlias ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const aliasMatchesCurrent = currentSupplier
        ? vinosmithAliases.some((alias) => hasIdentityOverlap(identityKeys(alias), identityKeys(currentSupplier.name)))
        : false;
      const status: SupplierIdentityCleanupRow["status"] =
        !currentSupplier
          ? "unmatched"
          : supplierCandidates.length > 1
            ? "duplicate_candidates"
            : vinosmithAliases.length > 0 && !aliasMatchesCurrent
              ? "alias_mismatch"
              : "aligned";

      return {
        vendor,
        currentSupplier,
        supplierCandidates,
        vinosmithAliases,
        status,
        ...identityStatusCopy(status, supplierCandidates.length)
      };
    })
    .sort((a, b) => {
      const statusRank: Record<SupplierIdentityCleanupRow["status"], number> = { duplicate_candidates: 0, alias_mismatch: 1, unmatched: 2, aligned: 3 };
      const rankDelta = statusRank[a.status] - statusRank[b.status];
      if (rankDelta !== 0) return rankDelta;
      return (a.vendor.name || a.vendor.full_name).localeCompare(b.vendor.name || b.vendor.full_name);
    });
}

function identityStatusCopy(status: SupplierIdentityCleanupRow["status"], candidateCount: number) {
  if (status === "unmatched") {
    return {
      statusLabel: "Needs supplier row",
      statusHelp: "No Supplier Logistics row is attached to this QB vendor yet."
    };
  }
  if (status === "duplicate_candidates") {
    return {
      statusLabel: "Review duplicates",
      statusHelp: `${formatInteger(candidateCount)} Supplier Logistics rows look related. Pick the canonical row.`
    };
  }
  if (status === "alias_mismatch") {
    return {
      statusLabel: "Review alias",
      statusHelp: "Vinosmith importer alias points at a different-looking logistics name."
    };
  }
  return {
    statusLabel: "Aligned",
    statusHelp: "QB vendor, Supplier Logistics, and Vinosmith alias look aligned."
  };
}

function identityKeys(value: string | null | undefined) {
  const raw = value || "";
  const normalized = normalizeIdentity(raw);
  if (!normalized) return [];
  const keys = new Set<string>([normalized, stripGenericSupplierWords(normalized)]);
  raw
    .split(/\s+-\s+|\s+–\s+|\s+—\s+/)
    .map((part) => stripGenericSupplierWords(normalizeIdentity(part)))
    .filter(Boolean)
    .forEach((part) => keys.add(part));
  return Array.from(keys).filter((key) => key.length >= 3);
}

function normalizeIdentity(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripGenericSupplierWords(value: string) {
  const words = value.split(" ").filter((word) => !GENERIC_SUPPLIER_WORDS.has(word));
  return words.join(" ").trim() || value;
}

function hasIdentityOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  return left.some((key) => rightSet.has(key));
}

function moneyLabel(value: number | string | null | undefined) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
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

function mergeMappings(current: QuickBooksVendorMapping[], updates: QuickBooksVendorMapping[]) {
  const byVendorId = new Map(current.map((mapping) => [mapping.quickbooks_vendor_list_id, mapping]));
  updates.forEach((mapping) => {
    byVendorId.set(mapping.quickbooks_vendor_list_id, mapping);
  });
  return Array.from(byVendorId.values());
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
