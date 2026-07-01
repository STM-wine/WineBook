import { NextResponse } from "next/server";
import {
  buildQuickBooksWebConnectorStatus,
  handleQuickBooksWebConnectorSoapRequest
} from "@/lib/integrations/quickbooks-web-connector";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildQuickBooksWebConnectorStatus());
}

export async function POST(request: Request) {
  const soapRequest = await request.text();
  const result = await handleQuickBooksWebConnectorSoapRequest(soapRequest);

  return new NextResponse(result.body, {
    status: result.status,
    headers: {
      "Content-Type": result.contentType
    }
  });
}
