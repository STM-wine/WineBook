import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchAllExact } from "@/lib/supabase/fetch-all-exact";
import {
  productRowToCandidate,
  quickbooksItemRowToCandidate,
  recommendationRowToCandidate,
  dedupeProductIdentityCandidates,
  latestProductIdentityPriceLevels,
  searchProductIdentityCandidates,
  supplierCatalogRowToCandidate,
  vinosmithWineRowToCandidate,
  type ProductIdentityCandidate
} from "@/lib/product-identity-search";

const RECENT_REPORT_RUN_COUNT = 8;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const supplierId = url.searchParams.get("supplierId") || null;
  const supplierName = url.searchParams.get("supplierName") || null;
  const producer = url.searchParams.get("producer") || null;
  const vintage = url.searchParams.get("vintage") || null;
  const packSize = Number(url.searchParams.get("packSize") || 0) || null;
  const bottleSize = url.searchParams.get("bottleSize") || null;
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const searchPattern = `%${query
    .replace(/[%_*,()'"\\]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("%")}%`;

  if (query.length < 3) {
    return NextResponse.json({ matches: [] });
  }

  const authSupabase = await createClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await authSupabase
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

  let searchSupabase: ReturnType<typeof createServiceRoleClient>;
  try {
    searchSupabase = createServiceRoleClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product match search is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let suppliers: any[];
  let catalogRows: any[];
  let productRows: any[];
  let reportRuns: any[];
  let vinosmithRows: any[];
  let quickbooksRows: any[];
  try {
    [suppliers, catalogRows, productRows, reportRuns, vinosmithRows, quickbooksRows] = await Promise.all([
    fetchAllExact("supplier match search suppliers", (from, to) => searchSupabase
      .from("suppliers")
      .select("id,name,trucking_cost_per_bottle", { count: "exact" })
      .order("id", { ascending: true })
      .range(from, to) as never),
    fetchAllExact("supplier catalog match search", (from, to) => {
      let request = searchSupabase.from("supplier_catalog_wines").select(`
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
      `, { count: "exact" })
        .or(`display_name.ilike.${searchPattern},producer.ilike.${searchPattern},wine_name.ilike.${searchPattern},planning_sku.ilike.${searchPattern}`);
      if (!includeInactive) request = request.neq("product_lifecycle_status", "inactive");
      return request.order("id", { ascending: true }).range(from, to) as never;
    }),
    fetchAllExact("product match search", (from, to) => {
      let request = searchSupabase.from("products")
        .select("id,planning_sku,product_code,name,vintage,pack_size,is_btg,is_core,supplier_id,current_fob,active,updated_at", { count: "exact" })
        .or(`name.ilike.${searchPattern},planning_sku.ilike.${searchPattern},product_code.ilike.${searchPattern}`);
      if (!includeInactive) request = request.eq("active", true);
      return request.order("id", { ascending: true }).range(from, to) as never;
    }),
    searchSupabase
      .from("report_runs")
      .select("id")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(RECENT_REPORT_RUN_COUNT)
      .then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
    fetchAllExact("Vinosmith wine match search", (from, to) => {
      let request = searchSupabase.from("vinosmith_wines").select(`
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
      `, { count: "exact" })
        .or(`name.ilike.${searchPattern},producer_name.ilike.${searchPattern},code.ilike.${searchPattern},importer_name.ilike.${searchPattern}`);
      if (!includeInactive) request = request.eq("active", true);
      return request.order("wine_id", { ascending: true }).range(from, to) as never;
    }),
    fetchAllExact("QuickBooks item match search", (from, to) => {
      let request = searchSupabase.from("quickbooks_items")
        .select("list_id,name,full_name,is_active,sales_desc,purchase_desc,sales_price,purchase_cost,custom_fields,raw_data,time_modified,last_seen_at", { count: "exact" })
        .or([
          `name.ilike.${searchPattern}`,
          `full_name.ilike.${searchPattern}`,
          `sales_desc.ilike.${searchPattern}`,
          `purchase_desc.ilike.${searchPattern}`
        ].join(","));
      if (!includeInactive) request = request.eq("is_active", true);
      return request.order("list_id", { ascending: true }).range(from, to) as never;
    })
    ]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load product match sources." }, { status: 500 });
  }

  const reportRunIds = reportRuns.map((run) => run.id).filter(Boolean);
  const recommendationResult = reportRunIds.length
    ? await fetchAllExact<any>("recent recommendation match search", (from, to) => searchSupabase
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
        `, { count: "exact" })
        .in("report_run_id", reportRunIds)
        .or(`product_name.ilike.${searchPattern},planning_sku.ilike.${searchPattern},product_code.ilike.${searchPattern}`)
        .order("id", { ascending: true })
        .range(from, to) as never)
    : [];

  const supplierById = new Map(
    suppliers.map((supplier) => [
      String(supplier.id),
      {
        name: String(supplier.name || "No supplier"),
        truckingCostPerBottle: Number(supplier.trucking_cost_per_bottle || 0)
      }
    ])
  );
  const supplierByName = new Map(
    suppliers.map((supplier) => [String(supplier.name || "").trim().toLowerCase(), supplier])
  );

  const candidates: ProductIdentityCandidate[] = [
    ...catalogRows.map((row) => supplierCatalogRowToCandidate(row)),
    ...productRows.map((row) => productRowToCandidate(row, supplierById)),
    ...quickbooksRows.map((row) => {
      const candidate = quickbooksItemRowToCandidate(row);
      const supplier = supplierByName.get(candidate.supplierName.trim().toLowerCase());
      return supplier ? {
        ...candidate,
        supplierId: String(supplier.id),
        laidInPerBottle: Number(supplier.trucking_cost_per_bottle || 0)
      } : candidate;
    }),
    ...recommendationResult.map((row) => recommendationRowToCandidate(row)),
    ...vinosmithRows.map((row) => vinosmithWineRowToCandidate({ ...row, updated_at: row.last_seen_at }))
  ];

  let matches = searchProductIdentityCandidates(
    {
      query,
      producer,
      vintage,
      packSize,
      bottleSize,
      supplierId,
      supplierName,
      includeInactive,
      limit: 20
    },
    dedupeProductIdentityCandidates(candidates)
  );

  try {
    matches = await attachCurrentPriceLevels(searchSupabase, matches);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load current price levels." }, { status: 500 });
  }

  return NextResponse.json({ matches });
}

async function attachCurrentPriceLevels(
  supabase: ReturnType<typeof createServiceRoleClient>,
  matches: ReturnType<typeof searchProductIdentityCandidates>
) {
  const catalogIds = matches.filter((match) => match.source === "supplier_catalog").map((match) => match.sourceId);
  const wineIds = matches.filter((match) => match.source === "vinosmith").map((match) => match.sourceId);
  const [catalogResult, vinosmithResult] = await Promise.all([
    catalogIds.length
      ? supabase.from("supplier_catalog_price_levels")
          .select("id,supplier_catalog_wine_id,name,bottle_price,depletion_allowance,is_frontline,is_best,active,source_system,updated_at")
          .in("supplier_catalog_wine_id", catalogIds)
          .order("display_order", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    wineIds.length
      ? supabase.from("vinosmith_prices")
          .select("price_id,wine_id,label,price_cents,bill_back_price_cents,is_default,active,disabled,premise,effective_start_at,effective_end_at,last_seen_at")
          .in("wine_id", wineIds)
          .eq("active", true)
          .or("disabled.is.null,disabled.eq.false")
          .order("last_seen_at", { ascending: false })
      : Promise.resolve({ data: [], error: null })
  ]);
  if (catalogResult.error) throw new Error(catalogResult.error.message);
  if (vinosmithResult.error) throw new Error(vinosmithResult.error.message);

  return matches.map((match) => {
    if (match.source === "supplier_catalog") {
      const priceLevels = (catalogResult.data || [])
        .filter((level) => level.supplier_catalog_wine_id === match.sourceId)
        .map((level) => ({
          id: level.id,
          name: level.name,
          bottlePrice: Number(level.bottle_price || 0),
          depletionAllowance: Number(level.depletion_allowance || 0),
          isFrontline: Boolean(level.is_frontline),
          isBest: Boolean(level.is_best),
          active: level.active !== false,
          sourceSystem: level.source_system || "supplier_catalog",
          updatedAt: level.updated_at || match.updatedAt
        }));
      return { ...match, priceLevels };
    }
    if (match.source === "vinosmith") {
      const priceLevels = latestProductIdentityPriceLevels((vinosmithResult.data || [])
        .filter((level) => level.wine_id === match.sourceId)
        .map((level) => {
          const label = String(level.label || "Price level");
          const normalized = label.toLowerCase();
          return {
            id: level.price_id,
            name: level.premise ? `${label} · ${level.premise}` : label,
            bottlePrice: Number(level.price_cents || 0) / 100,
            depletionAllowance: Number(level.bill_back_price_cents || 0) / 100,
            isFrontline: Boolean(level.is_default) || normalized.includes("front"),
            isBest: normalized.includes("best"),
            active: level.active !== false && level.disabled !== true,
            sourceSystem: "vinosmith",
            updatedAt: level.last_seen_at || match.updatedAt
          };
        }));
      return { ...match, priceLevels };
    }
    return match;
  });
}
