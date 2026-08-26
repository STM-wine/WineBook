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
  const { data, error } = await supabase
    .rpc("quickbooks_item_sales_windows", { p_reference_date: referenceDate })
    .returns<QuickBooksItemSalesWindowRow[]>();
  if (error) throw new Error(error.message);
  return (data || []) as unknown as QuickBooksItemSalesWindowRow[];
}
