import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type QuickBooksItemSalesWindowRow = {
  item_list_id: string | null;
  item_full_name: string | null;
  last_30_quantity: number | string | null;
  last_60_quantity: number | string | null;
  last_90_quantity: number | string | null;
  prior_30_quantity: number | string | null;
  last_year_next_30_quantity: number | string | null;
  last_year_next_60_quantity: number | string | null;
  last_year_next_90_quantity: number | string | null;
};

const CACHE_MS = 5 * 60 * 1000;
const completedSales = new Map<string, { expiresAt: number; rows: QuickBooksItemSalesWindowRow[] }>();
const pendingSales = new Map<string, Promise<QuickBooksItemSalesWindowRow[]>>();

// A completed connector run has one sales history. Share its read across buyers
// and supplier refreshes, but never reuse it for another upload or cutoff. The
// caller must check for a partial import before reaching this function.
export async function fetchQuickBooksItemSalesWindows(
  supabase: SupabaseClient, referenceDate: string, completedSyncId?: string | null
) {
  if (!completedSyncId) return readSalesWindows(supabase, referenceDate);
  const key = `${completedSyncId}:${referenceDate}`;
  const cached = completedSales.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const pending = pendingSales.get(key);
  if (pending) return pending;
  const read = readSalesWindows(supabase, referenceDate).then((rows) => {
    for (const [oldKey, value] of completedSales) {
      if (value.expiresAt <= Date.now()) completedSales.delete(oldKey);
    }
    if (completedSales.size >= 4) completedSales.delete(completedSales.keys().next().value!);
    completedSales.set(key, { rows, expiresAt: Date.now() + CACHE_MS });
    return rows;
  }).finally(() => pendingSales.delete(key));
  pendingSales.set(key, read);
  return read;
}

async function readSalesWindows(supabase: SupabaseClient, referenceDate: string) {
  const read = () => supabase
    .rpc("quickbooks_item_sales_windows_payload", { p_reference_date: referenceDate })
    .returns<QuickBooksItemSalesWindowRow[]>();
  let result = await read();
  // This RPC only reads sales. Retry a canceled statement once; never retry PO
  // writes or rebuild their idempotency payload after an ambiguous write error.
  if (result.error?.code === "57014") {
    await new Promise((resolve) => setTimeout(resolve, 300));
    result = await read();
  }
  const { data, error } = result;

  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) {
    throw new Error("QuickBooks sales windows did not return a complete payload.");
  }

  return data;
}
