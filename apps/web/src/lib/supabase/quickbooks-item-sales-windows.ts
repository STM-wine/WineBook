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

export async function fetchQuickBooksItemSalesWindows(supabase: SupabaseClient, referenceDate: string) {
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
