import { canCoordinate, getVisitActor, visitDb, visitErrorResponse } from "@/lib/visits/access";
import { deliverPendingForRequest } from "@/lib/visits/notifications";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await getVisitActor();
    const { id } = await params;
    const body = await request.json();
    const db = visitDb();
    const { data: visit, error } = await db.from("visit_requests")
      .select("id,manager_user_id,lock_version").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!visit || !canCoordinate(actor, visit)) return Response.json({ error: "Not assigned to this request." }, { status: 403 });
    if (!Number.isSafeInteger(body.version) || body.version < 1) return Response.json({ error: "Version is required." }, { status: 400 });
    const status = String(body.status || "");
    const allowed = ["Needs Information", "In Progress", "Awaiting Winery", "Confirmed", "Declined", "Cancelled", "Completed"];
    if (!allowed.includes(status)) return Response.json({ error: "Invalid status." }, { status: 400 });
    const confirmation = body.confirmation && typeof body.confirmation === "object" ? body.confirmation : {};
    const { data, error: updateError } = await db.rpc("set_visit_request_status", {
      p_request_id: id, p_actor_id: actor.id, p_version: body.version,
      p_status: status, p_message: typeof body.message === "string" ? body.message.trim().slice(0, 2000) : null,
      p_confirmation: confirmation
    });
    if (updateError) throw updateError;
    await deliverPendingForRequest(id).catch(() => undefined);
    return Response.json({ visit: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return visitErrorResponse(error); }
}
