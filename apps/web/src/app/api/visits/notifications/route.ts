import { getVisitActor, visitDb, visitErrorResponse } from "@/lib/visits/access";
import { deliverVisitNotification } from "@/lib/visits/notifications";

export async function GET() {
  try {
    const actor = await getVisitActor();
    if (!actor.isAdmin) return Response.json({ error: "Administrator access required." }, { status: 403 });
    const { data, error } = await visitDb().from("visit_notification_outbox")
      .select("id,request_id,recipient_email,kind,status,attempts,last_error,created_at,sent_at")
      .neq("status", "sent").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return Response.json({ notifications: data || [], emailEnabled: process.env.VISIT_EMAIL_ENABLED === "true" },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return visitErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await getVisitActor();
    if (!actor.isAdmin) return Response.json({ error: "Administrator access required." }, { status: 403 });
    const body = await request.json();
    if (typeof body.id !== "string") return Response.json({ error: "Notification ID required." }, { status: 400 });
    return Response.json(await deliverVisitNotification(body.id));
  } catch (error) { return visitErrorResponse(error); }
}
