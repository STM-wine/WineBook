import { describe, expect, it } from "vitest";
import { parseVisitDraft, validateForSubmission } from "./validation";

const complete = {
  producerId: "producer", timezone: "Europe/Rome", accountId: "account", visitorType: "trade",
  requestedStartDate: "2026-11-16", dateFlexible: false, requestedStartTime: "10:30",
  timeFlexible: true, experience: "tasting_and_tour", simplerAlternativeOk: false,
  primaryContactName: "Synthetic Buyer", primaryContactEmail: "buyer@example.test",
  primaryContactPhone: "+39 055 1234567", contactRole: "Buyer",
  supportStatus: "none", purpose: "Meet the producer", adultCount: 2, childCount: 1,
  adultGuests: [{ name: "Synthetic Guest" }], dietaryStatus: "none",
  feeExpectations: "Charges unknown", expectedPayer: "Visitor"
};

describe("winery visit submission validation", () => {
  it("accepts a complete synthetic trade request in the winery timezone", () => {
    const input = parseVisitDraft(complete);
    expect(validateForSubmission(input, { producerName: "Synthetic Winery", accountName: "Synthetic Account", timezone: "Europe/Rome" })).toEqual([]);
  });

  it("rejects invalid local dates and an inverted time window", () => {
    expect(() => parseVisitDraft({ ...complete, requestedStartDate: "2026-02-30" })).toThrow("valid local date");
    const input = parseVisitDraft({ ...complete, requestedEndTime: "09:00" });
    expect(validateForSubmission(input, { producerName: "Winery", accountName: "Account", timezone: "Europe/Rome" }))
      .toContain("Time window must end after it starts.");
  });

  it("requires additional adult names and explicit dietary and purchase context", () => {
    const input = parseVisitDraft({ ...complete, adultGuests: [], dietaryStatus: null, supportStatus: null });
    const errors = validateForSubmission(input, { producerName: "Winery", accountName: "Account", timezone: "Europe/Rome" });
    expect(errors).toContain("Add one name for each adult besides the primary contact.");
    expect(errors).toContain("State dietary needs or select none.");
    expect(errors).toContain("State what the visitor buys or supports, or select none or unknown.");
  });

  it("requires a winery timezone and international phone code", () => {
    const input = parseVisitDraft({ ...complete, primaryContactPhone: "555-1234" });
    const errors = validateForSubmission(input, { producerName: "Winery", accountName: "Account", timezone: null });
    expect(errors).toContain("Choose the winery's local timezone.");
    expect(errors).toContain("Phone must include an international country code, such as +1.");
  });
});
