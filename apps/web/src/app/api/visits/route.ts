import { randomUUID } from "node:crypto";
import { getVisitActor, visitDb, visitErrorResponse } from "@/lib/visits/access";
import { parseVisitDraft } from "@/lib/visits/validation";
import { detailColumns, resolveVisitReferences, summaryColumns } from "@/lib/visits/references";

export const dynamic = "force-dynamic";

const SUMMARY = "id,request_number,requester_id,requester_name,producer_id,producer_name,account_name,requested_start_date,requested_end_date,requested_start_time,requested_end_time,winery_timezone,party_size,manager_user_id,status,updated_at,created_at,submitted_at,producer_needs_review,account_needs_review";

export async function GET(request: Request) {
  try {
    const actor = await getVisitActor();
    const db = visitDb();
    const params = new URL(request.url).searchParams;
    const page = Math.min(1000, Math.max(0, Number.parseInt(params.get("page") || "0", 10) || 0));
    let query = db.from("visit_requests").select(SUMMARY, { count: "exact" })
      .order("updated_at", { ascending: false }).range(page * 50, page * 50 + 49);
    if (params.get("mine") === "true") query = query.eq("requester_id", actor.id);
    else if (!actor.isAdmin) query = query.or(`status.neq.Draft,requester_id.eq.${actor.id}`);
    if (params.get("review") === "true" && actor.isAdmin) {
      query = query.neq("status", "Draft")
        .or("producer_needs_review.eq.true,account_needs_review.eq.true,manager_user_id.is.null");
    }
    for (const [param, column] of [["producer", "producer_id"], ["manager", "manager_user_id"],
      ["status", "status"], ["date", "requested_start_date"]] as const) {
      const value = params.get(param);
      if (value) query = query.eq(column, value);
    }
    const account = params.get("account")?.trim().slice(0, 80);
    if (account) query = query.ilike("account_name", `%${account.replace(/[%_(),]/g, "")}%`);
    const producerName = params.get("producerName")?.trim().slice(0, 80);
    if (producerName) query = query.ilike("producer_name", `%${producerName.replace(/[%_(),]/g, "")}%`);
    const { data, error, count } = await query;
    if (error) throw error;
    const managerIds = [...new Set((data || []).map((row) => row.manager_user_id).filter(Boolean))];
    const { data: managers } = managerIds.length
      ? await db.from("app_profiles").select("id,full_name,email").in("id", managerIds)
      : { data: [] };
    const names = new Map((managers || []).map((row) => [row.id, row.full_name || row.email]));
    return json({ requests: (data || []).map((row) => ({ ...row,
      manager_name: row.manager_user_id ? names.get(row.manager_user_id) || null : null })), total: count || 0 });
  } catch (error) { return visitErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await getVisitActor();
    const body = await request.json();
    const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : randomUUID();
    const db = visitDb();
    const { data: existing } = await db.from("visit_requests")
      .select("id,requester_id,lock_version").eq("id", id).maybeSingle();
    if (existing) {
      if (existing.requester_id !== actor.id) return Response.json({ error: "Draft ID already exists." }, { status: 409 });
      return json({ id: existing.id, version: existing.lock_version });
    }
    const input = parseVisitDraft(body.input);
    const resolved = await resolveVisitReferences(db, input);
    const { data, error } = await db.from("visit_requests").insert({
      id, requester_id: actor.id, requester_name: actor.name, requester_email: actor.email,
      ...summaryColumns(input, resolved)
    }).select("id,lock_version").single();
    if (error) throw error;
    const { error: detailError } = await db.from("visit_request_details")
      .insert({ request_id: id, ...detailColumns(input) });
    if (detailError) {
      await db.from("visit_requests").delete().eq("id", id);
      throw detailError;
    }
    await db.from("visit_request_events").insert({ request_id: id, actor_id: actor.id, event_type: "draft_created" });
    return json({ id: data.id, version: data.lock_version });
  } catch (error) { return visitErrorResponse(error); }
}

function json(value: unknown) {
  return Response.json(value, { headers: { "Cache-Control": "private, no-store" } });
}
