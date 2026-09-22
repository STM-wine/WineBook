import type { Recommendation } from "./types";
import { normalizeOrderingItemCode, ORDERING_BUILDER_VERSION, ORDERING_SOURCE } from "./source-backed-ordering";

type OrderingRunLike = {
  run_type?: string | null;
  diagnostics?: Record<string, any> | null;
};

type CatalogReconciliationRow = {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  display_name: string;
  planning_sku: string;
  quickbooks_sync_status: string | null;
};

type CatalogReconciliationUpdate = {
  id: string;
  values: Record<string, unknown>;
};

function normalizedIdentity(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceRowIdentity(row: Record<string, any>) {
  const code = normalizeOrderingItemCode(row.product_code);
  return code ? `code:${code}` : `sku:${normalizedIdentity(row.planning_sku)}`;
}

export function missingSourceRowsForRun(
  savedRows: Array<Record<string, any>>,
  currentRows: Array<Record<string, any>>
) {
  const savedIdentities = new Set(savedRows.map(sourceRowIdentity));
  return currentRows.filter((row) => !savedIdentities.has(sourceRowIdentity(row)));
}

export function catalogReconciliationUpdates(
  catalogRows: CatalogReconciliationRow[],
  currentRows: Array<Record<string, any>>,
  canonicalSupplierNames: ReadonlyMap<string, string>
): CatalogReconciliationUpdate[] {
  const sourceBySupplierAndSku = new Map<string, Record<string, any>>();
  const sourceBySupplierAndName = new Map<string, Record<string, any>>();

  currentRows.forEach((row) => {
    const supplierId = String(row.diagnostics?.supplier_id || "");
    if (!supplierId) return;
    const sku = normalizedIdentity(row.planning_sku);
    const name = normalizedIdentity(row.product_name);
    if (sku) sourceBySupplierAndSku.set(`${supplierId}:${sku}`, row);
    if (name) sourceBySupplierAndName.set(`${supplierId}:${name}`, row);
  });

  return catalogRows.flatMap((catalog) => {
    const canonicalSupplierName = catalog.supplier_id
      ? canonicalSupplierNames.get(catalog.supplier_id) || catalog.supplier_name
      : catalog.supplier_name;
    const supplierId = catalog.supplier_id || "";
    const source = supplierId
      ? sourceBySupplierAndSku.get(`${supplierId}:${normalizedIdentity(catalog.planning_sku)}`) ||
        sourceBySupplierAndName.get(`${supplierId}:${normalizedIdentity(catalog.display_name)}`)
      : null;
    const values: Record<string, unknown> = {};

    if (canonicalSupplierName && canonicalSupplierName !== catalog.supplier_name) {
      values.supplier_name = canonicalSupplierName;
    }
    if (source && !["linked", "created"].includes(catalog.quickbooks_sync_status || "")) {
      values.quickbooks_item_id = source.diagnostics?.quickbooks_item_list_id || null;
      values.quickbooks_item_name = source.product_name || null;
      values.quickbooks_item_number = source.product_code || null;
      values.quickbooks_sync_status = "linked";
      values.conversion_status = "exact_existing_product";
      values.product_lifecycle_status = "supplier_available";
      values.source_system = "quickbooks_desktop";
      values.source_id = source.diagnostics?.quickbooks_item_list_id || null;
    }

    return Object.keys(values).length > 0 ? [{ id: catalog.id, values }] : [];
  });
}

export function isSourceBackedRun(run: OrderingRunLike | null | undefined) {
  return run?.run_type === "quickbooks_sync" && run.diagnostics?.ordering_source === ORDERING_SOURCE;
}

export function sourceRunNeedsCurrentOverlay(run: OrderingRunLike | null | undefined) {
  if (!isSourceBackedRun(run)) return false;
  const builderVersion = Number(run?.diagnostics?.builder_version);
  return !Number.isFinite(builderVersion) || builderVersion < ORDERING_BUILDER_VERSION;
}

export function overlayCurrentSourceRows(recommendations: Recommendation[], currentRows: Array<Record<string, any>>) {
  const currentByCode = new Map(currentRows.map((row) => [normalizeOrderingItemCode(row.product_code), row]));
  return recommendations.map((recommendation) => {
    const current = currentByCode.get(normalizeOrderingItemCode(recommendation.product_code));
    if (!current) return recommendation;
    return {
      ...recommendation,
      ...current,
      id: recommendation.id,
      report_run_id: recommendation.report_run_id,
      recommendation_status: recommendation.recommendation_status,
      approved_qty: recommendation.approved_qty,
      order_path: recommendation.order_path
    } as Recommendation;
  });
}
