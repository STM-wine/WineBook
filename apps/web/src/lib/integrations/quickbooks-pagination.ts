import {
  continueQuickBooksRequest,
  type QuickBooksDesktopQbxmlRequest,
  type QuickBooksQbxmlResponseStatus
} from "./quickbooks-desktop";

export function nextQuickBooksPage(
  request: QuickBooksDesktopQbxmlRequest,
  statuses: QuickBooksQbxmlResponseStatus[],
  recordCount: number | null
) {
  if (!request.pagination) return null;

  const status = statuses[0] || null;
  if (status?.statusSeverity === "Error" || Boolean(status?.statusCode && status.statusCode >= 3000)) {
    throw new Error(status.statusMessage || `QuickBooks ${request.requestType} returned an error.`);
  }
  if (status?.statusCode === 1 && (recordCount || 0) === 0) return null;

  const remaining = status?.iteratorRemainingCount;
  if (remaining === 0) return null;
  if (typeof remaining === "number" && remaining > 0) {
    if (!status?.iteratorId) {
      throw new Error(`QuickBooks ${request.requestType} has ${remaining} remaining rows but returned no iterator ID.`);
    }
    return continueQuickBooksRequest(request, status.iteratorId);
  }

  throw new Error(
    `QuickBooks ${request.requestType} did not confirm pagination completeness after returning ${recordCount || 0} rows.`
  );
}
