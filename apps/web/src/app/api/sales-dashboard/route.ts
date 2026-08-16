import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchQuickBooksSalesDashboardData } from "@/lib/supabase/quickbooks-sales-dashboard";
import type { QuickBooksSalesDashboardFilters } from "@/lib/quickbooks-sales-types";

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
    const filters: QuickBooksSalesDashboardFilters = {
      dateFrom: cleanParam(params.get("from")),
      dateTo: cleanParam(params.get("to")),
      rep: cleanParam(params.get("rep")),
      documentType: documentTypeParam(params.get("type")),
      account: cleanParam(params.get("account")),
      item: cleanParam(params.get("item")),
      document: cleanParam(params.get("document")),
      includeItems: params.get("includeItems") === "true",
      includeTransactions: params.get("includeTransactions") === "true"
    };

    const data = await fetchQuickBooksSalesDashboardData(createServiceRoleClient(), filters);
    return noStoreJson(data);
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : "Could not load sales dashboard." },
      { status: 500 }
    );
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function cleanParam(value: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function documentTypeParam(value: string | null): QuickBooksSalesDashboardFilters["documentType"] {
  return value === "invoice" || value === "credit_memo" ? value : "all";
}
