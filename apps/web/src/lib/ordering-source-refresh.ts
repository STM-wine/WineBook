import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSourceBackedOrderingRun, fetchActiveOrderingRun } from "./source-backed-ordering-runs";

type CompletedSync = { id: string; completed_at: string | null };

export function orderingRunNeedsSourceRefresh(
  runCompletedAt: string | null | undefined,
  sourceCompletedAt: string | null | undefined
) {
  if (!sourceCompletedAt) return false;
  return !runCompletedAt || Date.parse(sourceCompletedAt) > Date.parse(runCompletedAt);
}

// The read-model worker calls this before publishing an ordering snapshot.
// A completed QBWC or Vinosmith mirror run therefore brings new SKUs into the
// source-backed ordering run without a separate manual workflow.
export async function refreshOrderingRunAfterSourceSync(
  db: SupabaseClient,
  attemptedSignature: string | null
) {
  const [qb, vinosmith, run] = await Promise.all([
    latestCompletedSync(db, "quickbooks_desktop", "quickbooks_web_connector"),
    latestCompletedSync(db, "vinosmith", "sync_vinosmith_rescue.py"),
    fetchActiveOrderingRun(db)
  ]);
  const signature = `${qb?.id || ""}:${vinosmith?.id || ""}`;
  if (signature === attemptedSignature || (!qb && !vinosmith)) {
    return { signature, refreshed: false, reason: "already_checked" };
  }
  const latestCompletedAt = [qb?.completed_at, vinosmith?.completed_at]
    .filter((value): value is string => Boolean(value))
    .sort().at(-1);
  if (!orderingRunNeedsSourceRefresh(run?.completed_at, latestCompletedAt)) {
    return { signature, refreshed: false, reason: "already_current" };
  }
  const result = await createSourceBackedOrderingRun(db, null);
  return {
    signature,
    refreshed: true,
    reason: result.reused ? "source_rows_checked" : "source_run_created",
    reportRunId: result.run.id,
    rowCount: result.rowCount
  };
}

async function latestCompletedSync(db: SupabaseClient, sourceSystem: string, workerName: string) {
  const { data, error } = await db.from("source_sync_runs")
    .select("id,completed_at")
    .eq("source_system", sourceSystem)
    .eq("worker_name", workerName)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle<CompletedSync>();
  if (error) throw new Error(error.message);
  return data;
}
