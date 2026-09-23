import { NextResponse } from "next/server";

// Fail closed for older application versions. Audited exports must use the
// versioned POST endpoint so the exact draft revision can be recorded.
export async function GET() {
  return NextResponse.json(
    { error: "This export link is obsolete. Refresh WineBook and export again from PO Drafts." },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
