export type VisitDraftInput = {
  producerId: string | null; producerOther: string | null; timezone: string | null;
  accountId: string | null; accountOther: string | null; visitorType: "trade" | "consumer" | null;
  requestedStartDate: string | null; requestedEndDate: string | null; dateFlexible: boolean | null;
  alternateDates: string | null; requestedStartTime: string | null; requestedEndTime: string | null;
  timeFlexible: boolean | null; experience: "tasting" | "tour" | "tasting_and_tour" | "meal" | "other" | null;
  simplerAlternativeOk: boolean | null; tripReference: string | null;
  primaryContactName: string | null; primaryContactEmail: string | null; primaryContactPhone: string | null;
  contactRole: string | null; visitorRelationship: string | null;
  experienceOther: string | null;
  supportStatus: "none" | "unknown" | "details" | null; supportDetails: string | null;
  purpose: string | null; adultCount: number | null; childCount: number | null;
  adultGuests: Array<{ name: string; email: string | null; phone: string | null }>;
  dietaryStatus: "none" | "details" | null; dietaryDetails: string | null;
  accessibilityNeeds: string | null; transportationHelp: boolean | null; lodging: string | null;
  feeExpectations: string | null; expectedPayer: string | null; languageRequirements: string | null;
  travelConstraints: string | null; wineryNotes: string | null; internalContext: string | null;
};

function string(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (result.length > max) throw new Error(`A field exceeds ${max} characters.`);
  return result || null;
}
function flag(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function choice<T extends string>(value: unknown, values: readonly T[]): T | null {
  return values.includes(value as T) ? value as T : null;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 50 ? value : null;
}
function date(value: unknown): string | null {
  const text = string(value, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T12:00:00Z`)) ||
      new Date(`${text}T12:00:00Z`).toISOString().slice(0, 10) !== text) throw new Error("Enter a valid local date.");
  return text;
}
function time(value: unknown): string | null {
  const text = string(value, 5);
  if (!text) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error("Enter a valid local time.");
  return text;
}
export function validTimezone(value: string | null): boolean {
  if (!value) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
  catch { return false; }
}

export function parseVisitDraft(raw: unknown): VisitDraftInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid request.");
  const v = raw as Record<string, unknown>;
  const adultGuests = Array.isArray(v.adultGuests) ? v.adultGuests.slice(0, 49).map((guest) => {
    const g = guest && typeof guest === "object" ? guest as Record<string, unknown> : {};
    return { name: string(g.name, 120) || "", email: string(g.email, 320), phone: string(g.phone, 40) };
  }) : [];
  return {
    producerId: string(v.producerId, 80), producerOther: string(v.producerOther, 160), timezone: string(v.timezone, 80),
    accountId: string(v.accountId, 80), accountOther: string(v.accountOther, 160),
    visitorType: choice(v.visitorType, ["trade", "consumer"]),
    requestedStartDate: date(v.requestedStartDate), requestedEndDate: date(v.requestedEndDate),
    dateFlexible: flag(v.dateFlexible), alternateDates: string(v.alternateDates),
    requestedStartTime: time(v.requestedStartTime), requestedEndTime: time(v.requestedEndTime),
    timeFlexible: flag(v.timeFlexible),
    experience: choice(v.experience, ["tasting", "tour", "tasting_and_tour", "meal", "other"]),
    simplerAlternativeOk: flag(v.simplerAlternativeOk), tripReference: string(v.tripReference, 120),
    primaryContactName: string(v.primaryContactName, 120),
    primaryContactEmail: string(v.primaryContactEmail, 320),
    primaryContactPhone: string(v.primaryContactPhone, 40),
    contactRole: string(v.contactRole, 120), visitorRelationship: string(v.visitorRelationship, 200),
    experienceOther: string(v.experienceOther, 500),
    supportStatus: choice(v.supportStatus, ["none", "unknown", "details"]),
    supportDetails: string(v.supportDetails), purpose: string(v.purpose),
    adultCount: count(v.adultCount), childCount: count(v.childCount), adultGuests,
    dietaryStatus: choice(v.dietaryStatus, ["none", "details"]),
    dietaryDetails: string(v.dietaryDetails), accessibilityNeeds: string(v.accessibilityNeeds),
    transportationHelp: flag(v.transportationHelp), lodging: string(v.lodging),
    feeExpectations: string(v.feeExpectations), expectedPayer: string(v.expectedPayer, 200),
    languageRequirements: string(v.languageRequirements), travelConstraints: string(v.travelConstraints),
    wineryNotes: string(v.wineryNotes), internalContext: string(v.internalContext)
  };
}

export function validateForSubmission(input: VisitDraftInput, resolved: {
  producerName: string | null; accountName: string | null; timezone: string | null;
}) {
  const errors: string[] = [];
  if (!resolved.producerName) errors.push("Choose a producer or enter one for review.");
  if (!validTimezone(resolved.timezone)) errors.push("Choose the winery's local timezone.");
  if (!input.requestedStartDate) errors.push("Choose a visit date.");
  if (input.requestedEndDate && input.requestedStartDate && input.requestedEndDate < input.requestedStartDate) errors.push("Date range ends before it starts.");
  if (input.dateFlexible === null) errors.push("Select whether the date is flexible.");
  if (!input.requestedStartTime) errors.push("Choose a local visit time or window.");
  if (input.requestedEndTime && input.requestedStartTime && input.requestedEndTime <= input.requestedStartTime) errors.push("Time window must end after it starts.");
  if (input.timeFlexible === null) errors.push("Select whether the time is flexible.");
  if (!input.experience || input.simplerAlternativeOk === null) errors.push("Choose the experience and whether a simpler option works.");
  if (input.experience === "other" && !input.experienceOther) errors.push("Describe the desired experience.");
  if (!input.visitorType) errors.push("Choose trade visitor or consumer.");
  if (input.visitorType === "trade" && !resolved.accountName) errors.push("Choose an account or enter one for review.");
  if (input.visitorType === "trade" && !input.contactRole) errors.push("Enter the visitor's role at the account.");
  if (!input.primaryContactName || !input.primaryContactEmail || !input.primaryContactPhone) errors.push("Enter the primary contact's name, email and phone with country code.");
  if (input.primaryContactEmail && !/^\S+@\S+\.\S+$/.test(input.primaryContactEmail)) errors.push("Enter a valid contact email.");
  if (input.primaryContactPhone && !/^\+[1-9]\d[\d\s().-]{5,20}$/.test(input.primaryContactPhone)) errors.push("Phone must include an international country code, such as +1.");
  if (!input.supportStatus || (input.supportStatus === "details" && !input.supportDetails)) errors.push("State what the visitor buys or supports, or select none or unknown.");
  if (!input.purpose) errors.push("Enter the purpose of the visit.");
  if (!input.adultCount || input.childCount === null || input.adultCount + input.childCount > 50) errors.push("Enter a valid adult and child count.");
  if (input.adultCount !== null && input.adultGuests.length !== Math.max(0, input.adultCount - 1)) errors.push("Add one name for each adult besides the primary contact.");
  if (input.adultGuests.some((guest) => !guest.name)) errors.push("Enter each additional adult's name.");
  if (!input.dietaryStatus || (input.dietaryStatus === "details" && !input.dietaryDetails)) errors.push("State dietary needs or select none.");
  if (!input.feeExpectations || !input.expectedPayer) errors.push("Describe fee expectations and who is expected to pay.");
  return errors;
}
