import { NextRequest, NextResponse } from "next/server";
import { poTemplateXlsxBuffer } from "@/lib/po-export";
import { ACTIVE_PO_STATUSES } from "@/lib/po-status";
import { poDraftSupplierLabel, poLinePriceKey, poTimestamp, type PoExportPriceLookup } from "@/lib/po-utils";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { PurchaseOrderDraftWithLines, SupplierLogistics } from "@/lib/types";

async function hydrateLineProducers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  drafts: PurchaseOrderDraftWithLines[]
) {
  const catalogWineIds = Array.from(
    new Set(
      drafts
        .flatMap((draft) => draft.lines || [])
        .filter((line) => !line.producer_name?.trim())
        .map((line) => line.supplier_catalog_wine_id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    )
  );

  if (catalogWineIds.length === 0) {
    return drafts;
  }

  const { data: catalogWines, error } = await supabase
    .from("supplier_catalog_wines")
    .select("id,producer")
    .in("id", catalogWineIds)
    .returns<Array<{ id: string; producer: string | null }>>();

  if (error) {
    throw new Error(error.message);
  }

  const producersById = new Map((catalogWines || []).map((wine) => [wine.id, wine.producer || null]));
  return drafts.map((draft) => ({
    ...draft,
    lines: (draft.lines || []).map((line) => ({
      ...line,
      producer_name: line.producer_name || (line.supplier_catalog_wine_id ? producersById.get(line.supplier_catalog_wine_id) || null : null)
    }))
  }));
}

function normalizedPriceLabel(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function positivePrice(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

async function loadPoExportPrices(
  supabase: ReturnType<typeof createServiceRoleClient>,
  drafts: PurchaseOrderDraftWithLines[]
): Promise<PoExportPriceLookup> {
  const lines = drafts.flatMap((draft) => draft.lines || []);
  const catalogWineIds = Array.from(new Set(lines.map((line) => line.supplier_catalog_wine_id).filter(Boolean))) as string[];
  const productCodes = Array.from(new Set(lines.map((line) => line.product_code?.trim()).filter(Boolean))) as string[];

  const [
    { data: catalogWines, error: catalogError },
    { data: vinosmithWines, error: wineError },
    { data: quickBooksItemsByName, error: qbNameError },
    { data: quickBooksItemsByFullName, error: qbFullNameError }
  ] = await Promise.all([
    catalogWineIds.length > 0
      ? supabase
          .from("supplier_catalog_wines")
          .select("id,frontline_bottle_price,best_price")
          .in("id", catalogWineIds)
      : Promise.resolve({ data: [], error: null }),
    productCodes.length > 0
      ? supabase
          .from("vinosmith_wines")
          .select("wine_id,code")
          .in("code", productCodes)
      : Promise.resolve({ data: [], error: null }),
    productCodes.length > 0
      ? supabase
          .from("quickbooks_items")
          .select("name,full_name,sales_price")
          .in("name", productCodes)
      : Promise.resolve({ data: [], error: null }),
    productCodes.length > 0
      ? supabase
          .from("quickbooks_items")
          .select("name,full_name,sales_price")
          .in("full_name", productCodes)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (catalogError) throw new Error(catalogError.message);
  if (wineError) throw new Error(wineError.message);
  if (qbNameError) throw new Error(qbNameError.message);
  if (qbFullNameError) throw new Error(qbFullNameError.message);
  const quickBooksItems = Array.from(new Map(
    [...(quickBooksItemsByName || []), ...(quickBooksItemsByFullName || [])]
      .map((item) => [`${item.name || ""}\u0000${item.full_name || ""}`, item])
  ).values());

  const wineIds = (vinosmithWines || []).map((wine) => wine.wine_id as string);
  const { data: vinosmithPrices, error: priceError } = wineIds.length > 0
    ? await supabase
        .from("vinosmith_prices")
        .select("wine_id,label,price_cents,is_default,active,disabled")
        .in("wine_id", wineIds)
        .eq("active", true)
        .or("disabled.is.null,disabled.eq.false")
    : { data: [], error: null };
  if (priceError) throw new Error(priceError.message);

  const catalogById = new Map((catalogWines || []).map((wine) => [wine.id as string, {
    frontline: positivePrice(wine.frontline_bottle_price),
    best: positivePrice(wine.best_price)
  }]));
  const wineIdByCode = new Map((vinosmithWines || []).map((wine) => [normalizedPriceLabel(wine.code), wine.wine_id as string]));
  const vinosmithPricesByWineId = new Map<string, Array<{ label: string | null; price_cents: number | null; is_default: boolean | null }>>();
  for (const price of vinosmithPrices || []) {
    const current = vinosmithPricesByWineId.get(price.wine_id as string) || [];
    current.push(price as { label: string | null; price_cents: number | null; is_default: boolean | null });
    vinosmithPricesByWineId.set(price.wine_id as string, current);
  }
  const qbFrontlineByCode = new Map<string, number | null>();
  for (const item of quickBooksItems || []) {
    const frontline = positivePrice(item.sales_price);
    if (item.name) qbFrontlineByCode.set(normalizedPriceLabel(item.name), frontline);
    if (item.full_name) qbFrontlineByCode.set(normalizedPriceLabel(item.full_name), frontline);
  }

  return Object.fromEntries(lines.map((line) => {
    const codeKey = normalizedPriceLabel(line.product_code);
    const catalog = line.supplier_catalog_wine_id ? catalogById.get(line.supplier_catalog_wine_id) : undefined;
    const wineId = wineIdByCode.get(codeKey);
    const levels = wineId ? vinosmithPricesByWineId.get(wineId) || [] : [];
    const frontlineLevel = levels.find((level) => level.is_default && positivePrice((level.price_cents || 0) / 100) !== null)
      || levels.find((level) => normalizedPriceLabel(level.label).includes("front"));
    const bestLevel = levels.find((level) => normalizedPriceLabel(level.label).includes("best"));
    const vinosmith = {
      frontline: positivePrice(frontlineLevel?.price_cents ? frontlineLevel.price_cents / 100 : null),
      best: positivePrice(bestLevel?.price_cents ? bestLevel.price_cents / 100 : null)
    };
    const price = line.is_new_item
      ? { frontline: catalog?.frontline ?? vinosmith.frontline, best: catalog?.best ?? vinosmith.best }
      : {
          frontline: vinosmith.frontline ?? catalog?.frontline ?? qbFrontlineByCode.get(codeKey) ?? null,
          best: vinosmith.best ?? catalog?.best ?? null
        };
    return [poLinePriceKey(line), price];
  }));
}

export async function GET(request: NextRequest) {
  const reportRunId = request.nextUrl.searchParams.get("reportRunId");
  const draftId = request.nextUrl.searchParams.get("draftId");
  const draftIds = (request.nextUrl.searchParams.get("draftIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!reportRunId) {
    return NextResponse.json({ error: "Missing reportRunId." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const integrationSupabase = createServiceRoleClient();

  let draftsQuery = supabase
    .from("purchase_order_drafts")
    .select(`
      id,
      report_run_id,
      ordering_source,
      source_snapshot,
      supplier_name,
      status,
      po_number,
      notes,
      created_at,
      updated_at,
      lines:purchase_order_lines (
        id,
        purchase_order_draft_id,
        recommendation_id,
        supplier_catalog_wine_id,
        producer_name,
        product_name,
        product_code,
        planning_sku,
        recommended_qty,
        approved_qty,
        fob,
        line_cost,
        trucking_cost_per_bottle,
        wine_cost,
        laid_in_cost,
        landed_cost,
        is_new_item,
        new_item_warning,
        source_snapshot
      )
    `)
    .eq("report_run_id", reportRunId)
    .in("status", [...ACTIVE_PO_STATUSES])
    .order("supplier_name", { ascending: true });

  if (draftId) {
    draftsQuery = draftsQuery.eq("id", draftId);
  } else if (draftIds.length > 0) {
    draftsQuery = draftsQuery.in("id", draftIds);
  }

  const { data: drafts, error } = await draftsQuery.returns<PurchaseOrderDraftWithLines[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (draftId && (!drafts || drafts.length === 0)) {
    return NextResponse.json({ error: "PO draft is not active or was not found." }, { status: 404 });
  }

  if (draftIds.length > 0 && (!drafts || drafts.length === 0)) {
    return NextResponse.json({ error: "No active PO drafts matched the selected drafts." }, { status: 404 });
  }

  let exportDrafts: PurchaseOrderDraftWithLines[];
  try {
    exportDrafts = await hydrateLineProducers(integrationSupabase, drafts || []);
  } catch (producerError) {
    return NextResponse.json(
      { error: producerError instanceof Error ? producerError.message : "Could not load producer names." },
      { status: 500 }
    );
  }

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id,importer_id,name,eta_days,pick_up_location,freight_forwarder,order_frequency,tdm,trucking_cost_per_bottle,notes,active")
    .returns<SupplierLogistics[]>();
  let prices: PoExportPriceLookup;
  try {
    prices = await loadPoExportPrices(integrationSupabase, exportDrafts);
  } catch (priceError) {
    return NextResponse.json(
      { error: priceError instanceof Error ? priceError.message : "Could not load Frontline and Best pricing." },
      { status: 500 }
    );
  }
  const buffer = await poTemplateXlsxBuffer(exportDrafts, suppliers || [], prices);
  const supplierFilenamePart =
    draftId && exportDrafts[0]
      ? poDraftSupplierLabel(exportDrafts[0])
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "supplier"
      : "all";
  const filename = draftId ? `PO ${supplierFilenamePart} ${poTimestamp()}.xlsx` : `POs ${poTimestamp()}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Cache-Control": "no-store"
    }
  });
}
