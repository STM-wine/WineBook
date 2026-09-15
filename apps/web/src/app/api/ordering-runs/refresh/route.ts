import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createSourceBackedOrderingRun } from "@/lib/source-backed-ordering-runs";

export async function POST(request: Request) {
  const expected = process.env.ORDERING_REFRESH_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || authorization !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await createSourceBackedOrderingRun(createServiceRoleClient(), null);
    return NextResponse.json({
      ok: true,
      reportRunId: result.run.id,
      reportDate: result.run.report_date,
      rowCount: result.rowCount,
      reused: result.reused,
      diagnostics: result.diagnostics
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not refresh ordering data." },
      { status: 500 }
    );
  }
}
