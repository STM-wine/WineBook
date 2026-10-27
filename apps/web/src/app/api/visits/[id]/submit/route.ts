import { getVisitActor, visitDb, visitErrorResponse } from "@/lib/visits/access";
import { parseVisitDraft, validateForSubmission } from "@/lib/visits/validation";
import { deliverPendingForRequest } from "@/lib/visits/notifications";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await getVisitActor();
    const { id } = await params;
    const { version } = await request.json();
    const db = visitDb();
    const { data: visit, error } = await db.from("visit_requests").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!visit || visit.requester_id !== actor.id) return Response.json({ error: "Request not found." }, { status: 404 });
    if (visit.status !== "Draft") return json({ visit });
    if (visit.lock_version !== version) return Response.json({ error: "Draft changed. Reload before submitting." }, { status: 409 });
    const { data: details, error: detailsError } = await db.from("visit_request_details")
      .select("*").eq("request_id", id).maybeSingle();
    if (detailsError || !details) throw detailsError || new Error("Draft details are missing.");
    const input = parseVisitDraft({
      producerId: visit.producer_id, producerOther: visit.producer_id ? null : visit.producer_name,
      timezone: visit.winery_timezone, accountId: visit.account_id,
      accountOther: visit.account_id ? null : visit.account_name,
      visitorType: visit.visitor_type, requestedStartDate: visit.requested_start_date,
      requestedEndDate: visit.requested_end_date, dateFlexible: visit.date_flexible,
      alternateDates: visit.alternate_dates, requestedStartTime: visit.requested_start_time?.slice(0, 5),
      requestedEndTime: visit.requested_end_time?.slice(0, 5), timeFlexible: visit.time_flexible,
      experience: visit.experience, simplerAlternativeOk: visit.simpler_alternative_ok,
      primaryContactName: details.primary_contact_name, primaryContactEmail: details.primary_contact_email,
      primaryContactPhone: details.primary_contact_phone, contactRole: details.contact_role,
      experienceOther: details.experience_other,
      supportStatus: details.support_status, supportDetails: details.support_details,
      purpose: details.purpose, adultCount: details.adult_count, childCount: details.child_count,
      adultGuests: details.adult_guests, dietaryStatus: details.dietary_status,
      dietaryDetails: details.dietary_details, feeExpectations: details.fee_expectations,
      expectedPayer: details.expected_payer
    });
    const errors = validateForSubmission(input, {
      producerName: visit.producer_name, accountName: visit.account_name, timezone: visit.winery_timezone
    });
    if (errors.length) return Response.json({ errors }, { status: 422 });
    const { data: submitted, error: submitError } = await db.rpc("submit_visit_request", {
      p_request_id: id, p_actor_id: actor.id, p_version: version
    });
    if (submitError) throw submitError;
    await deliverPendingForRequest(id).catch(() => undefined);
    return json({ visit: submitted });
  } catch (error) { return visitErrorResponse(error); }
}

function json(value: unknown) { return Response.json(value, { headers: { "Cache-Control": "private, no-store" } }); }
