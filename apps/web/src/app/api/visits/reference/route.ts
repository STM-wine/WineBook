import { getVisitActor, visitDb, visitErrorResponse } from "@/lib/visits/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await getVisitActor();
    const db = visitDb();
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") || "producers";
    const q = (params.get("q") || "").trim().replace(/[%_(),]/g, "").slice(0, 80);
    if (kind === "producers") {
      let query = db.from("visit_producers")
        .select("id,display_name,timezone,manager_user_id")
        .eq("active", true).order("display_name").limit(30);
      if (q) query = query.ilike("display_name", `%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      const managerIds = [...new Set((data || []).map((row) => row.manager_user_id).filter(Boolean))];
      const { data: managers } = managerIds.length
        ? await db.from("app_profiles").select("id,full_name,email").in("id", managerIds)
        : { data: [] };
      const names = new Map((managers || []).map((row) => [row.id, row.full_name || row.email]));
      return json({ results: (data || []).map((row) => ({ ...row, manager_name: row.manager_user_id ? names.get(row.manager_user_id) || null : null })) });
    }
    if (kind === "accounts") {
      if (q.length < 2) return json({ results: [] });
      const { data, error } = await db.from("vinosmith_accounts")
        .select("account_id,name,code,last_seen_at")
        .ilike("name", `%${q}%`).order("name").limit(25);
      if (error) return json({ results: [], unavailable: true });
      return json({ results: data || [] });
    }
    if (kind === "managers") {
      const { data: grants, error: grantError } = await db.from("app_profile_permissions")
        .select("profile_id").eq("permission", "visit_manage_assigned");
      if (grantError) throw grantError;
      const ids = (grants || []).map((row) => row.profile_id);
      const { data, error } = await db.from("app_profiles")
        .select("id,full_name,email,role").order("full_name");
      if (error) throw error;
      return json({ results: (data || []).filter((row) => row.role === "admin" || ids.includes(row.id)) });
    }
    return Response.json({ error: "Unsupported lookup." }, { status: 400 });
  } catch (error) { return visitErrorResponse(error); }
}

function json(value: unknown) {
  return Response.json(value, { headers: { "Cache-Control": "private, no-store" } });
}
