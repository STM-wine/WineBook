import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { ORDERING_READ_FORMULA, orderingReadKey } from "@/lib/ordering-snapshot";
export const dynamic = "force-dynamic";
const isTemporaryFailure = (message: string) => /statement timeout|fetch failed|ECONNRESET|temporarily unavailable/i.test(message);
const retryStage = "Source verification is taking longer than usual. Retrying automatically.";
export async function GET(request: Request) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: profile, error: profileError } = await auth.from("app_profiles").select("id").eq("id", user.id).maybeSingle();
  if (profileError || !profile) return NextResponse.json({ error: "Account is not enabled." }, { status: 403 });
  const db = createServiceRoleClient();
  const params = new URL(request.url).searchParams;
  const headers = { "Cache-Control": "no-store" };
  try {
    // Only the current dependency generation is eligible. No stale ordering action inputs are served.
    const { data: requestedRows, error } = await db.rpc("request_read_model", { p_kind: "ordering", p_key: orderingReadKey(), p_formula: ORDERING_READ_FORMULA, p_request: {} });
    if (error) throw new Error(error.message);
    const requested = Array.isArray(requestedRows) ? requestedRows[0] : requestedRows;
    const { data: completed, error: completedError } = await db.from("read_model_jobs").select("id,result,completed_at")
      .eq("kind", "ordering").eq("status", "completed").eq("source_version", requested.source_version)
      .eq("business_date", requested.business_date).eq("formula_version", ORDERING_READ_FORMULA)
      .gte("completed_at", new Date(Date.now() - 600_000).toISOString()).order("completed_at", { ascending: false }).limit(1).maybeSingle();
    if (completedError) throw new Error(completedError.message);
    const job = completed ? { ...completed, status: "completed" } : requested;
    async function pending(stage: string) {
      // A previous overview is safe to display as explicitly read-only. Never
      // return old supplier action inputs, or relabel the old source version.
      let previousSummary;
      if (!params.has("supplier")) {
        const { data: previous } = await db.from("read_model_jobs").select("id,result,completed_at,source_version")
          .eq("kind", "ordering").eq("status", "completed")
          .eq("business_date", requested.business_date).eq("formula_version", ORDERING_READ_FORMULA)
          .gte("completed_at", new Date(Date.now() - 3_600_000).toISOString())
          .order("completed_at", { ascending: false }).limit(1).maybeSingle();
        if (previous) previousSummary = { ...previous.result, snapshotId: previous.id,
          sourceVersion: previous.source_version, generatedAt: previous.completed_at, isStale: true };
      }
      return NextResponse.json({ pending: true, stage, previousSummary }, { status: 202, headers });
    }
    // Failed jobs are automatically requeued after the worker's backoff. Keep
    // polling through transient database failures instead of stranding this tab.
    if (job.status === "failed" && isTemporaryFailure(job.error || "")) {
      return pending(retryStage);
    }
    if (job.status === "failed") throw new Error(job.error || "Ordering verification failed.");
    if (job.status !== "completed") return pending(job.status === "running" ? "Verifying ordering sources and calculating supplier totals" : "Waiting for ordering verification worker");
    if (params.has("supplier")) {
      const { data, error: supplierError } = await db.from("ordering_workspace_suppliers").select("data")
        .eq("snapshot_id", job.id).eq("supplier", params.get("supplier")).single();
      if (supplierError) throw new Error(supplierError.message);
      return NextResponse.json({ ...data.data, snapshotId: job.id, sourceVersion: requested.source_version, generatedAt: job.completed_at }, { headers });
    }
    return NextResponse.json({ ...job.result, snapshotId: job.id, sourceVersion: requested.source_version, generatedAt: job.completed_at }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ordering snapshot unavailable.";
    if (isTemporaryFailure(message)) return NextResponse.json({ pending: true, stage: retryStage }, { status: 202, headers });
    return NextResponse.json({ error: message }, { status: 503, headers });
  }
}
