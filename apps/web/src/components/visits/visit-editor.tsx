"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type VisitDraftInput, validateForSubmission } from "@/lib/visits/validation";

type Producer = { id: string; display_name: string; timezone: string | null; manager_name: string | null };
type Account = { account_id: string; name: string | null; code: string | null };

const EMPTY: VisitDraftInput = {
  producerId: null, producerOther: null, timezone: null, accountId: null, accountOther: null,
  visitorType: null, requestedStartDate: null, requestedEndDate: null, dateFlexible: null,
  alternateDates: null, requestedStartTime: null, requestedEndTime: null, timeFlexible: null,
  experience: null, simplerAlternativeOk: null, tripReference: null,
  primaryContactName: null, primaryContactEmail: null, primaryContactPhone: null,
  contactRole: null, visitorRelationship: null, experienceOther: null,
  supportStatus: null, supportDetails: null, purpose: null, adultCount: 1, childCount: 0,
  adultGuests: [], dietaryStatus: null, dietaryDetails: null, accessibilityNeeds: null,
  transportationHelp: null, lodging: null, feeExpectations: null, expectedPayer: null,
  languageRequirements: null, travelConstraints: null, wineryNotes: null, internalContext: null
};

export function visitInputFromRecord(visit: Record<string, unknown>, details: Record<string, unknown>): VisitDraftInput {
  return {
    ...EMPTY,
    producerId: visit.producer_id as string | null,
    producerOther: visit.producer_id ? null : visit.producer_name as string | null,
    timezone: visit.winery_timezone as string | null,
    accountId: visit.account_id as string | null,
    accountOther: visit.account_id ? null : visit.account_name as string | null,
    visitorType: visit.visitor_type as VisitDraftInput["visitorType"],
    requestedStartDate: visit.requested_start_date as string | null,
    requestedEndDate: visit.requested_end_date as string | null,
    dateFlexible: visit.date_flexible as boolean | null,
    alternateDates: visit.alternate_dates as string | null,
    requestedStartTime: typeof visit.requested_start_time === "string" ? visit.requested_start_time.slice(0, 5) : null,
    requestedEndTime: typeof visit.requested_end_time === "string" ? visit.requested_end_time.slice(0, 5) : null,
    timeFlexible: visit.time_flexible as boolean | null,
    experience: visit.experience as VisitDraftInput["experience"],
    simplerAlternativeOk: visit.simpler_alternative_ok as boolean | null,
    tripReference: visit.trip_reference as string | null,
    primaryContactName: details.primary_contact_name as string | null,
    primaryContactEmail: details.primary_contact_email as string | null,
    primaryContactPhone: details.primary_contact_phone as string | null,
    contactRole: details.contact_role as string | null,
    visitorRelationship: details.visitor_relationship as string | null,
    experienceOther: details.experience_other as string | null,
    supportStatus: details.support_status as VisitDraftInput["supportStatus"],
    supportDetails: details.support_details as string | null,
    purpose: details.purpose as string | null,
    adultCount: details.adult_count as number | null,
    childCount: details.child_count as number | null,
    adultGuests: Array.isArray(details.adult_guests) ? details.adult_guests as VisitDraftInput["adultGuests"] : [],
    dietaryStatus: details.dietary_status as VisitDraftInput["dietaryStatus"],
    dietaryDetails: details.dietary_details as string | null,
    accessibilityNeeds: details.accessibility_needs as string | null,
    transportationHelp: details.transportation_help as boolean | null,
    lodging: details.lodging as string | null,
    feeExpectations: details.fee_expectations as string | null,
    expectedPayer: details.expected_payer as string | null,
    languageRequirements: details.language_requirements as string | null,
    travelConstraints: details.travel_constraints as string | null,
    wineryNotes: details.winery_notes as string | null,
    internalContext: details.internal_context as string | null
  };
}

export function VisitEditor({ id, version, initial, producerName, accountName }: {
  id?: string; version?: number; initial?: VisitDraftInput; producerName?: string | null; accountName?: string | null;
}) {
  const router = useRouter();
  const [input, setInput] = useState<VisitDraftInput>(initial || EMPTY);
  const [draftId, setDraftId] = useState(id || "");
  const [draftVersion, setDraftVersion] = useState(version || 0);
  const [producerLabel, setProducerLabel] = useState(producerName || "");
  const [accountLabel, setAccountLabel] = useState(accountName || "");
  const [managerName, setManagerName] = useState("");
  const [producerResults, setProducerResults] = useState<Producer[]>([]);
  const [accountResults, setAccountResults] = useState<Account[]>([]);
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [producerOtherMode, setProducerOtherMode] = useState(Boolean(initial?.producerOther));
  const [accountOtherMode, setAccountOtherMode] = useState(Boolean(initial?.accountOther));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  function update<K extends keyof VisitDraftInput>(key: K, value: VisitDraftInput[K]) {
    setInput((previous) => ({ ...previous, [key]: value }));
  }
  useEffect(() => {
    if (producerOtherMode || producerLabel.length < 2 || input.producerId) return;
    const timer = setTimeout(() => {
      void fetch(`/api/visits/reference?kind=producers&q=${encodeURIComponent(producerLabel)}`)
        .then((res) => res.json()).then((body) => setProducerResults(body.results || []));
    }, 200);
    return () => clearTimeout(timer);
  }, [producerLabel, input.producerId, producerOtherMode]);
  useEffect(() => {
    if (accountOtherMode || accountLabel.length < 2 || input.accountId) return;
    const timer = setTimeout(() => {
      void fetch(`/api/visits/reference?kind=accounts&q=${encodeURIComponent(accountLabel)}`)
        .then((res) => res.json()).then((body) => { setAccountResults(body.results || []); setAccountUnavailable(Boolean(body.unavailable)); });
    }, 200);
    return () => clearTimeout(timer);
  }, [accountLabel, input.accountId, accountOtherMode]);

  async function save(review: boolean) {
    setMessage(""); setErrors([]);
    if (review) {
      const issues = validateForSubmission(input, {
        producerName: input.producerId ? producerLabel : input.producerOther,
        accountName: input.accountId ? accountLabel : input.accountOther,
        timezone: input.timezone
      });
      if (issues.length) { setErrors(issues); return; }
    }
    setBusy(true);
    try {
      const nextId = draftId || crypto.randomUUID();
      const response = await fetch(draftId ? `/api/visits/${draftId}` : "/api/visits", {
        method: draftId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftId ? { version: draftVersion, input } : { id: nextId, input })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save draft.");
      setDraftId(body.id); setDraftVersion(body.version);
      if (file) {
        const data = new FormData(); data.set("file", file);
        const uploaded = await fetch(`/api/visits/${body.id}/attachment`, { method: "POST", body: data });
        if (!uploaded.ok) {
          const failure = await uploaded.json();
          throw new Error(`Draft saved, but itinerary upload failed: ${failure.error || "unknown error"}`);
        }
        setFile(null);
      }
      if (review) router.push(`/visits/${body.id}`);
      else { setMessage("Draft saved."); router.replace(`/visits/${body.id}?edit=true`); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save draft."); }
    finally { setBusy(false); }
  }

  const weekday = input.requestedStartDate
    ? new Date(`${input.requestedStartDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) : null;
  const adultGuestCount = Math.max(0, (input.adultCount || 1) - 1);
  return <div className="visit-editor">
    <div className="visit-section-head"><div><p className="eyebrow">{draftId ? "Edit request" : "New request"}</p><h1>Request a Winery Visit</h1><p>Save a draft, then review it before submitting. The winery has not been contacted.</p></div></div>
    {errors.length ? <div className="visit-error"><strong>Complete these fields:</strong><ul>{errors.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {message ? <p className="form-message">{message}</p> : null}

    <section className="visit-panel"><h2>Producer and schedule</h2><div className="visit-form-grid">
      <label className="visit-wide">Producer<input value={producerOtherMode ? input.producerOther || "" : producerLabel}
        onChange={(e) => { if (producerOtherMode) update("producerOther", e.target.value); else { setProducerLabel(e.target.value); update("producerId", null); } }}
        placeholder={producerOtherMode ? "Type producer name for review" : "Search producers"} />
        {!producerOtherMode && producerResults.length && !input.producerId ? <div className="visit-picker">{producerResults.map((item) => <button type="button" key={item.id} onClick={() => {
          update("producerId", item.id); update("producerOther", null); update("timezone", item.timezone);
          setProducerLabel(item.display_name); setManagerName(item.manager_name || ""); setProducerResults([]);
        }}>{item.display_name}{item.manager_name ? ` · ${item.manager_name}` : " · manager review"}</button>)}</div> : null}
      </label>
      <label className="visit-check"><input type="checkbox" checked={producerOtherMode} onChange={(e) => {
        setProducerOtherMode(e.target.checked); update("producerId", null); update("producerOther", null); setProducerLabel(""); setManagerName("");
      }} /> Producer not listed</label>
      <div className="visit-wide visit-callout">{managerName ? `Assigned brand manager: ${managerName}` : "No assigned brand manager yet. This request will appear in the administrator review queue."}</div>
      <label>Winery local timezone<input list="winery-zones" value={input.timezone || ""} onChange={(e) => update("timezone", e.target.value)} placeholder="Europe/Rome" /><datalist id="winery-zones">{Intl.supportedValuesOf("timeZone").map((zone) => <option key={zone} value={zone} />)}</datalist></label>
      <label>First requested date<input type="date" value={input.requestedStartDate || ""} onChange={(e) => update("requestedStartDate", e.target.value)} />{weekday ? <small>{weekday}, winery local date</small> : null}</label>
      <label>Through date, if a range<input type="date" value={input.requestedEndDate || ""} onChange={(e) => update("requestedEndDate", e.target.value || null)} /></label>
      <YesNo label="Are dates flexible?" value={input.dateFlexible} onChange={(value) => update("dateFlexible", value)} />
      <label className="visit-wide">Alternate dates<textarea value={input.alternateDates || ""} onChange={(e) => update("alternateDates", e.target.value)} /></label>
      <label>Preferred local time<input type="time" value={input.requestedStartTime || ""} onChange={(e) => update("requestedStartTime", e.target.value)} /></label>
      <label>End of time window, if applicable<input type="time" value={input.requestedEndTime || ""} onChange={(e) => update("requestedEndTime", e.target.value || null)} /></label>
      <YesNo label="Is the time flexible?" value={input.timeFlexible} onChange={(value) => update("timeFlexible", value)} />
      <label>Experience<select value={input.experience || ""} onChange={(e) => update("experience", e.target.value as VisitDraftInput["experience"])}><option value="">Choose one</option><option value="tasting">Tasting</option><option value="tour">Tour</option><option value="tasting_and_tour">Tasting and tour</option><option value="meal">Meal</option><option value="other">Other</option></select></label>
      {input.experience === "other" ? <label>Describe experience<input value={input.experienceOther || ""} onChange={(e) => update("experienceOther", e.target.value)} /></label> : null}
      <YesNo label="Would a simpler alternative work?" value={input.simplerAlternativeOk} onChange={(value) => update("simplerAlternativeOk", value)} />
      <label>Trip reference, optional<input value={input.tripReference || ""} onChange={(e) => update("tripReference", e.target.value)} /></label>
    </div></section>

    <section className="visit-panel"><h2>Visitor and account</h2><div className="visit-form-grid">
      <label>Visitor type<select value={input.visitorType || ""} onChange={(e) => update("visitorType", e.target.value as VisitDraftInput["visitorType"])}><option value="">Choose one</option><option value="trade">Buyer / trade visitor</option><option value="consumer">Consumer</option></select></label>
      <label>Account{input.visitorType === "trade" ? " (required)" : " (optional)"}<input value={accountOtherMode ? input.accountOther || "" : accountLabel}
        onChange={(e) => { if (accountOtherMode) update("accountOther", e.target.value); else { setAccountLabel(e.target.value); update("accountId", null); } }}
        placeholder={accountOtherMode ? "Type account for review" : "Search VinoSmith accounts"} />
        {!accountOtherMode && accountResults.length && !input.accountId ? <div className="visit-picker">{accountResults.map((item) => <button key={item.account_id} type="button" onClick={() => { update("accountId", item.account_id); update("accountOther", null); setAccountLabel(item.name || item.code || item.account_id); setAccountResults([]); }}>{item.name || item.code || item.account_id}</button>)}</div> : null}
        {accountUnavailable ? <small className="visit-warning">VinoSmith lookup is unavailable. Use “Account not listed” for review.</small> : null}</label>
      <label className="visit-check"><input type="checkbox" checked={accountOtherMode} onChange={(e) => { setAccountOtherMode(e.target.checked); update("accountId", null); update("accountOther", null); setAccountLabel(""); }} /> Account not listed</label>
      <label>Primary contact full name<input value={input.primaryContactName || ""} onChange={(e) => update("primaryContactName", e.target.value)} /></label>
      <label>Primary contact email<input type="email" value={input.primaryContactEmail || ""} onChange={(e) => update("primaryContactEmail", e.target.value)} /></label>
      <label>Phone with country code<input type="tel" placeholder="+1 555 555 5555" value={input.primaryContactPhone || ""} onChange={(e) => update("primaryContactPhone", e.target.value)} /></label>
      <label>{input.visitorType === "trade" ? "Role at account" : "Role or description"}<input value={input.contactRole || ""} onChange={(e) => update("contactRole", e.target.value)} placeholder="Buyer, owner, sommelier…" /></label>
      <label>Relationship to Stem<input value={input.visitorRelationship || ""} onChange={(e) => update("visitorRelationship", e.target.value)} placeholder="Club member, collector…" /></label>
      <label>Current support<select value={input.supportStatus || ""} onChange={(e) => update("supportStatus", e.target.value as VisitDraftInput["supportStatus"])}><option value="">Choose one</option><option value="none">None</option><option value="unknown">Unknown</option><option value="details">Describe purchases or support</option></select></label>
      {input.supportStatus === "details" ? <label className="visit-wide">What they currently buy or support<textarea value={input.supportDetails || ""} onChange={(e) => update("supportDetails", e.target.value)} /></label> : null}
      <label className="visit-wide">Purpose of visit<textarea value={input.purpose || ""} onChange={(e) => update("purpose", e.target.value)} /></label>
    </div></section>

    <section className="visit-panel"><h2>Party and hospitality</h2><p>Counts include the primary contact. Give only the details needed for the winery to host the group.</p><div className="visit-form-grid">
      <label>Adults including primary<input type="number" min="1" max="50" value={input.adultCount ?? ""} onChange={(e) => { const count = Number(e.target.value); update("adultCount", Number.isInteger(count) ? count : null); setInput((previous) => ({ ...previous, adultCount: count, adultGuests: Array.from({ length: Math.max(0, Math.min(49, count - 1)) }, (_, i) => previous.adultGuests[i] || { name: "", email: null, phone: null }) })); }} /></label>
      <label>Children<input type="number" min="0" max="49" value={input.childCount ?? ""} onChange={(e) => update("childCount", Number(e.target.value))} /></label>
      <div className="visit-wide"><strong>Total guests: {(input.adultCount || 0) + (input.childCount || 0)}</strong>{input.childCount ? <p>Children use the primary contact’s details. The winery may ask about eligibility later; birth dates and child contact details are not collected.</p> : null}</div>
      {Array.from({ length: adultGuestCount }, (_, index) => <div key={index} className="visit-guest-row visit-wide"><strong>Additional adult {index + 1}</strong>
        <label>Name<input value={input.adultGuests[index]?.name || ""} onChange={(e) => setInput((previous) => { const guests = [...previous.adultGuests]; guests[index] = { ...(guests[index] || { email: null, phone: null }), name: e.target.value }; return { ...previous, adultGuests: guests }; })} /></label>
        <label>Email, optional<input type="email" value={input.adultGuests[index]?.email || ""} onChange={(e) => setInput((previous) => { const guests = [...previous.adultGuests]; guests[index] = { ...(guests[index] || { name: "", phone: null }), email: e.target.value }; return { ...previous, adultGuests: guests }; })} /></label>
        <label>Phone, optional<input type="tel" value={input.adultGuests[index]?.phone || ""} onChange={(e) => setInput((previous) => { const guests = [...previous.adultGuests]; guests[index] = { ...(guests[index] || { name: "", email: null }), phone: e.target.value }; return { ...previous, adultGuests: guests }; })} /></label>
      </div>)}
      <label>Dietary restrictions / allergies<select value={input.dietaryStatus || ""} onChange={(e) => update("dietaryStatus", e.target.value as VisitDraftInput["dietaryStatus"])}><option value="">Choose one</option><option value="none">None</option><option value="details">Yes, provide details</option></select></label>
      {input.dietaryStatus === "details" ? <label className="visit-wide">Dietary details<textarea value={input.dietaryDetails || ""} onChange={(e) => update("dietaryDetails", e.target.value)} /></label> : null}
      <label>Accessibility needs, optional<textarea value={input.accessibilityNeeds || ""} onChange={(e) => update("accessibilityNeeds", e.target.value)} /></label>
      <YesNo label="Transportation assistance needed?" value={input.transportationHelp} onChange={(value) => update("transportationHelp", value)} optional />
      {input.transportationHelp ? <label>Where are they staying?<input value={input.lodging || ""} onChange={(e) => update("lodging", e.target.value)} /></label> : null}
      <label>Fee expectations<textarea value={input.feeExpectations || ""} onChange={(e) => update("feeExpectations", e.target.value)} placeholder="Unknown, budget, or expected charges" /></label>
      <label>Who is expected to pay?<input value={input.expectedPayer || ""} onChange={(e) => update("expectedPayer", e.target.value)} placeholder="Visitor, Stem, account, unknown…" /></label>
      <label>Language requirements<textarea value={input.languageRequirements || ""} onChange={(e) => update("languageRequirements", e.target.value)} /></label>
      <label>Confirmed appointments or travel constraints<textarea value={input.travelConstraints || ""} onChange={(e) => update("travelConstraints", e.target.value)} /></label>
      <label className="visit-wide">Notes suitable for winery<textarea value={input.wineryNotes || ""} onChange={(e) => update("wineryNotes", e.target.value)} /></label>
      <label className="visit-wide">Internal business context<textarea value={input.internalContext || ""} onChange={(e) => update("internalContext", e.target.value)} /><small>Visible only to you, the assigned manager and administrators.</small></label>
      <label className="visit-wide">Optional itinerary (PDF, PNG or JPEG, 10 MB max)<input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
    </div></section>
    <div className="visit-actions"><button className="button button-outline" disabled={busy} type="button" onClick={() => void save(false)}>Save Draft</button><button className="button" disabled={busy} type="button" onClick={() => void save(true)}>{busy ? "Saving…" : "Review before submission"}</button></div>
  </div>;
}

function YesNo({ label, value, onChange, optional = false }: { label: string; value: boolean | null; onChange: (value: boolean | null) => void; optional?: boolean }) {
  return <label>{label}<select value={value === null ? "" : value ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "yes")}>
    <option value="">{optional ? "Not specified" : "Choose one"}</option><option value="yes">Yes</option><option value="no">No</option>
  </select></label>;
}
