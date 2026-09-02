import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

type AssignRepRequestBody = {
  leadId?: unknown;
  repId?: unknown;
};

export async function POST(request: Request) {
  const authSupabase = await createClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await authSupabase
    .from("app_profiles")
    .select("id,role")
    .eq("id", user.id)
    .maybeSingle<{ id: string; role: string }>();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "Account is not enabled." }, { status: 403 });
  }
  if (profile.role !== "admin" && profile.role !== "buyer") {
    return NextResponse.json({ error: "Buyer or admin access required." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as AssignRepRequestBody | null;
  const leadId = stringOrNull(body?.leadId);
  const repId = stringOrNull(body?.repId);

  if (!leadId) {
    return NextResponse.json({ error: "Lead id is required." }, { status: 400 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lead Intelligence is not configured." }, { status: 500 });
  }

  if (repId) {
    const { data: rep, error: repError } = await supabase
      .from("quickbooks_sales_reps")
      .select("list_id")
      .eq("list_id", repId)
      .maybeSingle<{ list_id: string }>();

    if (repError) {
      return NextResponse.json({ error: repError.message }, { status: 500 });
    }
    if (!rep) {
      return NextResponse.json({ error: "Rep was not found." }, { status: 404 });
    }
  }

  const payload = repId
    ? {
        assigned_rep_list_id: repId,
        assigned_by: user.id,
        assigned_at: new Date().toISOString(),
        opening_status: "assigned"
      }
    : {
        assigned_rep_list_id: null,
        assigned_by: null,
        assigned_at: null,
        opening_status: "qualified"
      };

  const { data: lead, error: updateError } = await supabase
    .from("account_opening_leads")
    .update(payload)
    .eq("id", leadId)
    .select("id,assigned_rep_list_id,assigned_at,opening_status")
    .maybeSingle<{ id: string; assigned_rep_list_id: string | null; assigned_at: string | null; opening_status: string }>();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ error: "Lead was not found." }, { status: 404 });
  }

  return NextResponse.json({
    leadId: lead.id,
    assignedRepId: lead.assigned_rep_list_id,
    assignedAt: lead.assigned_at,
    status: lead.opening_status
  });
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
