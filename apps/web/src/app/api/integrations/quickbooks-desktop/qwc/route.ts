import { NextResponse } from "next/server";
import { buildQuickBooksDesktopQwcFile, QuickBooksDesktopClientError } from "@/lib/integrations/quickbooks-desktop";

export const runtime = "nodejs";

const DEFAULT_OWNER_ID = "{4B9F0B73-23BB-4F8C-9F0D-63AF5EB34C92}";
const DEFAULT_FILE_ID = "{7F1F2BA2-38B9-4D49-A45F-F8AF0B4D7239}";
const DEFAULT_USERNAME = "stem-qbwc";

export async function GET(request: Request) {
  const passwordConfigured = Boolean(process.env.QUICKBOOKS_DESKTOP_WEB_CONNECTOR_PASSWORD);

  if (!passwordConfigured) {
    return NextResponse.json(
      { error: "Set QUICKBOOKS_DESKTOP_WEB_CONNECTOR_PASSWORD before downloading the QuickBooks Web Connector file." },
      { status: 500 }
    );
  }

  try {
    const appUrl = resolveAppUrl(request);
    const qwc = buildQuickBooksDesktopQwcFile({
      appName: process.env.QUICKBOOKS_DESKTOP_APP_NAME || "Stem Intelligence",
      appDescription:
        process.env.QUICKBOOKS_DESKTOP_APP_DESCRIPTION ||
        "Stem Intelligence read-only QuickBooks Desktop sales dashboard discovery",
      appUrl,
      appSupportUrl: process.env.QUICKBOOKS_DESKTOP_APP_SUPPORT_URL || appUrl,
      username: process.env.QUICKBOOKS_DESKTOP_WEB_CONNECTOR_USERNAME || DEFAULT_USERNAME,
      ownerId: process.env.QUICKBOOKS_DESKTOP_OWNER_ID || DEFAULT_OWNER_ID,
      fileId: process.env.QUICKBOOKS_DESKTOP_FILE_ID || DEFAULT_FILE_ID,
      qbType: "QBFS",
      style: "Document",
      isReadOnly: true
    });

    return new NextResponse(qwc, {
      status: 200,
      headers: {
        "Content-Type": "application/x-qwc+xml; charset=utf-8",
        "Content-Disposition": 'attachment; filename="stem-intelligence.qwc"'
      }
    });
  } catch (error) {
    const message = error instanceof QuickBooksDesktopClientError ? error.message : "Could not build QuickBooks Web Connector file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function resolveAppUrl(request: Request) {
  if (process.env.QUICKBOOKS_DESKTOP_APP_URL) return process.env.QUICKBOOKS_DESKTOP_APP_URL;

  const url = new URL(request.url);
  const inferredUrl = `${url.origin}/api/integrations/quickbooks-desktop/web-connector`;
  if (inferredUrl.startsWith("https://")) return inferredUrl;

  throw new QuickBooksDesktopClientError("Set QUICKBOOKS_DESKTOP_APP_URL to the hosted HTTPS Web Connector endpoint.");
}
