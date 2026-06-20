import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  productRowToCandidate,
  recommendationRowToCandidate,
  searchProductIdentityCandidates,
  supplierCatalogRowToCandidate,
  vinosmithWineRowToCandidate,
  type ProductIdentityCandidate
} from "@/lib/product-identity-search";

const MAX_SOURCE_ROWS = 5000;
const RECENT_REPORT_RUN_COUNT = 8;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const supplierId = url.searchParams.get("supplierId") || null;
  const supplierName = url.searchParams.get("supplierName") || null;

  if (query.length < 3) {
    return NextResponse.json({ matches: [] });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("app_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "Account is not enabled." }, { status: 403 });
  }

  const [supplierResult, catalogResult, productsResult, reportRunsResult, vinosmithResult] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id,name,trucking_cost_per_bottle")
      .limit(MAX_SOURCE_ROWS),
    supabase
      .from("supplier_catalog_wines")
      .select(`
        id,
        supplier_id,
        supplier_name,
        producer,
        wine_name,
        vintage,
        pack_size,
        bottle_size,
        fob_bottle,
        fob_case,
        laid_in_per_bottle,
        frontline_bottle_price,
        best_price,
        gross_profit_margin,
        display_name,
        planning_sku,
        planning_sku_without_vintage,
        quickbooks_item_number,
        quickbooks_item_name,
        product_lifecycle_status,
        system_tags,
        updated_at
      `)
      .neq("product_lifecycle_status", "inactive")
      .limit(MAX_SOURCE_ROWS),
    supabase
      .from("products")
      .select("id,planning_sku,product_code,name,vintage,pack_size,is_btg,is_core,supplier_id,current_fob,active,updated_at")
      .eq("active", true)
      .limit(MAX_SOURCE_ROWS),
    supabase
      .from("report_runs")
      .select("id")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(RECENT_REPORT_RUN_COUNT),
    supabase
      .from("vinosmith_wines")
      .select(`
        wine_id,
        code,
        name,
        vintage,
        supplier_id,
        importer_name,
        producer_name,
        unit_set,
        bottle_size,
        bottle_size_label,
        fob_price,
        active,
        orderable,
        core,
        last_seen_at
      `)
      .or("active.is.null,active.eq.true")
      .limit(MAX_SOURCE_ROWS)
  ]);

  const sourceError = supplierResult.error || catalogResult.error || productsResult.error || reportRunsResult.error || vinosmithResult.error;
  if (sourceError) {
    return NextResponse.json({ error: sourceError.message }, { status: 500 });
  }

  const reportRunIds = (reportRunsResult.data || []).map((run) => run.id).filter(Boolean);
  const recommendationResult = reportRunIds.length
    ? await supabase
        .from("reorder_recommendations")
        .select(`
          id,
          report_run_id,
          planning_sku,
          product_name,
          product_code,
          supplier_name,
          is_btg,
          is_core,
          fob,
          pack_size,
          trucking_cost_per_bottle,
          created_at
        `)
        .in("report_run_id", reportRunIds)
        .limit(MAX_SOURCE_ROWS)
    : { data: [], error: null };

  if (recommendationResult.error) {
    return NextResponse.json({ error: recommendationResult.error.message }, { status: 500 });
  }

  const supplierById = new Map(
    (supplierResult.data || []).map((supplier) => [
      String(supplier.id),
      {
        name: String(supplier.name || "Manual Supplier"),
        truckingCostPerBottle: Number(supplier.trucking_cost_per_bottle || 0)
      }
    ])
  );

  const candidates: ProductIdentityCandidate[] = [
    ...(catalogResult.data || []).map((row) => supplierCatalogRowToCandidate(row)),
    ...(productsResult.data || []).map((row) => productRowToCandidate(row, supplierById)),
    ...(recommendationResult.data || []).map((row) => recommendationRowToCandidate(row)),
    ...(vinosmithResult.data || []).map((row) => vinosmithWineRowToCandidate({ ...row, updated_at: row.last_seen_at }))
  ];

  const matches = searchProductIdentityCandidates(
    {
      query,
      supplierId,
      supplierName,
      limit: 8
    },
    dedupeCandidates(candidates)
  );

  return NextResponse.json({ matches });
}

function dedupeCandidates(candidates: ProductIdentityCandidate[]) {
  const byKey = new Map<string, ProductIdentityCandidate>();
  for (const candidate of candidates) {
    const key = candidate.planningSku || `${candidate.source}:${candidate.sourceId}`;
    const existing = byKey.get(key);
    if (!existing || sourceRank(candidate.source) < sourceRank(existing.source)) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values());
}

function sourceRank(source: ProductIdentityCandidate["source"]) {
  return ["supplier_catalog", "product", "recommendation", "vinosmith"].indexOf(source);
}
