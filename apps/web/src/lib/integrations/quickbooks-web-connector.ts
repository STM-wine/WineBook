import "server-only";

import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { markQuickBooksVerifiedMissing, persistQuickBooksResponse } from "@/lib/integrations/quickbooks-response-persistence";
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
  buildQuickBooksOperationalRefreshRequests,
  buildQuickBooksSalesDashboardDiscoveryRequests,
  createQuickBooksDesktopReadOnlyClient,
  parseQbxmlResponseStatuses,
  type QuickBooksDateRange,
  type QuickBooksQbxmlResponseStatus
} from "@/lib/integrations/quickbooks-desktop";
import { nextQuickBooksPage } from "@/lib/integrations/quickbooks-pagination";
import { createServiceRoleClient } from "@/lib/supabase/server";

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
  sourceSyncRunId: string | null;
  lastError: string;
  responses: Array<{
    requestType: string;
    requestId?: string;
    status: QuickBooksQbxmlResponseStatus[];
    responseChecksum: string;
    receivedAt: string;
    recordCount: number | null;
  }>;
  snapshotSeenIds: Map<string, Set<string>>;
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
        return soapOk(method, scalarResult("closeConnectionResult", await closeConnection(soapRequest)));
      case "connectionError":
        return soapOk(method, scalarResult("connectionErrorResult", await connectionError(soapRequest)));
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
    deployment: {
      gitCommit: process.env.RENDER_GIT_COMMIT || null,
      syncProtocol: "complete-pagination-snapshots-v1"
    },
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
  const createdAt = new Date().toISOString();
  const requests = await buildQuickBooksSessionRequests();
  const sourceSyncRunId = await startQuickBooksSyncRun(username, createdAt, requests.length);
  sessionStore.set(ticket, {
    ticket,
    username,
    createdAt,
    requestIndex: 0,
    requests,
    sourceSyncRunId,
    lastError: "",
    responses: [],
    snapshotSeenIds: new Map()
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
    await finishQuickBooksSyncRun(session, "failed", session.lastError);
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
    const errorStatus = status.find(isQuickBooksErrorStatus);
    if (errorStatus) {
      throw new Error(errorStatus.statusMessage || `QuickBooks ${request.requestType} returned an error.`);
    }
    const rawResponseId = await persistQuickBooksResponse({
      request,
      response,
      status,
      responseChecksum,
      receivedAt,
      sourceSyncRunId: session.sourceSyncRunId
    });
    if (request.verification) {
      if (status[0]?.statusCode === 1 && recordCount === 0 && rawResponseId) {
        await markQuickBooksVerifiedMissing(request.verification.txnType, request.verification.txnId, rawResponseId);
      } else if (recordCount !== 1) {
        throw new Error(`QuickBooks did not give a conclusive result for ${request.verification.txnType} ${request.verification.txnId}.`);
      }
    }
    if (request.snapshotWindow) recordSnapshotIds(session, request, response);
    if (request.recoveryJob) {
      const completion = await completeQuickBooksRecoveryJob(request.recoveryJob, status, recordCount, responseChecksum, receivedAt);
      queueContinuationRequest(session, completion);
    } else {
      const continuationRequest = nextQuickBooksPage(request, status, recordCount);
      if (continuationRequest) {
        session.requests.splice(session.requestIndex + 1, 0, {
          ...continuationRequest,
          snapshotWindow: request.snapshotWindow
        });
      } else {
        if (request.snapshotWindow) await queueSnapshotVerifications(session, request);
        if (request.requestId === "operational-deletions") {
          await completeOperationalDeletionCheckpoint(session, receivedAt);
        }
      }
    }
    await recordQuickBooksSyncActivity(session, receivedAt);
  } catch (error) {
    session.lastError = "QuickBooks response processing failed: " + (error instanceof Error ? error.message : "unknown processing error");
    if (request.recoveryJob) {
      await failQuickBooksRecoveryJob(request.recoveryJob, session.lastError);
    }
    await finishQuickBooksSyncRun(session, "failed", session.lastError);
    rememberSession(session);
    return -1;
  }

  session.requestIndex += 1;
  rememberSession(session);
  return Math.min(100, Math.round((session.requestIndex / session.requests.length) * 100));
}

function isQuickBooksErrorStatus(status: QuickBooksQbxmlResponseStatus) {
  return status.statusSeverity === "Error" || Boolean(status.statusCode && status.statusCode >= 3000);
}

function queueContinuationRequest(session: QuickBooksWebConnectorSession, completion: QuickBooksRecoveryCompletion) {
  if (!completion.hasMore || !completion.continuationRequest) return;
  session.requests.splice(session.requestIndex + 1, 0, completion.continuationRequest);
}

function getLastError(soapRequest: string) {
  const session = getSession(extractSoapValue(soapRequest, "ticket"));
  return session?.lastError || "No error recorded by Stem Intelligence.";
}

async function closeConnection(soapRequest: string) {
  const ticket = extractSoapValue(soapRequest, "ticket");
  const session = getSession(ticket);
  if (session) {
    const complete = session.requestIndex >= session.requests.length && !session.lastError;
    await finishQuickBooksSyncRun(
      session,
      complete ? "completed" : "failed",
      complete ? null : session.lastError || "QuickBooks Web Connector session closed before every request completed."
    );
    rememberSession(session, new Date().toISOString());
  }
  sessionStore.delete(ticket);
  return "Stem Intelligence QuickBooks Desktop discovery session closed.";
}

async function connectionError(soapRequest: string) {
  const session = getSession(extractSoapValue(soapRequest, "ticket"));
  const hresult = extractSoapValue(soapRequest, "hresult");
  const message = extractSoapValue(soapRequest, "message");
  if (session) {
    session.lastError = [hresult, message].filter(Boolean).join(": ");
    await finishQuickBooksSyncRun(session, "failed", session.lastError || "QuickBooks connection error.");
    rememberSession(session);
  }
  return "done";
}

async function startQuickBooksSyncRun(username: string, startedAt: string, requestCount: number) {
  const supabase = createServiceRoleClient();
  const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { error: staleError } = await supabase
    .from("source_sync_runs")
    .update({
      status: "failed",
      completed_at: startedAt,
      error_message: "QuickBooks Web Connector session did not close within two hours."
    })
    .eq("source_system", "quickbooks_desktop")
    .eq("worker_name", "quickbooks_web_connector")
    .eq("status", "running")
    .lt("started_at", staleBefore);
  if (staleError) throw new Error(staleError.message);

  const { data, error } = await supabase
    .from("source_sync_runs")
    .insert({
      source_system: "quickbooks_desktop",
      sync_type: "daily_refresh",
      status: "running",
      started_at: startedAt,
      worker_name: "quickbooks_web_connector",
      parameters: { username, request_count: requestCount },
      diagnostics: {
        request_count: requestCount,
        completed_request_count: 0,
        last_activity_at: startedAt
      }
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(error?.message || "Could not start the QuickBooks sync run.");
  return data.id;
}

async function finishQuickBooksSyncRun(
  session: QuickBooksWebConnectorSession,
  status: "completed" | "failed",
  errorMessage: string | null
) {
  if (!session.sourceSyncRunId) return;
  const { error } = await createServiceRoleClient()
    .from("source_sync_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      diagnostics: {
        request_count: session.requests.length,
        completed_request_count: session.responses.length,
        complete: status === "completed",
        resources: summarizeSessionResources(session.responses)
      }
    })
    .eq("id", session.sourceSyncRunId)
    .eq("status", "running");
  if (error) throw new Error(error.message);
}

async function recordQuickBooksSyncActivity(session: QuickBooksWebConnectorSession, receivedAt: string) {
  if (!session.sourceSyncRunId) return;
  const { error } = await createServiceRoleClient()
    .from("source_sync_runs")
    .update({
      diagnostics: {
        request_count: session.requests.length,
        completed_request_count: session.responses.length,
        last_activity_at: receivedAt
      }
    })
    .eq("id", session.sourceSyncRunId)
    .eq("status", "running");
  if (error) throw new Error(error.message);
}

function summarizeSessionResources(responses: QuickBooksWebConnectorSession["responses"]) {
  const resources: Record<string, { pages: number; rows: number }> = {};
  for (const response of responses) {
    const resource = response.requestId || response.requestType;
    const current = resources[resource] || { pages: 0, rows: 0 };
    current.pages += 1;
    current.rows += response.recordCount || 0;
    resources[resource] = current;
  }
  return resources;
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
  const operationalRequests = buildOperationalRefreshRequests(await getOperationalDeletionDateRange());
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

function buildOperationalRefreshRequests(deletedDateRange?: QuickBooksDateRange) {
  const maxReturned = getDiscoveryMaxReturned();
  const listMaxReturned = getListRefreshMaxReturned(maxReturned);
  const txnDateWindows = getOperationalTxnDateWindows();
  const modifiedDateRange = getOperationalModifiedDateRange();
  return buildQuickBooksOperationalRefreshRequests({
    maxReturned,
    listMaxReturned,
    txnDateWindows,
    modifiedDateRange,
    deletedDateRange: deletedDateRange || { from: subtractDays(currentDateString(), 90), to: currentDateString() }
  }).map((request): QuickBooksRecoveryRequest => {
    const match = /^operational-(invoices|credit-memos):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(request.requestId || "");
    return match ? { ...request, snapshotWindow: { from: match[2], to: match[3] } } : request;
  });
}

async function getOperationalDeletionDateRange(): Promise<QuickBooksDateRange> {
  const { data, error } = await createServiceRoleClient()
    .from("source_sync_checkpoints")
    .select("last_synced_at")
    .eq("source_system", "quickbooks_desktop")
    .eq("resource_name", "quickbooks_txn_deleted")
    .eq("checkpoint_key", "operational")
    .maybeSingle<{ last_synced_at: string | null }>();
  if (error) throw new Error(`Could not read QuickBooks deletion watermark: ${error.message}`);
  const today = currentDateString();
  const lastCompleted = data?.last_synced_at?.slice(0, 10);
  return { from: lastCompleted ? subtractDays(lastCompleted, 3) : subtractDays(today, 90), to: today };
}

async function completeOperationalDeletionCheckpoint(session: QuickBooksWebConnectorSession, receivedAt: string) {
  const { error } = await createServiceRoleClient().from("source_sync_checkpoints").upsert({
    source_system: "quickbooks_desktop",
    resource_name: "quickbooks_txn_deleted",
    checkpoint_key: "operational",
    status: "completed",
    last_synced_at: receivedAt,
    last_source_sync_run_id: session.sourceSyncRunId,
    diagnostics: { mode: "operational", completedAt: receivedAt },
    updated_at: receivedAt
  }, { onConflict: "source_system,resource_name,checkpoint_key" });
  if (error) throw new Error(`Could not advance QuickBooks deletion watermark: ${error.message}`);
}

function recordSnapshotIds(session: QuickBooksWebConnectorSession, request: QuickBooksRecoveryRequest, response: string) {
  const tag = request.requestType === "InvoiceQueryRq" ? "InvoiceRet" : "CreditMemoRet";
  const ids = [...response.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((match) => {
    const id = /<TxnID>([^<]+)<\/TxnID>/i.exec(match[1])?.[1]?.trim();
    if (!id) throw new Error(`QuickBooks ${tag} omitted TxnID during snapshot reconciliation.`);
    return id;
  });
  if (ids.length !== countReturnedRecords(request.requestType, response)) {
    throw new Error(`QuickBooks ${tag} snapshot IDs did not match its record count.`);
  }
  const key = request.requestId || "";
  const seen = session.snapshotSeenIds.get(key) || new Set<string>();
  ids.forEach((id) => seen.add(id));
  session.snapshotSeenIds.set(key, seen);
}

async function queueSnapshotVerifications(session: QuickBooksWebConnectorSession, request: QuickBooksRecoveryRequest) {
  const window = request.snapshotWindow;
  if (!window?.from || !window.to) throw new Error("QuickBooks snapshot window is incomplete.");
  const table = request.requestType === "InvoiceQueryRq" ? "quickbooks_invoices" : "quickbooks_credit_memos";
  const txnType = request.requestType === "InvoiceQueryRq" ? "Invoice" : "CreditMemo";
  const seen = session.snapshotSeenIds.get(request.requestId || "") || new Set<string>();
  session.snapshotSeenIds.delete(request.requestId || "");
  const missing: string[] = [];
  const supabase = createServiceRoleClient();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select("txn_id")
      .is("deleted_at", null).gte("txn_date", window.from).lte("txn_date", window.to)
      .order("txn_id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`Could not reconcile ${table}: ${error.message}`);
    for (const row of data || []) if (!seen.has(row.txn_id)) missing.push(row.txn_id);
    if ((data || []).length < 1000) break;
  }
  if (missing.length > 50) {
    throw new Error(`QuickBooks ${txnType} snapshot ${window.from} to ${window.to} has ${missing.length} missing mirror IDs; manual review required before verification.`);
  }
  const client = createQuickBooksDesktopReadOnlyClient();
  const requests: QuickBooksRecoveryRequest[] = missing.map((txnId) => ({
    ...(txnType === "Invoice"
      ? client.buildInvoiceQuery({ requestId: `verify-missing:Invoice:${txnId}`, txnIds: [txnId], maxReturned: 2, iterator: { mode: "Start" } })
      : client.buildCreditMemoQuery({ requestId: `verify-missing:CreditMemo:${txnId}`, txnIds: [txnId], maxReturned: 2, iterator: { mode: "Start" } })),
    verification: { txnType, txnId }
  }));
  session.requests.splice(session.requestIndex + 1, 0, ...requests);
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
    from: quickBooksStartOfDay(
      process.env.QUICKBOOKS_DESKTOP_OPERATIONAL_MODIFIED_FROM ||
        subtractDays(currentDateString(), getOperationalListModifiedLookbackDays())
    ),
    to: quickBooksEndOfDay(process.env.QUICKBOOKS_DESKTOP_OPERATIONAL_MODIFIED_TO || currentDateString())
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

function quickBooksStartOfDay(value: string) {
  return value.includes("T") ? value : `${value}T00:00:00`;
}

function quickBooksEndOfDay(value: string) {
  return value.includes("T") ? value : `${value}T23:59:59`;
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
