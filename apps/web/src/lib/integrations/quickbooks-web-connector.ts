import "server-only";

import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  assertQuickBooksReadOnlyQbxml,
  buildQuickBooksSalesDashboardDiscoveryRequests,
  parseQbxmlResponseStatuses,
  type QuickBooksDesktopQbxmlRequest,
  type QuickBooksQbxmlResponseStatus
} from "@/lib/integrations/quickbooks-desktop";

const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";
const QBWC_NS = "http://developer.intuit.com/";
const DEFAULT_USERNAME = "stem-qbwc";
const DEFAULT_CAPTURE_RAW_RESPONSES = true;

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
  requests: QuickBooksDesktopQbxmlRequest[];
  lastError: string;
  responses: Array<{
    requestType: string;
    requestId?: string;
    status: QuickBooksQbxmlResponseStatus[];
    responseChecksum: string;
    receivedAt: string;
  }>;
};

type QuickBooksWebConnectorGlobal = typeof globalThis & {
  __stemQuickBooksWebConnectorSessions?: Map<string, QuickBooksWebConnectorSession>;
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
        return soapOk(method, arrayResult("authenticateResult", authenticate(soapRequest)));
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

export function buildQuickBooksWebConnectorStatus() {
  return {
    service: "Stem Intelligence QuickBooks Desktop Web Connector",
    mode: "read-only-sales-dashboard-discovery",
    activeSessions: sessionStore.size,
    requestTypes: buildSalesDashboardRequests().map((request) => request.requestType)
  };
}

function authenticate(soapRequest: string) {
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
    requests: buildSalesDashboardRequests(),
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
    return -1;
  }

  const response = extractSoapValue(soapRequest, "response");
  const request = session.requests[session.requestIndex];
  if (!request) return 100;

  const status = parseQbxmlResponseStatuses(response);
  const responseChecksum = createHash("sha256").update(response).digest("hex");
  const receivedAt = new Date().toISOString();
  session.responses.push({
    requestType: request.requestType,
    requestId: request.requestId,
    status,
    responseChecksum,
    receivedAt
  });

  try {
    await writeRawResponse(session, request, response, status, responseChecksum, receivedAt);
  } catch (error) {
    session.lastError = `Raw QuickBooks response capture failed: ${
      error instanceof Error ? error.message : "unknown write error"
    }`;
  }

  session.requestIndex += 1;
  return Math.min(100, Math.round((session.requestIndex / session.requests.length) * 100));
}

function getLastError(soapRequest: string) {
  const session = getSession(extractSoapValue(soapRequest, "ticket"));
  return session?.lastError || "No error recorded by Stem Intelligence.";
}

function closeConnection(soapRequest: string) {
  const ticket = extractSoapValue(soapRequest, "ticket");
  sessionStore.delete(ticket);
  return "Stem Intelligence QuickBooks Desktop discovery session closed.";
}

function connectionError(soapRequest: string) {
  const session = getSession(extractSoapValue(soapRequest, "ticket"));
  const hresult = extractSoapValue(soapRequest, "hresult");
  const message = extractSoapValue(soapRequest, "message");
  if (session) {
    session.lastError = [hresult, message].filter(Boolean).join(": ");
  }
  return "done";
}

function buildSalesDashboardRequests() {
  const maxReturned = Number(process.env.QUICKBOOKS_DESKTOP_DISCOVERY_MAX_RETURNED || 10);
  return buildQuickBooksSalesDashboardDiscoveryRequests({
    maxReturned: Number.isFinite(maxReturned) && maxReturned > 0 ? maxReturned : 10
  });
}

function isAuthorized(username: string, password: string) {
  const expectedUsername = process.env.QUICKBOOKS_DESKTOP_WEB_CONNECTOR_USERNAME || DEFAULT_USERNAME;
  const expectedPassword = process.env.QUICKBOOKS_DESKTOP_WEB_CONNECTOR_PASSWORD || "";

  return Boolean(expectedPassword) && username === expectedUsername && password === expectedPassword;
}

function getSession(ticket: string) {
  return ticket ? sessionStore.get(ticket) || null : null;
}

async function writeRawResponse(
  session: QuickBooksWebConnectorSession,
  request: QuickBooksDesktopQbxmlRequest,
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
