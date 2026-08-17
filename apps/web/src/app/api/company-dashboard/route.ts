import { NextRequest, NextResponse } from "next/server";
import { fetchCompanyDashboardData, parseCompanyDashboardPeriod } from "@/lib/company-dashboard-data";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "Account is not enabled." }, { status: 403 });
  }

  try {
    const params = request.nextUrl.searchParams;
    const dateFrom = validDate(params.get("from")) || undefined;
    const dateTo = validDate(params.get("to")) || undefined;
    const period = dateFrom && dateTo ? "custom" : parseCompanyDashboardPeriod(params.get("period"));
    const data = await fetchCompanyDashboardData(createServiceRoleClient(), period, {
      dateFrom,
      dateTo,
      rep: cleanParam(params.get("rep")),
      businessLine: cleanParam(params.get("businessLine")),
      includeGrossProfit: params.get("includeProfit") !== "false"
    });
    return noStoreJson(data);
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : "Could not load company dashboard." },
      { status: 500 }
    );
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function cleanParam(value: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
