import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyQuickBooksOnOrderToRecommendations,
  type QuickBooksOnOrderItem
} from "@/lib/quickbooks-on-order";
import type { Recommendation } from "@/lib/types";
import {
  applyCompletedQuickBooksOnOrderSnapshot,
  assertCompletedQuickBooksSnapshotCount,
  type QuickBooksOnOrderSnapshotRow
} from "../quickbooks-on-order-snapshot";
import { fetchAllExact } from "./fetch-all-exact";

const RECOMMENDATION_PAGE_SIZE = 1000;

type CompletedQuickBooksRun = {
  id: string;
  diagnostics: {
    resources?: Record<string, { rows?: unknown }>;
  } | null;
};

export async function fetchAllRecommendationsForRun(supabase: SupabaseClient, reportRunId: string) {
  return fetchAllExact<Recommendation>("reorder recommendations", (from, to) => supabase
      .from("reorder_recommendations")
      .select("*", { count: "exact" })
      .eq("report_run_id", reportRunId)
      .order("id", { ascending: true })
      .range(from, to)
      .returns<Recommendation[]>() as never,
    RECOMMENDATION_PAGE_SIZE
  );
}

export async function fetchRecommendationsWithQuickBooksOnOrderForRun(supabase: SupabaseClient, reportRunId: string) {
  const [recommendations, quickBooksItems] = await Promise.all([
    fetchAllRecommendationsForRun(supabase, reportRunId),
    fetchQuickBooksOnOrderItems(supabase)
  ]);

  return applyQuickBooksOnOrderToRecommendations(recommendations, quickBooksItems);
}

export async function fetchQuickBooksOnOrderItems(supabase: SupabaseClient) {
  const [items, snapshots] = await Promise.all([
    fetchAllExact<QuickBooksOnOrderItem>("QuickBooks on-order items", (from, to) => supabase
      .from("quickbooks_items")
      .select("list_id,name,full_name,is_active,item_type,quantity_on_order,custom_fields", { count: "exact" })
      .order("list_id", { ascending: true })
      .range(from, to)
      .returns<QuickBooksOnOrderItem[]>() as never,
      RECOMMENDATION_PAGE_SIZE
    ),
    fetchLatestCompletedQuickBooksOnOrderSnapshot(supabase)
  ]);
  if (snapshots === null) return items;
  return applyCompletedQuickBooksOnOrderSnapshot(items, snapshots);
}

export async function fetchLatestCompletedQuickBooksOnOrderSnapshot(supabase: SupabaseClient) {
  const { data: completedRun, error: runError } = await supabase
    .from("source_sync_runs")
    .select("id,diagnostics")
    .eq("source_system", "quickbooks_desktop")
    .eq("worker_name", "quickbooks_web_connector")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle<CompletedQuickBooksRun>();
  if (runError) throw new Error(runError.message);
  if (!completedRun?.id) return null;

  const snapshots = await fetchAllExact<QuickBooksOnOrderSnapshotRow>("completed QuickBooks inventory snapshot", (from, to) => supabase
      .from("quickbooks_inventory_snapshots")
      .select("item_list_id,quantity_on_order", { count: "exact" })
      .eq("source_sync_run_id", completedRun.id)
      .order("item_list_id", { ascending: true })
      .range(from, to)
      .returns<QuickBooksOnOrderSnapshotRow[]>() as never,
    RECOMMENDATION_PAGE_SIZE
  );
  const expectedSnapshotRows = Number(completedRun.diagnostics?.resources?.["operational-items"]?.rows);
  assertCompletedQuickBooksSnapshotCount(
    Number.isFinite(expectedSnapshotRows) ? expectedSnapshotRows : null,
    snapshots.length
  );
  return snapshots;
}
