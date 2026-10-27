"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Summary = {
  id: string; request_number: string | null; requester_name: string; producer_name: string | null;
  account_name: string | null; requested_start_date: string | null; requested_end_date: string | null;
  winery_timezone: string | null; party_size: number | null; manager_user_id: string | null;
  manager_name: string | null; status: string; updated_at: string; producer_needs_review: boolean;
  account_needs_review: boolean;
};
type Manager = { id: string; full_name: string | null; email: string };
type Notification = { id: string; request_id: string; recipient_email: string; status: string; last_error: string | null };

export function VisitHome({ actor }: { actor: { id: string; name: string; isAdmin: boolean } }) {
  const [rows, setRows] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [mine, setMine] = useState(false);
  const [review, setReview] = useState(false);
  const [producerName, setProducerName] = useState("");
  const [account, setAccount] = useState("");
  const [manager, setManager] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [mappingName, setMappingName] = useState("");
  const [mappingZone, setMappingZone] = useState("");
  const [mappingManager, setMappingManager] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (mine) params.set("mine", "true");
    if (review && actor.isAdmin) params.set("review", "true");
    if (producerName) params.set("producerName", producerName);
    if (account) params.set("account", account);
    if (manager) params.set("manager", manager);
    if (date) params.set("date", date);
    if (status) params.set("status", status);
    const response = await fetch(`/api/visits?${params}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) setMessage(result.error || "Could not load requests.");
    else { setRows(result.requests || []); setTotal(result.total || 0); }
    setLoading(false);
  }, [page, mine, review, producerName, account, manager, date, status, actor.isAdmin]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("mine") === "true") setMine(true);
    void fetch("/api/visits/reference?kind=managers").then((res) => res.json())
      .then((body) => setManagers(body.results || [])).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!actor.isAdmin) return;
    void fetch("/api/visits/notifications").then((res) => res.json())
      .then((body) => setNotifications(body.notifications || [])).catch(() => undefined);
  }, [actor.isAdmin]);

  async function saveMapping(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/visits/producers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: mappingName, timezone: mappingZone, managerId: mappingManager || null })
    });
    const body = await response.json();
    setMessage(response.ok ? `Saved producer routing for ${body.producer.display_name}.` : body.error || "Could not save mapping.");
    if (response.ok) { setMappingName(""); void load(); }
  }
  async function retryNotification(id: string) {
    const response = await fetch("/api/visits/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id })
    });
    const body = await response.json();
    setMessage(response.ok ? `Notification: ${body.status}.` : body.error || "Could not retry notification.");
    const refreshed = await fetch("/api/visits/notifications").then((res) => res.json());
    setNotifications(refreshed.notifications || []);
  }

  return <div className="visit-content">
    <section className="visit-hero">
      <p className="eyebrow">Winery visits</p>
      <h1>Request a Winery Visit</h1>
      <p>Give the brand manager the details needed to coordinate a visit. A request is not a confirmed reservation.</p>
      <div className="visit-actions"><Link className="button" href="/visits/new">Start a request</Link>
        <a href="#requests" className="button button-outline">My Requests</a></div>
    </section>

    <section id="requests" className="visit-panel">
      <div className="visit-section-head"><div><h2>All Visit Requests</h2><p>Everyone with visit access can see progress. Guest details stay with the requester, assigned manager and administrators.</p></div></div>
      <div className="visit-filters">
        <label><input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(0); }} /> My Requests</label>
        {actor.isAdmin ? <label><input type="checkbox" checked={review} onChange={(e) => { setReview(e.target.checked); setPage(0); }} /> Review queue</label> : null}
        <label>Producer<input value={producerName} onChange={(e) => { setProducerName(e.target.value); setPage(0); }} placeholder="Search producer" /></label>
        <label>Account or visitor<input value={account} onChange={(e) => { setAccount(e.target.value); setPage(0); }} placeholder="Search account" /></label>
        <label>Manager<select value={manager} onChange={(e) => { setManager(e.target.value); setPage(0); }}><option value="">All managers</option>{managers.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.email}</option>)}</select></label>
        <label>Date<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(0); }} /></label>
        <label>Status<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option>{["Draft", "Submitted", "Needs Information", "In Progress", "Awaiting Winery", "Confirmed", "Declined", "Cancelled", "Completed"].map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      {message ? <p className="form-message">{message}</p> : null}
      {loading ? <p>Loading requests…</p> : rows.length ? <div className="visit-table-wrap"><table className="visit-table"><thead><tr><th>Request</th><th>Requester</th><th>Producer</th><th>Account / visitor</th><th>Requested date</th><th>Party</th><th>Manager</th><th>Status</th><th>Updated</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
        <td><Link href={`/visits/${row.id}`}>{row.request_number || "Draft"}</Link></td><td>{row.requester_name}</td>
        <td>{row.producer_name || "—"}{row.producer_needs_review ? <small className="visit-warning">Review needed</small> : null}</td>
        <td>{row.account_name || "—"}{row.account_needs_review ? <small className="visit-warning">Review needed</small> : null}</td>
        <td>{row.requested_start_date || "—"}{row.requested_end_date ? ` to ${row.requested_end_date}` : ""}<small>{row.winery_timezone || "Timezone needed"}</small></td>
        <td>{row.party_size || "—"}</td><td>{row.manager_name || <span className="visit-warning">Admin review</span>}</td>
        <td><span className="visit-status">{row.status}</span></td><td>{new Date(row.updated_at).toLocaleDateString()}</td>
      </tr>)}</tbody></table></div> : <p>No matching requests.</p>}
      <div className="visit-pagination"><span>{total} requests</span><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button disabled={(page + 1) * 50 >= total} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>

    {actor.isAdmin ? <section className="visit-panel">
      <h2>Producer routing</h2><p>Set the winery timezone and responsible manager. A missing manager remains in the review queue.</p>
      <form className="visit-inline-form" onSubmit={saveMapping}>
        <label>Producer name<input required value={mappingName} onChange={(e) => setMappingName(e.target.value)} placeholder="As shown in the producer source" /></label>
        <label>Winery timezone<input required list="visit-timezones" value={mappingZone} onChange={(e) => setMappingZone(e.target.value)} placeholder="Europe/Rome" /><datalist id="visit-timezones">{Intl.supportedValuesOf("timeZone").map((zone) => <option key={zone} value={zone} />)}</datalist></label>
        <label>Brand manager<select value={mappingManager} onChange={(e) => setMappingManager(e.target.value)}><option value="">Unassigned</option>{managers.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.email}</option>)}</select></label>
        <button className="button" type="submit">Save routing</button>
      </form>
      <h3>Notification queue</h3>
      {notifications.length ? <ul className="visit-notifications">{notifications.map((item) => <li key={item.id}><Link href={`/visits/${item.request_id}`}>{item.recipient_email}</Link> · {item.status}{item.last_error ? ` · ${item.last_error}` : ""} {item.status === "pending" || item.status === "failed" ? <button type="button" onClick={() => void retryNotification(item.id)}>Retry</button> : null}</li>)}</ul> : <p>No pending or failed notifications.</p>}
    </section> : null}
  </div>;
}
