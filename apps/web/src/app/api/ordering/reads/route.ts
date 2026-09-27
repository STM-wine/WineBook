import { fetchSupplierHubData } from "@/lib/supplier-hub-reads";
import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchDraftDetail, fetchDraftSummaries } from "@/lib/ordering-draft-reads";
import { fetchAllExact } from "@/lib/supabase/fetch-all-exact";
import type { ApprovalCommitment, ApprovalEvent, AppProfile } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: profile, error: authError } = await auth.from("app_profiles").select("id").eq("id", user.id).maybeSingle();
  if (authError || !profile) return NextResponse.json({ error: "Account is not enabled." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const run = params.get("run");
  if (!run) return NextResponse.json({ error: "Report run required." }, { status: 400 });
  const db = createServiceRoleClient();
  try {
    if (params.get("scope") === "hub") {
      const [suppliers, hub] = await Promise.all([
        fetchAllExact("supplier logistics", (from, to) => db.from("suppliers").select("*", { count: "exact" }).order("id").range(from, to) as never),
        fetchSupplierHubData(db)
      ]);
      return NextResponse.json({ suppliers, ...hub }, { headers: { "Cache-Control": "no-store" } });
    }
    if (params.get("scope") === "policies") {
      const markers = await fetchAllExact("ordering policies", (from, to) => db.from("ordering_item_markers").select("*", { count: "exact" }).order("item_code").range(from, to) as never);
      return NextResponse.json({ markers }, { headers: { "Cache-Control": "no-store" } });
    }
    if (params.get("draft")) {
      return NextResponse.json(await fetchDraftDetail(db, run, params.get("draft")!), { headers: { "Cache-Control": "no-store" } });
    }
    const [drafts, events, commitments, profiles] = await Promise.all([
      fetchDraftSummaries(db, run),
      Promise.resolve([] as ApprovalEvent[]),
      fetchAllExact<ApprovalCommitment>("approval commitments", (from, to) => db.from("approval_commitments").select("*", { count: "exact" })
        .eq("report_run_id", run).order("id").range(from, to) as never),
      fetchAllExact<AppProfile>("actor names", (from, to) => db.from("app_profiles").select("id,email,full_name", { count: "exact" })
        .order("id").range(from, to) as never)
    ]);
    return NextResponse.json({ drafts, events, commitments, actorNames: Object.fromEntries(profiles.map((p) => [p.id, p.full_name?.trim() || p.email])) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ordering data unavailable." }, { status: 503 });
  }
}
