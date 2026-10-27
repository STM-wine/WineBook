"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { VisitEditor, visitInputFromRecord } from "./visit-editor";

type Payload = {
  visit: Record<string, unknown>;
  details?: Record<string, unknown> | null;
  events: Array<{ id: string; event_type: string; created_at: string; details?: Record<string, unknown> }>;
  privateAccess: boolean; attachmentUrl?: string | null;
};
const STATUSES = ["Needs Information", "In Progress", "Awaiting Winery", "Confirmed", "Declined", "Cancelled", "Completed"];

export function VisitDetail({ id, actor }: { id: string; actor: { id: string; isAdmin: boolean; canManageAssigned: boolean } }) {
  const [data, setData] = useState<Payload | null>(null);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("In Progress");
  const [statusMessage, setStatusMessage] = useState("");
  const [confirmation, setConfirmation] = useState({ date: "", start_time: "", end_time: "", location: "", winery_confirmation: "", fee_conditions: "" });
  const [accountQuery, setAccountQuery] = useState("");
  const [accountOptions, setAccountOptions] = useState<Array<{ account_id: string; name: string | null }>>([]);
  const [reviewAccountId, setReviewAccountId] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/visits/${id}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) setMessage(body.error || "Could not load request.");
    else { setData(body); setStatus(body.visit.status === "Draft" ? "In Progress" : body.visit.status); }
  }, [id]);
  useEffect(() => { void load(); setEditing(new URLSearchParams(window.location.search).get("edit") === "true"); }, [load]);
  useEffect(() => {
    if (accountQuery.length < 2) { setAccountOptions([]); return; }
    const timer = setTimeout(() => { void fetch(`/api/visits/reference?kind=accounts&q=${encodeURIComponent(accountQuery)}`)
      .then((res) => res.json()).then((body) => setAccountOptions(body.results || [])); }, 200);
    return () => clearTimeout(timer);
  }, [accountQuery]);

  if (!data) return <section className="visit-panel">{message || "Loading request…"}</section>;
  const v = data.visit; const d = data.details || {};
  const own = v.requester_id === actor.id;
  const canEdit = own && ["Draft", "Needs Information"].includes(String(v.status));
  const canCoordinate = actor.isAdmin || (actor.canManageAssigned && v.manager_user_id === actor.id);
  if (editing && canEdit) return <VisitEditor key={`${id}-${v.lock_version}`} id={id} version={Number(v.lock_version)}
    initial={visitInputFromRecord(v, d)} producerName={String(v.producer_name || "")}
    accountName={String(v.account_name || "")} />;

  async function submit() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/visits/${id}/submit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: v.lock_version })
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage((body.errors || [body.error || "Could not submit."]).join(" ")); return; }
    setMessage("Request submitted. This is not a confirmed reservation."); void load();
  }
  async function changeStatus() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/visits/${id}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: v.lock_version, status, message: statusMessage, confirmation })
    });
    const body = await response.json();
    setBusy(false);
    setMessage(response.ok ? "Status saved. Requester notification queued." : body.error || "Could not update status.");
    if (response.ok) void load();
  }
  async function resolveAccount(acceptTyped: boolean) {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/visits/${id}/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: v.lock_version, accountId: acceptTyped ? null : reviewAccountId, acceptTyped })
    });
    const body = await response.json();
    setBusy(false);
    setMessage(response.ok ? "Account review saved." : body.error || "Could not resolve account.");
    if (response.ok) void load();
  }

  return <>
    <section className="visit-panel"><p className="eyebrow">{String(v.request_number || "Draft")}</p><h1>{String(v.producer_name || "Winery visit request")}</h1>
      <p><span className="visit-status">{String(v.status)}</span> · Requested by {String(v.requester_name || "—")}</p>
      <p className="visit-warning">This request is not a confirmed reservation until a winery confirmation is recorded below.</p>
      {v.manager_user_id ? null : <p className="visit-warning">No brand manager assigned. This request is in the administrator review queue.</p>}
      {v.producer_needs_review || v.account_needs_review ? <p className="visit-warning">Producer or account details require administrator review.</p> : null}
      {message ? <p className="form-message">{message}</p> : null}
      <div className="visit-actions">{canEdit ? <button className="button button-outline" onClick={() => setEditing(true)}>Edit request</button> : null}
        {own && v.status === "Draft" ? <button className="button" disabled={busy} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit request"}</button> : null}
        <Link href="/visits">All Visit Requests</Link></div>
    </section>

    <div className="visit-two-column"><section className="visit-panel"><h2>Requested visit</h2><dl className="visit-dl">
      <dt>Producer</dt><dd>{String(v.producer_name || "—")}</dd>
      <dt>Account / visitor</dt><dd>{String(v.account_name || "Consumer")}</dd>
      <dt>Date</dt><dd>{dateLabel(v.requested_start_date)}{v.requested_end_date ? ` to ${dateLabel(v.requested_end_date)}` : ""}{v.date_flexible === true ? " · flexible" : ""}</dd>
      <dt>Preferred time</dt><dd>{String(v.requested_start_time || "—").slice(0, 5)}{v.requested_end_time ? `–${String(v.requested_end_time).slice(0, 5)}` : ""}{v.time_flexible === true ? " · flexible" : ""}</dd>
      <dt>Winery timezone</dt><dd>{String(v.winery_timezone || "Needs review")}</dd>
      <dt>Alternate dates</dt><dd>{String(v.alternate_dates || "—")}</dd>
      <dt>Experience</dt><dd>{String(v.experience || "—").replaceAll("_", " ")}{d.experience_other ? ` · ${d.experience_other}` : ""}</dd>
      <dt>Simpler alternative</dt><dd>{v.simpler_alternative_ok === true ? "Yes" : v.simpler_alternative_ok === false ? "No" : "—"}</dd>
      <dt>Party size</dt><dd>{String(v.party_size || "—")}</dd>
    </dl></section>
    <section className="visit-panel"><h2>Confirmed visit</h2>{v.confirmed_date ? <dl className="visit-dl">
      <dt>Local date</dt><dd>{dateLabel(v.confirmed_date)}</dd><dt>Local time</dt><dd>{String(v.confirmed_start_time || "").slice(0, 5)}{v.confirmed_end_time ? `–${String(v.confirmed_end_time).slice(0, 5)}` : ""}</dd>
      <dt>Location</dt><dd>{String(v.confirmed_location || "—")}</dd><dt>Fees / conditions</dt><dd>{String(v.confirmed_fee_conditions || "—")}</dd>
      <dt>Confirmed at</dt><dd>{v.confirmed_at ? new Date(String(v.confirmed_at)).toLocaleString() : "—"}</dd>
    </dl> : <p>No winery confirmation recorded.</p>}</section></div>

    {data.privateAccess ? <section className="visit-panel"><h2>Visitor and coordination details</h2><dl className="visit-dl">
      <dt>Primary contact</dt><dd>{String(d.primary_contact_name || "—")} · {String(d.primary_contact_email || "—")} · {String(d.primary_contact_phone || "—")}</dd>
      <dt>Role / relationship</dt><dd>{String(d.contact_role || "—")}{d.visitor_relationship ? ` · ${d.visitor_relationship}` : ""}</dd>
      <dt>Current support</dt><dd>{String(d.support_status || "—")}{d.support_details ? ` · ${d.support_details}` : ""}</dd>
      <dt>Purpose</dt><dd>{String(d.purpose || "—")}</dd>
      <dt>Adults / children</dt><dd>{String(d.adult_count || "—")} / {String(d.child_count ?? "—")}</dd>
      <dt>Additional adults</dt><dd>{Array.isArray(d.adult_guests) ? (d.adult_guests as Array<{ name: string }>).map((g) => g.name).join(", ") || "None" : "None"}</dd>
      <dt>Dietary / allergies</dt><dd>{String(d.dietary_status || "—")}{d.dietary_details ? ` · ${d.dietary_details}` : ""}</dd>
      <dt>Accessibility</dt><dd>{String(d.accessibility_needs || "—")}</dd>
      <dt>Transportation / lodging</dt><dd>{d.transportation_help ? "Assistance requested" : "No assistance requested"}{d.lodging ? ` · ${d.lodging}` : ""}</dd>
      <dt>Fee expectations / payer</dt><dd>{String(d.fee_expectations || "—")} · {String(d.expected_payer || "—")}</dd>
      <dt>Language / constraints</dt><dd>{String(d.language_requirements || "—")} · {String(d.travel_constraints || "—")}</dd>
      <dt>Winery suitable notes</dt><dd>{String(d.winery_notes || "—")}</dd>
      <dt>Internal business context</dt><dd>{String(d.internal_context || "—")}</dd>
      {data.attachmentUrl ? <><dt>Itinerary</dt><dd><a href={data.attachmentUrl} target="_blank" rel="noopener noreferrer">Open attachment</a></dd></> : null}
    </dl></section> : <section className="visit-panel"><p>Guest contacts and hospitality details are restricted to the requester, assigned manager and administrators.</p></section>}

    {actor.isAdmin && v.account_needs_review ? <section className="visit-panel"><h2>Review unlisted account</h2>
      <p>Typed name: {String(v.account_name || "—")}. Link to a VinoSmith account or explicitly accept this name without changing VinoSmith.</p>
      <div className="visit-form-grid"><label>Search VinoSmith accounts<input value={accountQuery} onChange={(e) => { setAccountQuery(e.target.value); setReviewAccountId(""); }} /></label>
        <label>Match<select value={reviewAccountId} onChange={(e) => setReviewAccountId(e.target.value)}><option value="">Select a match</option>{accountOptions.map((item) => <option key={item.account_id} value={item.account_id}>{item.name || item.account_id}</option>)}</select></label></div>
      <div className="visit-actions"><button className="button" disabled={busy || !reviewAccountId} onClick={() => void resolveAccount(false)}>Link selected account</button>
        <button className="button button-outline" disabled={busy} onClick={() => void resolveAccount(true)}>Accept typed name</button></div>
    </section> : null}

    {canCoordinate && v.status !== "Draft" ? <section className="visit-panel"><h2>Coordinate request</h2><div className="visit-form-grid">
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="visit-wide">Update for requester<textarea value={statusMessage} onChange={(e) => setStatusMessage(e.target.value)} placeholder="Required when asking for information" /></label>
      {status === "Confirmed" ? <>
        <p className="visit-wide">Record the winery’s explicit confirmation. Use local date and time in {String(v.winery_timezone || "the winery timezone")}.</p>
        <label>Confirmed local date<input type="date" value={confirmation.date} onChange={(e) => setConfirmation({ ...confirmation, date: e.target.value })} /></label>
        <label>Confirmed local start<input type="time" value={confirmation.start_time} onChange={(e) => setConfirmation({ ...confirmation, start_time: e.target.value })} /></label>
        <label>Confirmed local end, optional<input type="time" value={confirmation.end_time} onChange={(e) => setConfirmation({ ...confirmation, end_time: e.target.value })} /></label>
        <label>Location<input value={confirmation.location} onChange={(e) => setConfirmation({ ...confirmation, location: e.target.value })} /></label>
        <label className="visit-wide">Winery confirmation reference<textarea value={confirmation.winery_confirmation} onChange={(e) => setConfirmation({ ...confirmation, winery_confirmation: e.target.value })} placeholder="Who at the winery confirmed and how" /></label>
        <label className="visit-wide">Fees or conditions<textarea value={confirmation.fee_conditions} onChange={(e) => setConfirmation({ ...confirmation, fee_conditions: e.target.value })} placeholder="State none if the winery explicitly confirmed none" /></label>
      </> : null}
    </div><button className="button" disabled={busy} onClick={() => void changeStatus()}>Save status</button></section> : null}

    <section className="visit-panel"><h2>History</h2><ul className="visit-history">{data.events.map((event) => <li key={event.id}>{new Date(event.created_at).toLocaleString()} · {event.event_type.replaceAll("_", " ")}{event.details?.status ? ` · ${event.details.status}` : ""}</li>)}</ul></section>
  </>;
}

function dateLabel(value: unknown) {
  if (typeof value !== "string") return "—";
  const weekday = new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${weekday}, ${value}`;
}
