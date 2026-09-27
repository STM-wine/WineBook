import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceChangeEvent, SupplierCatalogWine, WineRequest } from "./types";
import { fetchAllExact } from "./supabase/fetch-all-exact";

// The Hub is a company-wide workflow. Read every page so its queues, searches
// and counts remain complete without requiring a supplier selection first.
export async function fetchSupplierHubData(db: SupabaseClient) {
  const [catalog, requests, priceChanges] = await Promise.all([
    fetchAllExact<SupplierCatalogWine>("supplier catalog", (from, to) => db.from("supplier_catalog_wines")
      .select("*,price_levels:supplier_catalog_price_levels(*),free_goods:supplier_catalog_free_goods(*),workbench_items:supplier_catalog_workbench_items(*)", { count: "exact" })
      .order("id").range(from, to) as never),
    fetchAllExact<WineRequest>("wine requests", (from, to) => db.from("wine_requests").select("*", { count: "exact" })
      .order("created_at", { ascending: false }).order("id").range(from, to) as never),
    fetchAllExact<PriceChangeEvent>("price changes", (from, to) => db.from("price_change_events").select("*", { count: "exact" })
      .order("created_at", { ascending: false }).order("id").range(from, to) as never)
  ]);
  return { catalog, requests, priceChanges };
}
