import { visitDb } from "./access";

type OutboxRow = {
  id: string; request_id: string; recipient_email: string; kind: string;
  payload: Record<string, unknown>; idempotency_key: string; status: string;
  attempts: number; created_at: string;
};

export async function deliverVisitNotification(id: string) {
  if (process.env.VISIT_EMAIL_ENABLED !== "true") return { status: "disabled" };
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VISIT_EMAIL_FROM;
  const origin = process.env.NEXT_PUBLIC_SITE_URL;
  if (!apiKey || !from || !origin) throw new Error("Visit email configuration is incomplete.");
  const db = visitDb();
  const { data: row, error } = await db.from("visit_notification_outbox")
    .select("*").eq("id", id).maybeSingle<OutboxRow>();
  if (error) throw error;
  if (!row || row.status === "sent") return { status: row?.status || "missing" };
  if (!["pending", "failed"].includes(row.status)) return { status: row.status };
  if (row.attempts > 0 && Date.now() - Date.parse(row.created_at) > 23 * 60 * 60 * 1000) {
    await db.from("visit_notification_outbox").update({
      status: "unknown", last_error: "Idempotent retry window expired; review delivery manually."
    }).eq("id", id);
    return { status: "unknown" };
  }
  const { data: claimed } = await db.from("visit_notification_outbox")
    .update({ status: "sending", attempts: row.attempts + 1, claimed_at: new Date().toISOString() })
    .eq("id", id).eq("status", row.status).select("id").maybeSingle();
  if (!claimed) return { status: "already_claimed" };
  const summary = row.payload;
  const title = row.kind === "submitted" ? "New winery visit request" :
    row.kind === "information_updated" ? "Winery visit information updated" : "Winery visit status updated";
  const lines = [
    `Request: ${summary.request_number || "Winery visit"}`,
    summary.requester ? `Requester: ${summary.requester}` : null,
    summary.producer ? `Producer: ${summary.producer}` : null,
    summary.requested_date ? `Proposed date: ${summary.requested_date}` : null,
    summary.party_size ? `Party size: ${summary.party_size}` : null,
    summary.status ? `Status: ${summary.status}` : null,
    summary.message ? `Update: ${summary.message}` : null,
    `Open the request: ${origin.replace(/\/$/, "")}/visits/${row.request_id}`,
    "This is an internal handoff, not a winery reservation."
  ].filter(Boolean).join("\n");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": row.idempotency_key
      },
      body: JSON.stringify({ from, to: [row.recipient_email], subject: `${title} · ${summary.request_number || "Stem"}`, text: lines }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok) {
      const nextStatus = response.status >= 500 || response.status === 409 ? "unknown" : "failed";
      await db.from("visit_notification_outbox").update({
        status: nextStatus, last_error: `Email provider ${response.status}: ${result.message || "delivery failed"}`
      }).eq("id", id);
      return { status: nextStatus };
    }
    await db.from("visit_notification_outbox").update({
      status: "sent", sent_at: new Date().toISOString(), provider_message_id: result.id || null, last_error: null
    }).eq("id", id);
    return { status: "sent" };
  } catch (error) {
    await db.from("visit_notification_outbox").update({
      status: "unknown", last_error: error instanceof Error ? error.message : "Network outcome unknown."
    }).eq("id", id);
    return { status: "unknown" };
  }
}

export async function deliverPendingForRequest(requestId: string) {
  const db = visitDb();
  const { data } = await db.from("visit_notification_outbox")
    .select("id").eq("request_id", requestId).eq("status", "pending").limit(5);
  for (const row of data || []) await deliverVisitNotification(row.id);
}
