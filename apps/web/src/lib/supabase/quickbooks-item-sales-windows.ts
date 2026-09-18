import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

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
  const rows: QuickBooksItemSalesWindowRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc("quickbooks_item_sales_windows", { p_reference_date: referenceDate })
      .range(from, from + PAGE_SIZE - 1)
      .returns<QuickBooksItemSalesWindowRow[]>();

    if (error) throw new Error(error.message);

    const page = (data || []) as unknown as QuickBooksItemSalesWindowRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
