import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyQuickBooksOnOrderToRecommendations,
  type QuickBooksOnOrderItem
} from "@/lib/quickbooks-on-order";
import type { Recommendation } from "@/lib/types";

const RECOMMENDATION_PAGE_SIZE = 1000;

export async function fetchAllRecommendationsForRun(supabase: SupabaseClient, reportRunId: string) {
  const rows: Recommendation[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("reorder_recommendations")
      .select("*")
      .eq("report_run_id", reportRunId)
      .order("id", { ascending: true })
      .range(from, from + RECOMMENDATION_PAGE_SIZE - 1)
      .returns<Recommendation[]>();

    if (error) {
      throw new Error(error.message);
    }

    const page = data || [];
    rows.push(...page);

    if (page.length < RECOMMENDATION_PAGE_SIZE) {
      break;
    }

    from += RECOMMENDATION_PAGE_SIZE;
  }

  return rows;
}

export async function fetchRecommendationsWithQuickBooksOnOrderForRun(supabase: SupabaseClient, reportRunId: string) {
  const [recommendations, quickBooksItems] = await Promise.all([
    fetchAllRecommendationsForRun(supabase, reportRunId),
    fetchQuickBooksOnOrderItems(supabase)
  ]);

  return applyQuickBooksOnOrderToRecommendations(recommendations, quickBooksItems);
}

export async function fetchQuickBooksOnOrderItems(supabase: SupabaseClient) {
  const rows: QuickBooksOnOrderItem[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("quickbooks_items")
      .select("list_id,name,full_name,is_active,item_type,quantity_on_order,custom_fields")
      .order("list_id", { ascending: true })
      .range(from, from + RECOMMENDATION_PAGE_SIZE - 1)
      .returns<QuickBooksOnOrderItem[]>();

    if (error) {
      throw new Error(error.message);
    }

    const page = data || [];
    rows.push(...page);

    if (page.length < RECOMMENDATION_PAGE_SIZE) {
      break;
    }

    from += RECOMMENDATION_PAGE_SIZE;
  }

  return rows;
}
