import type { SupabaseClient } from "@supabase/supabase-js";
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
