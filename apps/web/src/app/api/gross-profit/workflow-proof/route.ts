import { NextRequest, NextResponse } from "next/server";
import { buildGrossProfitWorkflowProof } from "@/lib/supabase/gross-profit-center";
import type { GrossProfitClient } from "@/lib/supabase/gross-profit-center";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
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

  const { data: permissionRows, error: permissionError } = await authSupabase
    .from("app_profile_permissions")
    .select("permission")
    .eq("profile_id", user.id)
    .returns<Array<{ permission: string }>>();

  if (permissionError) {
    return NextResponse.json({ error: permissionError.message }, { status: 500 });
  }
  if (!canViewSettings(profile.role, permissionRows || [])) {
    return NextResponse.json({ error: "Settings access required." }, { status: 403 });
  }

  let supabase: GrossProfitClient;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gross profit workflow proof is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = validDate(request.nextUrl.searchParams.get("from")) || "2025-01-01";
  const dateTo = validDate(request.nextUrl.searchParams.get("to")) || today;
  const includeLines = request.nextUrl.searchParams.get("includeLines") === "true";
  const lineLimit = positiveInteger(request.nextUrl.searchParams.get("lineLimit")) || 250;

  try {
    return NextResponse.json(await buildGrossProfitWorkflowProof(supabase, dateFrom, dateTo, { includeLines, lineLimit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build gross profit workflow proof.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function canViewSettings(role: string, permissionRows: Array<{ permission: string }>) {
  if (role === "admin" || role === "buyer") return true;
  return permissionRows.some((row) => row.permission === "view_settings");
}

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function positiveInteger(value: string | null) {
  if (!value) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
