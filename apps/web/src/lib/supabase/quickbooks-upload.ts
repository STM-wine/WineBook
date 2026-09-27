import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchLastCompletedQuickBooksUpload(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db.from("source_sync_runs")
    .select("completed_at")
    .eq("source_system", "quickbooks_desktop")
    .eq("worker_name", "quickbooks_web_connector")
    .eq("status", "completed")
    .order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.completed_at || null;
}
