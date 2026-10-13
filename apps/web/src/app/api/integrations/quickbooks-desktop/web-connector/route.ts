import { NextResponse } from "next/server";
import {
  buildQuickBooksWebConnectorStatus,
  handleQuickBooksWebConnectorSoapRequest
} from "@/lib/integrations/quickbooks-web-connector";

export const runtime = "nodejs";

type QuickBooksHttpTrace = {
  startedAt: string;
  method: string | null;
  contentLength: number | null;
  cloudflareRay: string | null;
  completedAt?: string;
  durationMs?: number;
  responseStatus?: number;
  errorName?: string;
};

type QuickBooksHttpTraceGlobal = typeof globalThis & {
  __stemQuickBooksHttpTraces?: QuickBooksHttpTrace[];
};

const recentHttpRequests = ((globalThis as QuickBooksHttpTraceGlobal).__stemQuickBooksHttpTraces ||= []);
const RECENT_HTTP_REQUEST_LIMIT = 100;

export async function GET() {
  return NextResponse.json({
    ...(await buildQuickBooksWebConnectorStatus()),
    recentHttpRequests
  });
}

export async function POST(request: Request) {
  const started = Date.now();
  const headerLength = Number(request.headers.get("content-length"));
  const trace: QuickBooksHttpTrace = {
    startedAt: new Date(started).toISOString(),
    method: null,
    contentLength: Number.isFinite(headerLength) && headerLength > 0 ? headerLength : null,
    cloudflareRay: request.headers.get("cf-ray")
  };
  recentHttpRequests.unshift(trace);
  recentHttpRequests.splice(RECENT_HTTP_REQUEST_LIMIT);

  try {
    const soapRequest = await request.text();
    trace.method =
      soapRequest.match(
        /<(?:[A-Za-z0-9_]+:)?(clientVersion|serverVersion|authenticate|sendRequestXML|receiveResponseXML|getLastError|closeConnection|connectionError)\b/i
      )?.[1] || null;
    const result = await handleQuickBooksWebConnectorSoapRequest(soapRequest);
    trace.responseStatus = result.status;

    return new NextResponse(result.body, {
      status: result.status,
      headers: {
        "Content-Type": result.contentType
      }
    });
  } catch (error) {
    trace.errorName = error instanceof Error ? error.name : "UnknownError";
    throw error;
  } finally {
    trace.completedAt = new Date().toISOString();
    trace.durationMs = Date.now() - started;
    console.info("QuickBooks Web Connector HTTP request", JSON.stringify(trace));
  }
}
