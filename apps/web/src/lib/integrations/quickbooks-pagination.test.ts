import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildQuickBooksOperationalRefreshRequests,
  createQuickBooksDesktopReadOnlyClient
} from "./quickbooks-desktop";
import { nextQuickBooksPage } from "./quickbooks-pagination";

describe("QuickBooks pagination completeness", () => {
  const client = createQuickBooksDesktopReadOnlyClient({ qbxmlVersion: "16.0" });

  it("builds a continuation request until QuickBooks reports zero remaining rows", () => {
    const first = client.buildItemQuery({
      requestId: "operational-items",
      maxReturned: 1000,
      iterator: { mode: "Start" },
      activeStatus: "All",
      modifiedDateRange: { from: "2026-08-08T00:00:00", to: "2026-09-22T23:59:59" }
    });
    const next = nextQuickBooksPage(first, [{
      requestType: "ItemQueryRq",
      responseType: "ItemQueryRs",
      statusCode: 0,
      statusSeverity: "Info",
      statusMessage: "Status OK",
      iteratorId: "iterator-123",
      iteratorRemainingCount: 176
    }], 1000);

    expect(first.qbxml).toContain('iterator="Start"');
    expect(next?.qbxml).toContain('iterator="Continue"');
    expect(next?.qbxml).toContain('iteratorID="iterator-123"');
    expect(next?.qbxml).not.toContain("FromModifiedDate");
    expect(next?.qbxml).not.toContain("ToModifiedDate");
    expect(next?.pagination).toEqual({ maxReturned: 1000, iteratorMode: "Continue" });
    expect(nextQuickBooksPage(next!, [{
      requestType: "ItemQueryRq",
      responseType: "ItemQueryRs",
      statusCode: 0,
      statusSeverity: "Info",
      statusMessage: "Status OK",
      iteratorId: "iterator-123",
      iteratorRemainingCount: 0
    }], 176)).toBeNull();
  });

  it("fails closed when an iterator-enabled response omits completeness metadata", () => {
    const request = client.buildItemQuery({ maxReturned: 1000, iterator: { mode: "Start" } });
    expect(() => nextQuickBooksPage(request, [{
      requestType: "ItemQueryRq",
      responseType: "ItemQueryRs",
      statusCode: 0,
      statusSeverity: "Info",
      statusMessage: "Status OK",
      iteratorId: null,
      iteratorRemainingCount: null
    }], 1000)).toThrow("did not confirm pagination completeness");
  });

  it("accepts QuickBooks' no-matching-object response as a complete empty page", () => {
    const request = client.buildInvoiceQuery({ maxReturned: 1000, iterator: { mode: "Start" } });
    expect(nextQuickBooksPage(request, [{
      requestType: "InvoiceQueryRq",
      responseType: "InvoiceQueryRs",
      statusCode: 1,
      statusSeverity: "Info",
      statusMessage: "A query request did not find a matching object in QuickBooks",
      iteratorId: null,
      iteratorRemainingCount: null
    }], 0)).toBeNull();
  });

  it("fails the run when QuickBooks returns an error status", () => {
    const request = client.buildItemQuery({ maxReturned: 1000, iterator: { mode: "Start" } });
    expect(() => nextQuickBooksPage(request, [{
      requestType: "ItemQueryRq",
      responseType: "ItemQueryRs",
      statusCode: 500,
      statusSeverity: "Error",
      statusMessage: "Iterator failed",
      iteratorId: null,
      iteratorRemainingCount: null
    }], 0)).toThrow("Iterator failed");
  });

  it("makes every capped operational resource iterable and performs a complete item scan", () => {
    const requests = buildQuickBooksOperationalRefreshRequests({
      maxReturned: 1000,
      listMaxReturned: 1000,
      modifiedDateRange: { from: "2026-08-08T00:00:00", to: "2026-09-22T23:59:59" },
      txnDateWindows: [{ from: "2026-09-16", to: "2026-09-22" }]
    });
    const capped = requests.filter((request) => request.requestType !== "SalesRepQueryRq");
    expect(capped).toHaveLength(6);
    expect(capped.every((request) => request.pagination?.iteratorMode === "Start")).toBe(true);

    const itemRequest = requests.find((request) => request.requestId === "operational-items");
    expect(itemRequest?.qbxml).toContain("<ActiveStatus>All</ActiveStatus>");
    expect(itemRequest?.qbxml).not.toContain("FromModifiedDate");
    expect(itemRequest?.qbxml).not.toContain("ToModifiedDate");
  });
});
