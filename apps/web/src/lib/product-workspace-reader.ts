import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PRODUCT_FORMULA_VERSION = "product-workspace-v1";
export const PRODUCT_PAGE_SIZE = 75;

export function productFilters(params: URLSearchParams) {
  return {
    includeInactive: params.get("includeInactive") === "true",
    search: (params.get("search") || "").trim(),
    supplier: params.get("supplier") || "All",
    status: params.get("status") || "All",
    health: params.get("health") || "All"
  };
}

export async function readProductWorkspace(supabase: SupabaseClient, params: URLSearchParams) {
  const mode = params.get("mode") || "page";
  if (!["page", "counts", "detail", "export"].includes(mode)) throw new Error("Invalid product operation.");
  let snapshotId = params.get("snapshot");
  if (!snapshotId) {
    // Requesting work is cheap; browsers never rebuild the catalog.
    const { error } = await supabase.rpc("request_read_model", {
      p_kind: "products", p_key: "catalog", p_formula: PRODUCT_FORMULA_VERSION, p_request: {}
    });
    if (error) throw new Error(`Product read model unavailable: ${error.message}`);
    const { data, error: readError } = await supabase.from("read_model_jobs")
      .select("id").eq("kind", "products").eq("formula_version", PRODUCT_FORMULA_VERSION)
      .eq("status", "completed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!data) throw new Error("Product snapshot is being prepared. Retry shortly; the read-model worker must be running.");
    snapshotId = data.id;
  }
  const offset = Number(params.get("offset") || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid product offset.");
  const { data, error } = await supabase.rpc("read_product_workspace", {
    p_snapshot: snapshotId, p_filters: productFilters(params), p_offset: offset,
    p_limit: mode === "export" ? 1000 : PRODUCT_PAGE_SIZE + 1,
    p_sort: params.get("sort") || "productName", p_direction: params.get("direction") || "asc",
    p_mode: mode, p_id: params.get("id")
  });
  if (error) throw new Error(error.message);
  if (mode !== "page") return data;
  return { ...data, data: undefined, rows: data.data.slice(0, PRODUCT_PAGE_SIZE),
    hasMore: data.data.length > PRODUCT_PAGE_SIZE, offset, pageSize: PRODUCT_PAGE_SIZE };
}
