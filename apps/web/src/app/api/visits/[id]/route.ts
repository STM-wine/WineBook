import { getVisitActor, canReadPrivate, visitDb, visitErrorResponse } from "@/lib/visits/access";
import { parseVisitDraft } from "@/lib/visits/validation";
import { detailColumns, resolveVisitReferences, summaryColumns } from "@/lib/visits/references";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const actor = await getVisitActor();
    const { id } = await params;
    const db = visitDb();
    const { data: visit, error } = await db.from("visit_requests").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!visit || (visit.status === "Draft" && visit.requester_id !== actor.id && !actor.isAdmin)) {
      return Response.json({ error: "Request not found." }, { status: 404 });
    }
    const privateAccess = canReadPrivate(actor, visit);
    const { data: events } = await db.from("visit_request_events")
      .select(privateAccess ? "id,actor_id,event_type,details,created_at" : "id,event_type,created_at")
      .eq("request_id", id).order("created_at");
    if (!privateAccess) return json({ visit: publicVisit(visit), events: events || [], privateAccess: false });
    const { data: details, error: detailError } = await db.from("visit_request_details")
      .select("*").eq("request_id", id).maybeSingle();
    if (detailError) throw detailError;
    let attachmentUrl: string | null = null;
    if (details?.itinerary_path) {
      const { data } = await db.storage.from("visit-itineraries")
        .createSignedUrl(details.itinerary_path, 300);
      attachmentUrl = data?.signedUrl || null;
    }
    return json({ visit, details, events: events || [], privateAccess: true, attachmentUrl });
  } catch (error) { return visitErrorResponse(error); }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await getVisitActor();
    const { id } = await params;
    const body = await request.json();
    const version = Number(body.version);
    if (!Number.isSafeInteger(version) || version < 1) return Response.json({ error: "Draft version is required." }, { status: 400 });
    const db = visitDb();
    const { data: old, error: readError } = await db.from("visit_requests")
      .select("id,requester_id,status,manager_user_id,request_number,lock_version,producer_id,producer_name,account_id,account_name,winery_timezone")
      .eq("id", id).maybeSingle();
    if (readError) throw readError;
    if (!old || old.requester_id !== actor.id || !["Draft", "Needs Information"].includes(old.status)) {
      return Response.json({ error: "This request cannot be edited by you." }, { status: 403 });
    }
    const input = parseVisitDraft(body.input);
    const resolved = await resolveVisitReferences(db, input);
    if (old.status === "Needs Information" && (
      old.producer_id !== resolved.producerId || old.producer_name !== resolved.producerName ||
      old.account_id !== resolved.accountId || old.account_name !== resolved.accountName ||
      old.winery_timezone !== resolved.timezone
    )) return Response.json({ error: "Ask an administrator to change producer, account or winery timezone after submission." }, { status: 409 });
    const { data: updated, error } = await db.from("visit_requests")
      .update({ ...summaryColumns(input, resolved), updated_at: new Date().toISOString(), lock_version: version + 1 })
      .eq("id", id).eq("requester_id", actor.id).eq("status", old.status)
      .eq("lock_version", version).select("id,lock_version").maybeSingle();
    if (error) throw error;
    if (!updated) return Response.json({ error: "Request changed. Reload and try again." }, { status: 409 });
    const { error: detailError } = await db.from("visit_request_details")
      .upsert({ request_id: id, ...detailColumns(input) });
    if (detailError) throw detailError;
    await db.from("visit_request_events").insert({
      request_id: id, actor_id: actor.id,
      event_type: old.status === "Draft" ? "draft_saved" : "information_updated"
    });
    if (old.status === "Needs Information" && old.manager_user_id) {
      const { data: manager } = await db.from("app_profiles").select("email")
        .eq("id", old.manager_user_id).maybeSingle();
      if (manager?.email) await db.from("visit_notification_outbox").insert({
        request_id: id, recipient_user_id: old.manager_user_id, recipient_email: manager.email,
        kind: "information_updated", idempotency_key: `visit-information-${id}-${updated.lock_version}`,
        payload: { request_number: old.request_number, requester: actor.name }
      });
    }
    return json({ id, version: updated.lock_version });
  } catch (error) { return visitErrorResponse(error); }
}

function publicVisit(visit: Record<string, unknown>) {
  const allowed = ["id", "request_number", "requester_name", "producer_name", "account_name",
    "requested_start_date", "requested_end_date", "requested_start_time", "requested_end_time",
    "winery_timezone", "party_size", "manager_user_id", "status", "updated_at", "submitted_at",
    "confirmed_date", "confirmed_start_time", "confirmed_end_time", "confirmed_location",
    "confirmed_fee_conditions"];
  return Object.fromEntries(allowed.map((key) => [key, visit[key]]));
}
function json(value: unknown) { return Response.json(value, { headers: { "Cache-Control": "private, no-store" } }); }
