import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { ProductWorkspaceRow } from "@/lib/product-workspace-types";
import { readProductWorkspace } from "@/lib/product-workspace-reader";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product Workspace is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const startedAt = performance.now();
    const params = new URL(request.url).searchParams;
    if (params.get("mode") === "download") {
      if (!params.get("snapshot")) throw new Error("An immutable product snapshot is required for export.");
      params.set("mode", "counts");
      const counts = await readProductWorkspace(supabase, params);
      const rows: ProductWorkspaceRow[] = [];
      params.set("mode", "export");
      for (let offset = 0; offset < counts.data.visible; offset += 1000) {
        params.set("offset", String(offset));
        const page = await readProductWorkspace(supabase, params);
        rows.push(...page.data);
        if (page.data.length === 0) throw new Error("Product export was incomplete.");
      }
      if (rows.length !== counts.data.visible || new Set(rows.map((row) => row.id)).size !== rows.length) {
        throw new Error("Product export completeness check failed.");
      }
      const { buildProductWorkspaceWorkbook } = await import("@/lib/product-workspace-export");
      const workbook = buildProductWorkspaceWorkbook(rows, counts.generatedAt);
      const buffer = await workbook.xlsx.writeBuffer();
      return new Response(new Uint8Array(buffer), { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="stem-pricing-model.xlsx"',
        "Cache-Control": "private, no-store", "X-Export-Rows": String(rows.length)
      } });
    }
    const result = await readProductWorkspace(supabase, params);
    return NextResponse.json(result, { headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": `products;dur=${(performance.now() - startedAt).toFixed(1)}`
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Products unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
