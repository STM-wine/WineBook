import { NextResponse } from "next/server";
import { approvedSupplierOffersCsv, approvedSupplierOffersXlsxBuffer, type ApprovedSupplierOfferExportRow } from "@/lib/supplier-offer-compiler/export";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function contentDisposition(filename: string) {
  return `attachment; filename="${filename.replace(/[^A-Za-z0-9_. -]/g, "_")}"`;
}

function timestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const format = (new URL(request.url).searchParams.get("format") || "csv").toLowerCase();
  if (format !== "csv" && format !== "xlsx") {
    return NextResponse.json({ error: "Export format must be csv or xlsx." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("approved_supplier_offers")
    .select("supplier_name,producer,wine_name,vintage,appellation,region,country,bottle_size,pack_size,fob,quantity,arrival_date,valid_until,notes")
    .in("approval_status", ["approved", "published"])
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data || []) as ApprovedSupplierOfferExportRow[];
  if (format === "xlsx") {
    const body = await approvedSupplierOffersXlsxBuffer(rows);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition(`supplier-offers-${timestamp()}.xlsx`)
      }
    });
  }

  return new NextResponse(approvedSupplierOffersCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(`supplier-offers-${timestamp()}.csv`)
    }
  });
}
