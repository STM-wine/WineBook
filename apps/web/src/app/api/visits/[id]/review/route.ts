import { getVisitActor, visitDb, visitErrorResponse } from "@/lib/visits/access";
import { deliverPendingForRequest } from "@/lib/visits/notifications";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await getVisitActor();
    if (!actor.isAdmin) return Response.json({ error: "Administrator access required." }, { status: 403 });
    const { id } = await params;
    const body = await request.json();
    const db = visitDb();
    const { data: visit, error } = await db.from("visit_requests")
      .select("id,lock_version,account_name,account_needs_review,manager_user_id,request_number,requester_id,requester_email,status")
      .eq("id", id).maybeSingle();
    if (error) throw error;
    if (!visit || !visit.account_needs_review) return Response.json({ error: "No account review is pending." }, { status: 409 });
    if (visit.lock_version !== body.version) return Response.json({ error: "Request changed. Reload it." }, { status: 409 });
    let accountId: string | null = null;
    let accountName = visit.account_name;
    if (typeof body.accountId === "string" && body.accountId) {
      const { data: account, error: lookupError } = await db.from("vinosmith_accounts")
        .select("account_id,name,code").eq("account_id", body.accountId).maybeSingle();
      if (lookupError || !account) return Response.json({ error: "VinoSmith account not found." }, { status: 400 });
      accountId = account.account_id;
      accountName = account.name || account.code || account.account_id;
    } else if (body.acceptTyped !== true || !accountName) {
      return Response.json({ error: "Select an account or explicitly accept the typed name." }, { status: 400 });
    }
    const { data: updated, error: updateError } = await db.from("visit_requests").update({
      account_id: accountId, account_name: accountName, account_needs_review: false,
      lock_version: body.version + 1, updated_at: new Date().toISOString()
    }).eq("id", id).eq("lock_version", body.version).select("id,lock_version").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return Response.json({ error: "Request changed. Reload it." }, { status: 409 });
    await db.from("visit_request_events").insert({ request_id: id, actor_id: actor.id,
      event_type: "account_reviewed", details: { account_name: accountName, linked_to_vinosmith: Boolean(accountId) } });
    if (visit.status !== "Draft") {
      const recipients = [{ id: visit.requester_id, email: visit.requester_email, kind: "status_updated" }];
      if (visit.manager_user_id) {
        const { data: manager } = await db.from("app_profiles").select("email")
          .eq("id", visit.manager_user_id).maybeSingle();
        if (manager?.email) recipients.push({ id: visit.manager_user_id, email: manager.email, kind: "information_updated" });
      }
      for (const recipient of recipients) await db.from("visit_notification_outbox").insert({
        request_id: id, recipient_user_id: recipient.id, recipient_email: recipient.email,
        kind: recipient.kind, idempotency_key: `visit-account-review-${id}-${updated.lock_version}-${recipient.id}`,
        payload: { request_number: visit.request_number, message: "Account review completed." }
      });
      await deliverPendingForRequest(id).catch(() => undefined);
    }
    return Response.json({ ok: true });
  } catch (error) { return visitErrorResponse(error); }
}
