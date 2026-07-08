import {
  productRowToCandidate,
  quickbooksItemRowToCandidate,
  recommendationRowToCandidate,
  supplierCatalogRowToCandidate,
  vinosmithWineRowToCandidate,
  type ProductIdentityCandidate
} from "@/lib/product-identity-search";

const MAX_SOURCE_ROWS = 5000;
const RECENT_REPORT_RUN_COUNT = 8;

type ProductIdentitySearchClient = {
  from: (table: string) => any;
};

type ProductIdentitySourceLoadOptions = {
  ignoreSourceErrors?: boolean;
  onSourceError?: (source: string, message: string) => void;
};

type SourceResult<T = Record<string, unknown>> = { data: T[] | null; error: { message: string } | null };

export async function fetchProductIdentitySearchCandidates(
  searchSupabase: ProductIdentitySearchClient,
  options: ProductIdentitySourceLoadOptions = {}
): Promise<ProductIdentityCandidate[]> {
  const [supplierResult, catalogResult, productsResult, reportRunsResult, vinosmithResult, quickbooksResult] = await Promise.all([
    searchSupabase
      .from("suppliers")
      .select("id,name,trucking_cost_per_bottle")
      .limit(MAX_SOURCE_ROWS),
    searchSupabase
      .from("supplier_catalog_wines")
      .select(`
        id,
        supplier_id,
        supplier_name,
        producer,
        wine_name,
        vintage,
        pack_size,
        bottle_size,
        fob_bottle,
        fob_case,
        laid_in_per_bottle,
        frontline_bottle_price,
        best_price,
        gross_profit_margin,
        display_name,
        planning_sku,
        planning_sku_without_vintage,
        quickbooks_item_number,
        quickbooks_item_name,
        product_lifecycle_status,
        system_tags,
        updated_at
      `)
      .neq("product_lifecycle_status", "inactive")
      .limit(MAX_SOURCE_ROWS),
    searchSupabase
      .from("products")
      .select("id,planning_sku,product_code,name,vintage,pack_size,is_btg,is_core,supplier_id,current_fob,active,updated_at")
      .eq("active", true)
      .limit(MAX_SOURCE_ROWS),
    searchSupabase
      .from("report_runs")
      .select("id")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(RECENT_REPORT_RUN_COUNT),
    searchSupabase
      .from("vinosmith_wines")
      .select(`
        wine_id,
        code,
        name,
        vintage,
        supplier_id,
        importer_name,
        producer_name,
        unit_set,
        bottle_size,
        bottle_size_label,
        fob_price,
        active,
        orderable,
        core,
        last_seen_at
      `)
      .or("active.is.null,active.eq.true")
      .limit(MAX_SOURCE_ROWS),
    searchSupabase
      .from("quickbooks_items")
      .select("list_id,name,full_name,is_active,sales_desc,purchase_desc,sales_price,purchase_cost,custom_fields,time_modified,last_seen_at")
      .or("is_active.is.null,is_active.eq.true")
      .limit(MAX_SOURCE_ROWS)
  ]);

  const supplierRows = sourceRows("suppliers", supplierResult, options);
  const catalogRows = sourceRows("supplier_catalog_wines", catalogResult, options);
  const productRows = sourceRows("products", productsResult, options);
  const reportRunRows = sourceRows("report_runs", reportRunsResult, options);
  const vinosmithRows = sourceRows("vinosmith_wines", vinosmithResult, options);
  const quickbooksRows = sourceRows("quickbooks_items", quickbooksResult, options);

  const reportRunIds = reportRunRows.map((run: { id?: string | null }) => run.id).filter(Boolean);
  const recommendationResult = reportRunIds.length
    ? await searchSupabase
        .from("reorder_recommendations")
        .select(`
          id,
          report_run_id,
          planning_sku,
          product_name,
          product_code,
          supplier_name,
          is_btg,
          is_core,
          fob,
          pack_size,
          trucking_cost_per_bottle,
          created_at
        `)
        .in("report_run_id", reportRunIds)
        .limit(MAX_SOURCE_ROWS)
    : { data: [], error: null };

  const recommendationRows = sourceRows("reorder_recommendations", recommendationResult, options);

  const supplierById = new Map<string, { name: string; truckingCostPerBottle: number }>(
    supplierRows.map((supplier: Record<string, unknown>) => [
      String(supplier.id),
      {
        name: String(supplier.name || "No supplier"),
        truckingCostPerBottle: Number(supplier.trucking_cost_per_bottle || 0)
      }
    ] as const)
  );

  return dedupeProductIdentityCandidates([
    ...catalogRows.map((row: Record<string, unknown>) => supplierCatalogRowToCandidate(row)),
    ...productRows.map((row: Record<string, unknown>) => productRowToCandidate(row, supplierById)),
    ...quickbooksRows.map((row: Record<string, unknown>) => quickbooksItemRowToCandidate(row)),
    ...recommendationRows.map((row: Record<string, unknown>) => recommendationRowToCandidate(row)),
    ...vinosmithRows.map((row: Record<string, unknown>) => vinosmithWineRowToCandidate({ ...row, updated_at: row.last_seen_at }))
  ]);
}

function sourceRows<T extends Record<string, unknown>>(source: string, result: SourceResult<T>, options: ProductIdentitySourceLoadOptions): T[] {
  if (!result.error) return result.data || [];
  if (!options.ignoreSourceErrors) throw new Error(result.error.message);
  options.onSourceError?.(source, result.error.message);
  return [];
}

export function dedupeProductIdentityCandidates(candidates: ProductIdentityCandidate[]) {
  const byKey = new Map<string, ProductIdentityCandidate>();
  for (const candidate of candidates) {
    const key = candidate.planningSku || `${candidate.source}:${candidate.sourceId}`;
    const existing = byKey.get(key);
    if (!existing || sourceRank(candidate.source) < sourceRank(existing.source)) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values());
}

function sourceRank(source: ProductIdentityCandidate["source"]) {
  return ["supplier_catalog", "product", "recommendation", "vinosmith", "quickbooks_item"].indexOf(source);
}
