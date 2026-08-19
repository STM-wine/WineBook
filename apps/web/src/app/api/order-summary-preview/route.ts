import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchDatabaseOrderSummaryPreview } from "@/lib/database-order-summary-preview";

export const dynamic = "force-dynamic";

export async function GET() {
  const authSupabase = await createClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const data = await fetchDatabaseOrderSummaryPreview(createServiceRoleClient());
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load database order summary preview.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
