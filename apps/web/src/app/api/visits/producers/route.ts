import { getVisitActor, visitDb, visitErrorResponse } from "@/lib/visits/access";
import { validTimezone } from "@/lib/visits/validation";
import { deliverPendingForRequest } from "@/lib/visits/notifications";

async function eligibleManager(db: ReturnType<typeof visitDb>, id: string | null) {
  if (!id) return true;
  const { data: profile } = await db.from("app_profiles").select("id,role")
    .eq("id", id).maybeSingle();
  if (!profile) return false;
  if (profile.role === "admin") return true;
  const { data } = await db.from("app_profile_permissions").select("permission")
    .eq("profile_id", id).eq("permission", "visit_manage_assigned").maybeSingle();
  return Boolean(data);
}

export async function POST(request: Request) {
  try {
    const actor = await getVisitActor();
    if (!actor.isAdmin) return Response.json({ error: "Administrator access required." }, { status: 403 });
    const body = await request.json();
    const name = String(body.name || "").trim().slice(0, 160);
    const timezone = String(body.timezone || "").trim();
    const managerId = typeof body.managerId === "string" && body.managerId ? body.managerId : null;
    if (!name || !validTimezone(timezone)) return Response.json({ error: "Producer and IANA timezone are required." }, { status: 400 });
    const db = visitDb();
    if (!await eligibleManager(db, managerId)) return Response.json({ error: "Manager must have coordination access." }, { status: 400 });
    const { data: producer, error } = await db.from("visit_producers").upsert({
      source_name: name, normalized_name: name.toLocaleLowerCase(), display_name: name,
      timezone, manager_user_id: managerId, updated_by: actor.id,
      updated_at: new Date().toISOString()
    }, { onConflict: "normalized_name" }).select("id,display_name,timezone,manager_user_id").single();
    if (error) throw error;
    const { data: pending } = await db.from("visit_requests")
      .select("id,producer_id,producer_name,status,request_number,requester_name,requested_start_date,party_size")
      .or(`producer_id.eq.${producer.id},producer_name.ilike.${name.replace(/[,()%]/g, "")}`)
      .is("manager_user_id", null).limit(100);
    for (const visit of pending || []) {
      const { data: changed } = await db.from("visit_requests").update({
        producer_id: producer.id, producer_name: producer.display_name,
        producer_needs_review: false, manager_user_id: managerId,
        winery_timezone: timezone, updated_at: new Date().toISOString()
      }).eq("id", visit.id).is("manager_user_id", null).select("id").maybeSingle();
      if (changed && managerId && visit.status !== "Draft") {
        const { data: manager } = await db.from("app_profiles").select("email").eq("id", managerId).maybeSingle();
        if (manager?.email) {
          await db.from("visit_notification_outbox").upsert({
            request_id: visit.id, recipient_user_id: managerId, recipient_email: manager.email,
            kind: "submitted", idempotency_key: `visit-assigned-${visit.id}-${managerId}`,
            payload: { request_number: visit.request_number, requester: visit.requester_name,
              producer: producer.display_name, requested_date: visit.requested_start_date,
              party_size: visit.party_size }
          }, { onConflict: "idempotency_key" });
          await deliverPendingForRequest(visit.id).catch(() => undefined);
        }
      }
    }
    return Response.json({ producer });
  } catch (error) { return visitErrorResponse(error); }
}
