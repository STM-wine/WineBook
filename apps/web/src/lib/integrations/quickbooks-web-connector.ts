import "server-only";

import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { persistQuickBooksResponse } from "@/lib/integrations/quickbooks-response-persistence";
import {
  buildNextQuickBooksRecoveryRequests,
  buildQuickBooksRecoveryQueueStatus,
  completeQuickBooksRecoveryJob,
  failQuickBooksRecoveryJob,
  type QuickBooksRecoveryCompletion,
  type QuickBooksRecoveryRequest
} from "@/lib/integrations/quickbooks-recovery-queue";
import {
  assertQuickBooksReadOnlyQbxml,
  buildQuickBooksSalesDashboardDiscoveryRequests,
  createQuickBooksDesktopReadOnlyClient,
  parseQbxmlResponseStatuses,
  type QuickBooksDateRange,
  type QuickBooksQbxmlResponseStatus
} from "@/lib/integrations/quickbooks-desktop";

const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";
const QBWC_NS = "http://developer.intuit.com/";
const DEFAULT_USERNAME = "stem-qbwc";
const DEFAULT_CAPTURE_RAW_RESPONSES = true;
const DEFAULT_SALES_DELIVERY_FROM = "2026-08-13";
const DEFAULT_SALES_DELIVERY_TO = "2026-08-13";
const DEFAULT_OPERATIONAL_TXN_LOOKBACK_DAYS = 45;
const DEFAULT_OPERATIONAL_TXN_WINDOW_DAYS = 7;
const DEFAULT_OPERATIONAL_LIST_MODIFIED_LOOKBACK_DAYS = 45;
const RECENT_SESSION_LIMIT = 10;

const SUPPORTED_METHODS = [
  "clientVersion",
  "serverVersion",
  "authenticate",
  "sendRequestXML",
  "receiveResponseXML",
  "getLastError",
  "closeConnection",
  "connectionError"
] as const;

type QuickBooksWebConnectorMethod = (typeof SUPPORTED_METHODS)[number];

type QuickBooksWebConnectorSession = {
  ticket: string;
  username: string;
  createdAt: string;
  requestIndex: number;
  requests: QuickBooksRecoveryRequest[];
  lastError: string;
  responses: Array<{
    requestType: string;
    requestId?: string;
    status: QuickBooksQbxmlResponseStatus[];
    responseChecksum: string;
    receivedAt: string;
    recordCount: number | null;
  }>;
};

type QuickBooksWebConnectorSessionSummary = {
  ticketSuffix: string;
  username: string;
  createdAt: string;
  closedAt?: string;
  requestCount: number;
  completedRequestCount: number;
  lastError: string | null;
  responses: Array<{
    requestType: string;
    requestId?: string;
    receivedAt: string;
    responseChecksum: string;
    recordCount: number | null;
    status: QuickBooksQbxmlResponseStatus[];
  }>;
};

type QuickBooksWebConnectorGlobal = typeof globalThis & {
  __stemQuickBooksWebConnectorSessions?: Map<string, QuickBooksWebConnectorSession>;
  __stemQuickBooksWebConnectorRecentSessions?: QuickBooksWebConnectorSessionSummary[];
};

export type QuickBooksWebConnectorResult = {
  status: number;
  body: string;
  contentType: string;
};

const sessionStore =
  ((globalThis as QuickBooksWebConnectorGlobal).__stemQuickBooksWebConnectorSessions ||= new Map<
    string,
    QuickBooksWebConnectorSession
  >());
const recentSessions = ((globalThis as QuickBooksWebConnectorGlobal).__stemQuickBooksWebConnectorRecentSessions ||= []);

export async function handleQuickBooksWebConnectorSoapRequest(soapRequest: string): Promise<QuickBooksWebConnectorResult> {
  const method = extractSoapMethod(soapRequest);
  if (!method) {
    return soapFault("Client", "Unsupported QuickBooks Web Connector SOAP method.");
  }

  try {
    switch (method) {
      case "clientVersion":
        return soapOk(method, scalarResult("clientVersionResult", ""));
      case "serverVersion":
        return soapOk(method, scalarResult("serverVersionResult", "Stem Intelligence QBWC 0.1"));
      case "authenticate":
        return soapOk(method, arrayResult("authenticateResult", await authenticate(soapRequest)));
      case "sendRequestXML":
        return soapOk(method, scalarResult("sendRequestXMLResult", sendRequestXML(soapRequest)));
      case "receiveResponseXML":
        return soapOk(method, scalarResult("receiveResponseXMLResult", await receiveResponseXML(soapRequest)));
      case "getLastError":
        return soapOk(method, scalarResult("getLastErrorResult", getLastError(soapRequest)));
      case "closeConnection":
        return soapOk(method, scalarResult("closeConnectionResult", closeConnection(soapRequest)));
      case "connectionError":
        return soapOk(method, scalarResult("connectionErrorResult", connectionError(soapRequest)));
      default:
        return soapFault("Client", "Unsupported QuickBooks Web Connector SOAP method.");
    }
  } catch (error) {
    return soapFault("Server", error instanceof Error ? error.message : "QuickBooks Web Connector request failed.");
  }
}

export async function buildQuickBooksWebConnectorStatus() {
  const recoveryQueue = await buildQuickBooksRecoveryQueueStatus();
  const operationalRequests = buildOperationalRefreshRequests();
  const requestTypes = [
    ...operationalRequests.map((request) => request.requestType),
    ...recoveryQueue.nextJobs.slice(0, 1).map((job) => requestTypeForRecoveryResource(job.resourceName))
  ];
  return {
    service: "Stem Intelligence QuickBooks Desktop Web Connector",
    mode: recoveryQueue.pending || recoveryQueue.running ? "operational-refresh-with-recovery-queue" : "operational-refresh",
    configuration: {
      appUrlConfigured: Boolean(process.env.QUICKBOOKS_DESKTOP_APP_URL),
      passwordConfigured: Boolean(process.env.QUICKBOOKS_DESKTOP_WEB_CONNECTOR_PASSWORD),
      username: process.env.QUICKBOOKS_DESKTOP_WEB_CONNECTOR_USERNAME || DEFAULT_USERNAME,
      rawCaptureEnabled: process.env.QUICKBOOKS_DESKTOP_CAPTURE_RAW_RESPONSES !== "false" && DEFAULT_CAPTURE_RAW_RESPONSES,
      persistenceConfigured: Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY),
      salesDeliveryDateRange: getSalesDashboardDeliveryDateRange(),
      salesTxnDateRange: getSalesDashboardTxnDateRange(),
      operationalTxnDateRange: getOperationalTxnDateRange(),
      operationalModifiedDateRange: getOperationalModifiedDateRange()
    },
    activeSessions: sessionStore.size,
    requestTypes,
    recoveryQueue,
    recentSessions
  };
}

async function authenticate(soapRequest: string) {
  const username = extractSoapValue(soapRequest, "strUserName").trim();
  const password = extractSoapValue(soapRequest, "strPassword");

  if (!isAuthorized(username, password)) {
    return ["", "nvu"];
  }

  const ticket = randomUUID();
  sessionStore.set(ticket, {
    ticket,
    username,
    createdAt: new Date().toISOString(),
    requestIndex: 0,
    requests: await buildQuickBooksSessionRequests(),
    lastError: "",
    responses: []
  });

  return [ticket, ""];
}

function sendRequestXML(soapRequest: string) {
  const session = getSession(extractSoapValue(soapRequest, "ticket"));
  if (!session) return "";

  const request = session.requests[session.requestIndex];
  if (!request) return "";

  try {
    assertQuickBooksReadOnlyQbxml(request.qbxml);
  } catch (error) {
    session.lastError = error instanceof Error ? error.message : "Blocked unsafe QuickBooks request.";
    return "";
  }

  return request.qbxml;
}

async function receiveResponseXML(soapRequest: string) {
  const session = getSession(extractSoapValue(soapRequest, "ticket"));
  if (!session) return 100;

  const hresult = extractSoapValue(soapRequest, "hresult");
  const message = extractSoapValue(soapRequest, "message");
  if (hresult || message) {
    session.lastError = [hresult, message].filter(Boolean).join(": ");
    const failedJob = session.requests[session.requestIndex]?.recoveryJob;
    if (failedJob) {
      await failQuickBooksRecoveryJob(failedJob, session.lastError);
    }
    rememberSession(session);
    return -1;
  }

  const response = extractSoapValue(soapRequest, "response");
  const request = session.requests[session.requestIndex];
  if (!request) return 100;

  const status = parseQbxmlResponseStatuses(response);
  const responseChecksum = createHash("sha256").update(response).digest("hex");
  const receivedAt = new Date().toISOString();
  const recordCount = countReturnedRecords(request.requestType, response);
  session.responses.push({
    requestType: request.requestType,
    requestId: request.requestId,
    status,
    responseChecksum,
    receivedAt,
    recordCount
  });

  try {
    await writeRawResponse(session, request, response, status, responseChecksum, receivedAt);
  } catch (error) {
    session.lastError = `Raw QuickBooks response capture failed: ${
      error instanceof Error ? error.message : "unknown write error"
    }`;
  }

  try {
    await persistQuickBooksResponse({
      request,
      response,
      status,
      responseChecksum,
      receivedAt
    });
    if (request.recoveryJob) {
      const completion = await completeQuickBooksRecoveryJob(request.recoveryJob, status, recordCount, responseChecksum, receivedAt);
      queueContinuationRequest(session, completion);
    }
  } catch (error) {
    session.lastError = "QuickBooks response persistence failed: " + (error instanceof Error ? error.message : "unknown persistence error");
    if (request.recoveryJob) {
      await failQuickBooksRecoveryJob(request.recoveryJob, session.lastError);
    }
  }

  session.requestIndex += 1;
  rememberSession(session);
  return Math.min(100, Math.round((session.requestIndex / session.requests.length) * 100));
}

function queueContinuationRequest(session: QuickBooksWebConnectorSession, completion: QuickBooksRecoveryCompletion) {
  if (!completion.hasMore || !completion.continuationRequest) return;
  session.requests.splice(session.requestIndex + 1, 0, completion.continuationRequest);
}

function getLastError(soapRequest: string) {
  const session = getSession(extractSoapValue(soapRequest, "ticket"));
  return session?.lastError || "No error recorded by Stem Intelligence.";
}

function closeConnection(soapRequest: string) {
  const ticket = extractSoapValue(soapRequest, "ticket");
  const session = getSession(ticket);
  if (session) rememberSession(session, new Date().toISOString());
  sessionStore.delete(ticket);
  return "Stem Intelligence QuickBooks Desktop discovery session closed.";
}

function connectionError(soapRequest: string) {
  const session = getSession(extractSoapValue(soapRequest, "ticket"));
  const hresult = extractSoapValue(soapRequest, "hresult");
  const message = extractSoapValue(soapRequest, "message");
  if (session) {
    session.lastError = [hresult, message].filter(Boolean).join(": ");
    rememberSession(session);
  }
  return "done";
}

function countReturnedRecords(requestType: string, response: string) {
  if (requestType === "CustomerQueryRq") return countXmlBlocks(response, "CustomerRet");
  if (requestType === "VendorQueryRq") return countXmlBlocks(response, "VendorRet");
  if (requestType === "ItemQueryRq") return countItemRecords(response);
  if (requestType === "ItemInventoryQueryRq") return countXmlBlocks(response, "ItemInventoryRet");
  if (requestType === "SalesRepQueryRq") return countXmlBlocks(response, "SalesRepRet");
  if (requestType === "InvoiceQueryRq") return countXmlBlocks(response, "InvoiceRet");
  if (requestType === "CreditMemoQueryRq") return countXmlBlocks(response, "CreditMemoRet");
  if (requestType === "ReceivePaymentQueryRq") return countXmlBlocks(response, "ReceivePaymentRet");
  if (requestType === "PurchaseOrderQueryRq") return countXmlBlocks(response, "PurchaseOrderRet");
  if (requestType === "TxnDeletedQueryRq") return countXmlBlocks(response, "TxnDeletedRet");
  return null;
}

function countItemRecords(response: string) {
  return ["ItemServiceRet", "ItemInventoryRet", "ItemNonInventoryRet", "ItemOtherChargeRet", "ItemSubtotalRet", "ItemDiscountRet", "ItemPaymentRet", "ItemSalesTaxRet", "ItemGroupRet", "ItemSalesTaxGroupRet", "ItemFixedAssetRet", "ItemInventoryAssemblyRet"].reduce(
    (sum, tagName) => sum + countXmlBlocks(response, tagName),
    0
  );
}

function countXmlBlocks(xml: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  return xml.match(pattern)?.length || 0;
}

function getSalesDashboardDeliveryDateRange() {
  return {
    from: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_DELIVERY_FROM || DEFAULT_SALES_DELIVERY_FROM,
    to: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_DELIVERY_TO || DEFAULT_SALES_DELIVERY_TO
  };
}

function getSalesDashboardTxnDateRange() {
  const deliveryRange = getSalesDashboardDeliveryDateRange();
  return {
    from: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_TXN_FROM || deliveryRange.from,
    to: process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_TXN_TO || addDays(deliveryRange.to, 1)
  };
}

function addDays(value: string, days: number) {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function requestTypeForRecoveryResource(resourceName: string) {
  if (resourceName === "quickbooks_sales_reps") return "SalesRepQueryRq";
  if (resourceName === "quickbooks_customers") return "CustomerQueryRq";
  if (resourceName === "quickbooks_vendors") return "VendorQueryRq";
  if (resourceName === "quickbooks_items") return "ItemQueryRq";
  if (resourceName === "quickbooks_invoices") return "InvoiceQueryRq";
  if (resourceName === "quickbooks_credit_memos") return "CreditMemoQueryRq";
  if (resourceName === "quickbooks_receive_payments") return "ReceivePaymentQueryRq";
  if (resourceName === "quickbooks_purchase_orders") return "PurchaseOrderQueryRq";
  if (resourceName === "quickbooks_txn_deleted") return "TxnDeletedQueryRq";
  return "UnknownRecoveryRq";
}

async function buildQuickBooksSessionRequests() {
  const operationalRequests = buildOperationalRefreshRequests();
  try {
    const recoveryRequests = await buildNextQuickBooksRecoveryRequests({ fallbackToDiscovery: false });
    return mergeSessionRequests(operationalRequests, recoveryRequests);
  } catch {
    return operationalRequests;
  }
}

function buildSalesDashboardRequests() {
  const maxReturned = Number(process.env.QUICKBOOKS_DESKTOP_DISCOVERY_MAX_RETURNED || 1000);
  return buildQuickBooksSalesDashboardDiscoveryRequests({
    maxReturned: Number.isFinite(maxReturned) && maxReturned > 0 ? maxReturned : 1000,
    txnDateRange: getSalesDashboardTxnDateRange()
  });
}

function buildOperationalRefreshRequests() {
  const client = createQuickBooksDesktopReadOnlyClient();
  const maxReturned = getDiscoveryMaxReturned();
  const listMaxReturned = getListRefreshMaxReturned(maxReturned);
  const txnDateWindows = getOperationalTxnDateWindows();
  const modifiedDateRange = getOperationalModifiedDateRange();

  const requests: QuickBooksRecoveryRequest[] = [
    client.buildSalesRepQuery(),
    client.buildCustomerQuery({
      requestId: "operational-customers",
      maxReturned: listMaxReturned,
      activeStatus: "All",
      modifiedDateRange
    }),
    client.buildVendorQuery({
      requestId: "operational-vendors",
      maxReturned: listMaxReturned,
      activeStatus: "All",
      modifiedDateRange
    }),
    client.buildItemQuery({
      requestId: "operational-items",
      maxReturned: listMaxReturned,
      activeStatus: "All",
      modifiedDateRange
    })
  ];

  for (const window of txnDateWindows) {
    const suffix = `${window.from || "open"}:${window.to || "open"}`;
    requests.push(
      client.buildInvoiceQuery({
        requestId: `operational-invoices:${suffix}`,
        maxReturned,
        txnDateRange: window,
        includeLineItems: true,
        includeLinkedTxns: true
      }),
      client.buildCreditMemoQuery({
        requestId: `operational-credit-memos:${suffix}`,
        maxReturned,
        txnDateRange: window,
        includeLineItems: true,
        includeLinkedTxns: true
      }),
      client.buildPurchaseOrderQuery({
        requestId: `operational-purchase-orders:${suffix}`,
        maxReturned,
        txnDateRange: window,
        includeLineItems: true,
        includeLinkedTxns: true
      })
    );
  }

  return requests;
}

function mergeSessionRequests(
  operationalRequests: QuickBooksRecoveryRequest[],
  recoveryRequests: QuickBooksRecoveryRequest[]
) {
  const seenOperationalKeys = new Set(operationalRequests.map(requestDedupeKey));
  const uniqueRecoveryRequests = recoveryRequests.filter((request) => !seenOperationalKeys.has(requestDedupeKey(request)));
  return [...operationalRequests, ...uniqueRecoveryRequests];
}

function requestDedupeKey(request: QuickBooksRecoveryRequest) {
  return `${request.requestType}:${request.requestId || ""}`;
}

function getOperationalTxnDateRange(): QuickBooksDateRange {
  return {
    from:
      process.env.QUICKBOOKS_DESKTOP_OPERATIONAL_TXN_FROM ||
      process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_TXN_FROM ||
      subtractDays(currentDateString(), getOperationalTxnLookbackDays()),
    to:
      process.env.QUICKBOOKS_DESKTOP_OPERATIONAL_TXN_TO ||
      process.env.QUICKBOOKS_DESKTOP_SALES_DASHBOARD_TXN_TO ||
      currentDateString()
  };
}

function getOperationalModifiedDateRange(): QuickBooksDateRange {
  return {
    from:
      process.env.QUICKBOOKS_DESKTOP_OPERATIONAL_MODIFIED_FROM ||
      subtractDays(currentDateString(), getOperationalListModifiedLookbackDays()),
    to: process.env.QUICKBOOKS_DESKTOP_OPERATIONAL_MODIFIED_TO || currentDateString()
  };
}

function getOperationalTxnDateWindows() {
  return splitDateRangeIntoWindows(getOperationalTxnDateRange(), getOperationalTxnWindowDays());
}

function getDiscoveryMaxReturned() {
  const maxReturned = Number(process.env.QUICKBOOKS_DESKTOP_DISCOVERY_MAX_RETURNED || 1000);
  return Number.isFinite(maxReturned) && maxReturned > 0 ? Math.trunc(maxReturned) : 1000;
}

function getListRefreshMaxReturned(defaultValue: number) {
  const maxReturned = Number(process.env.QUICKBOOKS_DESKTOP_LIST_REFRESH_MAX_RETURNED || defaultValue);
  return Number.isFinite(maxReturned) && maxReturned > 0 ? Math.trunc(maxReturned) : defaultValue;
}

function getOperationalTxnLookbackDays() {
  const days = Number(process.env.QUICKBOOKS_DESKTOP_OPERATIONAL_TXN_LOOKBACK_DAYS || DEFAULT_OPERATIONAL_TXN_LOOKBACK_DAYS);
  return Number.isFinite(days) && days > 0 ? Math.trunc(days) : DEFAULT_OPERATIONAL_TXN_LOOKBACK_DAYS;
}

function getOperationalTxnWindowDays() {
  const days = Number(process.env.QUICKBOOKS_DESKTOP_OPERATIONAL_TXN_WINDOW_DAYS || DEFAULT_OPERATIONAL_TXN_WINDOW_DAYS);
  return Number.isFinite(days) && days > 0 ? Math.trunc(days) : DEFAULT_OPERATIONAL_TXN_WINDOW_DAYS;
}

function getOperationalListModifiedLookbackDays() {
  const days = Number(
    process.env.QUICKBOOKS_DESKTOP_OPERATIONAL_LIST_MODIFIED_LOOKBACK_DAYS ||
      DEFAULT_OPERATIONAL_LIST_MODIFIED_LOOKBACK_DAYS
  );
  return Number.isFinite(days) && days > 0 ? Math.trunc(days) : DEFAULT_OPERATIONAL_LIST_MODIFIED_LOOKBACK_DAYS;
}

function subtractDays(value: string, days: number) {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function addDateDays(value: string, days: number) {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function splitDateRangeIntoWindows(range: QuickBooksDateRange, windowDays: number) {
  if (!range.from || !range.to) return [range];
  const windows: QuickBooksDateRange[] = [];
  let from = range.from;
  while (from <= range.to) {
    const to = minDateString(addDateDays(from, windowDays - 1), range.to);
    windows.push({ from, to });
    from = addDateDays(to, 1);
  }
  return windows;
}

function minDateString(a: string, b: string) {
  return a <= b ? a : b;
}

function currentDateString() {
  return new Date().toISOString().slice(0, 10);
}

function isAuthorized(username: string, password: string) {
  const expectedUsername = process.env.QUICKBOOKS_DESKTOP_WEB_CONNECTOR_USERNAME || DEFAULT_USERNAME;
  const expectedPassword = process.env.QUICKBOOKS_DESKTOP_WEB_CONNECTOR_PASSWORD || "";

  return Boolean(expectedPassword) && username === expectedUsername && password === expectedPassword;
}

function getSession(ticket: string) {
  return ticket ? sessionStore.get(ticket) || null : null;
}

function rememberSession(session: QuickBooksWebConnectorSession, closedAt?: string) {
  const summary: QuickBooksWebConnectorSessionSummary = {
    ticketSuffix: session.ticket.slice(-8),
    username: session.username,
    createdAt: session.createdAt,
    ...(closedAt ? { closedAt } : {}),
    requestCount: session.requests.length,
    completedRequestCount: session.responses.length,
    lastError: session.lastError || null,
    responses: session.responses.map((response) => ({
      requestType: response.requestType,
      requestId: response.requestId,
      receivedAt: response.receivedAt,
      responseChecksum: response.responseChecksum,
      recordCount: response.recordCount,
      status: response.status
    }))
  };

  const existingIndex = recentSessions.findIndex((recent) => recent.ticketSuffix === summary.ticketSuffix);
  if (existingIndex >= 0) {
    recentSessions.splice(existingIndex, 1);
  }
  recentSessions.unshift(summary);
  recentSessions.splice(RECENT_SESSION_LIMIT);
}

async function writeRawResponse(
  session: QuickBooksWebConnectorSession,
  request: QuickBooksRecoveryRequest,
  response: string,
  status: QuickBooksQbxmlResponseStatus[],
  responseChecksum: string,
  receivedAt: string
) {
  if (process.env.QUICKBOOKS_DESKTOP_CAPTURE_RAW_RESPONSES === "false" || !DEFAULT_CAPTURE_RAW_RESPONSES) return;

  const root = path.resolve(process.cwd(), "../..");
  const safeTicket = session.ticket.replace(/[^A-Za-z0-9_-]/g, "_");
  const outputDir = path.join(root, "tmp", "quickbooks-desktop", safeTicket);
  const prefix = `${String(session.requestIndex + 1).padStart(2, "0")}-${request.requestType}`;
  const summary = {
    ticket: session.ticket,
    username: session.username,
    createdAt: session.createdAt,
    receivedAt,
    requestType: request.requestType,
    requestId: request.requestId || null,
    qbxmlVersion: request.qbxmlVersion,
    responseChecksum,
    status
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, `${prefix}.request.xml`), request.qbxml, "utf8");
  await writeFile(path.join(outputDir, `${prefix}.response.xml`), response, "utf8");
  await writeFile(path.join(outputDir, `${prefix}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function extractSoapMethod(soapRequest: string): QuickBooksWebConnectorMethod | null {
  for (const method of SUPPORTED_METHODS) {
    const pattern = new RegExp(`<(?:[A-Za-z0-9_]+:)?${method}\\b`, "i");
    if (pattern.test(soapRequest)) return method;
  }
  return null;
}

function extractSoapValue(soapRequest: string, name: string) {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>`, "i");
  const match = pattern.exec(soapRequest);
  return match ? unescapeXmlText(match[1]) : "";
}

function soapOk(method: QuickBooksWebConnectorMethod, resultXml: string): QuickBooksWebConnectorResult {
  return {
    status: 200,
    contentType: "text/xml; charset=utf-8",
    body: [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<soap:Envelope xmlns:soap="${SOAP_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">`,
      "  <soap:Body>",
      `    <${method}Response xmlns="${QBWC_NS}">`,
      indentXml(resultXml, 6),
      `    </${method}Response>`,
      "  </soap:Body>",
      "</soap:Envelope>"
    ].join("\n")
  };
}

function soapFault(code: "Client" | "Server", message: string): QuickBooksWebConnectorResult {
  return {
    status: 500,
    contentType: "text/xml; charset=utf-8",
    body: [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<soap:Envelope xmlns:soap="${SOAP_NS}">`,
      "  <soap:Body>",
      "    <soap:Fault>",
      `      <faultcode>soap:${code}</faultcode>`,
      `      <faultstring>${escapeXmlText(message)}</faultstring>`,
      "    </soap:Fault>",
      "  </soap:Body>",
      "</soap:Envelope>"
    ].join("\n")
  };
}

function scalarResult(name: string, value: string | number) {
  return `<${name}>${escapeXmlText(String(value))}</${name}>`;
}

function arrayResult(name: string, values: string[]) {
  return [`<${name}>`, ...values.map((value) => `  <string>${escapeXmlText(value)}</string>`), `</${name}>`].join("\n");
}

function indentXml(value: string, spaces: number) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXmlText(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
