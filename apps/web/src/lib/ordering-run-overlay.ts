import type { Recommendation } from "./types";
import { normalizeOrderingItemCode, ORDERING_BUILDER_VERSION, ORDERING_SOURCE } from "./source-backed-ordering";

type OrderingRunLike = {
  run_type?: string | null;
  report_date?: string | null;
  diagnostics?: Record<string, any> | null;
};

type CatalogReconciliationRow = {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  display_name: string;
  planning_sku: string;
  quickbooks_item_number: string | null;
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
  const sourceBySupplierAndSku = new Map<string, Array<Record<string, any>>>();
  const sourceBySupplierAndName = new Map<string, Array<Record<string, any>>>();
  const sourceByItemCode = new Map<string, Array<Record<string, any>>>();

  const addCandidate = (
    index: Map<string, Array<Record<string, any>>>,
    key: string,
    row: Record<string, any>
  ) => {
    if (!key) return;
    index.set(key, [...(index.get(key) || []), row]);
  };

  const uniqueCandidate = (index: Map<string, Array<Record<string, any>>>, key: string) => {
    const candidates = key ? index.get(key) || [] : [];
    return candidates.length === 1 ? candidates[0] : null;
  };

  currentRows.forEach((row) => {
    const supplierId = String(row.diagnostics?.supplier_id || "");
    if (!supplierId) return;
    const sku = normalizedIdentity(row.planning_sku);
    const name = normalizedIdentity(row.product_name);
    const itemCode = normalizeOrderingItemCode(row.product_code);
    if (sku) addCandidate(sourceBySupplierAndSku, `${supplierId}:${sku}`, row);
    if (name) addCandidate(sourceBySupplierAndName, `${supplierId}:${name}`, row);
    if (itemCode) addCandidate(sourceByItemCode, itemCode, row);
  });

  return catalogRows.flatMap((catalog) => {
    const supplierId = catalog.supplier_id || "";
    const itemCode = normalizeOrderingItemCode(catalog.quickbooks_item_number);
    const source = uniqueCandidate(sourceByItemCode, itemCode) ||
      (supplierId
        ? uniqueCandidate(sourceBySupplierAndSku, `${supplierId}:${normalizedIdentity(catalog.planning_sku)}`) ||
          uniqueCandidate(sourceBySupplierAndName, `${supplierId}:${normalizedIdentity(catalog.display_name)}`)
        : null);
    const sourceSupplierId = String(source?.diagnostics?.supplier_id || "");
    const canonicalSupplierId = supplierId || sourceSupplierId;
    const canonicalSupplierName = canonicalSupplierId
      ? canonicalSupplierNames.get(canonicalSupplierId) || catalog.supplier_name
      : catalog.supplier_name;
    const values: Record<string, unknown> = {};

    if (!catalog.supplier_id && sourceSupplierId) {
      values.supplier_id = sourceSupplierId;
    }
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

export function sourceRunNeedsCurrentOverlay(
  run: OrderingRunLike | null | undefined,
  businessDate = phoenixBusinessDate()
) {
  if (!isSourceBackedRun(run)) return false;
  const builderVersion = Number(run?.diagnostics?.builder_version);
  return !Number.isFinite(builderVersion) ||
    builderVersion < ORDERING_BUILDER_VERSION ||
    Boolean(run?.report_date && run.report_date < businessDate);
}

function phoenixBusinessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
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
