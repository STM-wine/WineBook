import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisitDraftInput } from "./validation";
import { validTimezone } from "./validation";

export type ResolvedVisit = {
  producerId: string | null; producerName: string | null; producerNeedsReview: boolean;
  managerUserId: string | null; timezone: string | null;
  accountId: string | null; accountName: string | null; accountNeedsReview: boolean;
};

export async function resolveVisitReferences(db: SupabaseClient, input: VisitDraftInput): Promise<ResolvedVisit> {
  let producerId: string | null = null;
  let producerName: string | null = null;
  let managerUserId: string | null = null;
  let timezone: string | null = input.timezone;
  let producerNeedsReview = false;
  if (input.producerId) {
    const { data, error } = await db.from("visit_producers")
      .select("id,display_name,manager_user_id,timezone,active")
      .eq("id", input.producerId).maybeSingle();
    if (error || !data || !data.active) throw new Error("Choose a listed producer or use producer not listed.");
    producerId = data.id;
    producerName = data.display_name;
    managerUserId = data.manager_user_id;
    timezone = data.timezone || input.timezone;
    producerNeedsReview = !data.timezone;
  } else if (input.producerOther) {
    producerName = input.producerOther;
    producerNeedsReview = true;
  }
  if (timezone && !validTimezone(timezone)) throw new Error("Choose a valid winery timezone.");

  let accountId: string | null = null;
  let accountName: string | null = null;
  let accountNeedsReview = false;
  if (input.accountId) {
    const { data, error } = await db.from("vinosmith_accounts")
      .select("account_id,name,code")
      .eq("account_id", input.accountId).maybeSingle();
    if (error || !data) throw new Error("Account lookup is unavailable. Enter an account for review.");
    accountId = data.account_id;
    accountName = data.name || data.code || data.account_id;
  } else if (input.accountOther) {
    accountName = input.accountOther;
    accountNeedsReview = true;
  }
  return { producerId, producerName, producerNeedsReview, managerUserId,
    timezone, accountId, accountName, accountNeedsReview };
}

export function summaryColumns(input: VisitDraftInput, resolved: ResolvedVisit) {
  const adults = input.adultCount || 0;
  const children = input.childCount || 0;
  return {
    producer_id: resolved.producerId,
    producer_name: resolved.producerName,
    producer_needs_review: resolved.producerNeedsReview,
    manager_user_id: resolved.managerUserId,
    winery_timezone: resolved.timezone,
    account_id: resolved.accountId,
    account_name: resolved.accountName,
    account_needs_review: resolved.accountNeedsReview,
    visitor_type: input.visitorType,
    requested_start_date: input.requestedStartDate,
    requested_end_date: input.requestedEndDate,
    date_flexible: input.dateFlexible,
    alternate_dates: input.alternateDates,
    requested_start_time: input.requestedStartTime,
    requested_end_time: input.requestedEndTime,
    time_flexible: input.timeFlexible,
    experience: input.experience,
    simpler_alternative_ok: input.simplerAlternativeOk,
    party_size: adults + children || null,
    trip_reference: input.tripReference
  };
}

export function detailColumns(input: VisitDraftInput) {
  return {
    primary_contact_name: input.primaryContactName,
    primary_contact_email: input.primaryContactEmail,
    primary_contact_phone: input.primaryContactPhone,
    contact_role: input.contactRole,
    visitor_relationship: input.visitorRelationship,
    experience_other: input.experienceOther,
    support_status: input.supportStatus,
    support_details: input.supportDetails,
    purpose: input.purpose,
    adult_count: input.adultCount,
    child_count: input.childCount,
    adult_guests: input.adultGuests,
    dietary_status: input.dietaryStatus,
    dietary_details: input.dietaryDetails,
    accessibility_needs: input.accessibilityNeeds,
    transportation_help: input.transportationHelp,
    lodging: input.lodging,
    fee_expectations: input.feeExpectations,
    expected_payer: input.expectedPayer,
    language_requirements: input.languageRequirements,
    travel_constraints: input.travelConstraints,
    winery_notes: input.wineryNotes,
    internal_context: input.internalContext
  };
}
