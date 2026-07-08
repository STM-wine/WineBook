import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchProductIdentitySearchCandidates } from "@/lib/product-identity-search-sources";
import { searchProductIdentityCandidates } from "@/lib/product-identity-search";


export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const supplierId = url.searchParams.get("supplierId") || null;
  const supplierName = url.searchParams.get("supplierName") || null;
  const producer = url.searchParams.get("producer") || null;
  const vintage = url.searchParams.get("vintage") || null;
  const packSize = Number(url.searchParams.get("packSize") || 0) || null;
  const bottleSize = url.searchParams.get("bottleSize") || null;

  if (query.length < 3) {
    return NextResponse.json({ matches: [] });
  }

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

  let searchSupabase: ReturnType<typeof createServiceRoleClient>;
  try {
    searchSupabase = createServiceRoleClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product match search is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let candidates;
  try {
    candidates = await fetchProductIdentitySearchCandidates(searchSupabase);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load product match sources.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const matches = searchProductIdentityCandidates(
    {
      query,
      producer,
      vintage,
      packSize,
      bottleSize,
      supplierId,
      supplierName,
      limit: 8
    },
    candidates
  );

  return NextResponse.json({ matches });
}
