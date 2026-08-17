import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type {
  ProductWorkspacePriceLevel,
  ProductWorkspaceResponse,
  ProductWorkspaceRow,
  ProductWorkspaceSource
} from "@/lib/product-workspace-types";

type ProductWorkspaceClient = SupabaseClient<any, "public", any>;

type QuickBooksItemRow = {
  list_id: string;
  item_type: string | null;
  name: string | null;
  full_name: string | null;
  is_active: boolean | null;
  sales_price: number | string | null;
  purchase_cost: number | string | null;
  average_cost: number | string | null;
  custom_fields: Record<string, unknown> | null;
  last_seen_at: string | null;
};

type VinosmithWineRow = {
  wine_id: string;
  code: string | null;
  name: string | null;
  vintage: string | null;
  importer_name: string | null;
  producer_name: string | null;
  unit_set: number | string | null;
  bottle_size: string | null;
  bottle_size_label: string | null;
  category: string | null;
  active: boolean | null;
  orderable: boolean | null;
};

type VinosmithPriceRow = {
  price_id: string;
  wine_id: string | null;
  label: string | null;
  price_cents: number | null;
  bill_back_price_cents: number | null;
  active: boolean | null;
  disabled: boolean | null;
  is_default: boolean | null;
};

type VinosmithSupplierHintRow = {
  code: string | null;
  importer_name: string | null;
};

type SupplierRow = {
  id: string;
  name: string;
  trucking_cost_per_bottle: number | string | null;
  active: boolean | null;
};

type SupplierCatalogWineRow = {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  display_name: string;
  producer: string;
  wine_name: string;
  vintage: string;
  pack_size: number | string;
  bottle_size: string;
  quickbooks_item_id: string | null;
  quickbooks_item_name: string | null;
  quickbooks_item_number: string | null;
  quickbooks_sync_status: string;
  conversion_status: string;
  product_lifecycle_status: string;
};

type SupplierCatalogPriceLevelRow = {
  id: string;
  supplier_catalog_wine_id: string;
  name: string;
  bottle_price: number | string;
  depletion_allowance: number | string;
  calculated_gp_margin: number | string;
  is_frontline: boolean;
  is_best: boolean;
  active: boolean;
};

const PAGE_SIZE = 1000;
const MAX_WORKSPACE_ROWS = 1400;

export async function GET(request: Request) {
  const authSupabase = await createClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await authSupabase
    .from("app_profiles")
    .select("id,role")
    .eq("id", user.id)
    .maybeSingle<{ id: string; role: string }>();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "Account is not enabled." }, { status: 403 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product Workspace is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const [quickBooksItems, suppliers, supplierCatalogWines, supplierCatalogPriceLevels, vinosmithSupplierHints] = await Promise.all([
      fetchQuickBooksItems(supabase, includeInactive),
      fetchSuppliers(supabase),
      fetchSupplierCatalogWines(supabase),
      fetchSupplierCatalogPriceLevels(supabase),
      fetchVinosmithSupplierHints(supabase)
    ]);

    const matchedWineIds = new Set<string>();
    const baseRows = quickBooksItems.slice(0, MAX_WORKSPACE_ROWS);
    const vinosmithWines = await fetchVinosmithWines(supabase, baseRows);
    const supplierByName = mapSuppliersByName(suppliers);
    const supplierNameByCodePrefix = mapVinosmithSuppliersByCodePrefix(vinosmithSupplierHints);
    const vinosmithLookup = buildVinosmithLookup(vinosmithWines);
    const catalogLookup = buildSupplierCatalogLookup(supplierCatalogWines);
    const catalogPriceLevelsByWine = groupSupplierCatalogPriceLevels(supplierCatalogPriceLevels);

    const provisionalRows = baseRows.map((item) => {
      const itemCode = itemCodeFromQuickBooks(item);
      const vinosmith = resolveVinosmithWine(item, itemCode, vinosmithLookup);
      if (vinosmith) matchedWineIds.add(vinosmith.wine_id);
      const supplierCatalog = resolveSupplierCatalogWine(item, itemCode, catalogLookup);
      const supplierResolution = resolveSupplierName(itemCode, vinosmith, supplierCatalog, supplierNameByCodePrefix);
      const supplier = supplierResolution.name ? supplierByName.get(normalizeKey(supplierResolution.name)) || null : null;
      const fob = numberOrNull(item.purchase_cost) ?? numberOrNull(item.average_cost);
      const purchaseCost = numberOrNull(item.purchase_cost);
      const fobSource = purchaseCost !== null ? "QuickBooks purchase_cost" : numberOrNull(item.average_cost) !== null ? "QuickBooks average_cost" : null;
      const laidIn = supplier ? numberOrNull(supplier.trucking_cost_per_bottle) : null;
      const laidInSource = supplier
        ? `Supplier Logistics trucking_cost_per_bottle${supplierResolution.source ? ` (${supplierResolution.source})` : ""}`
        : null;
      const landedCost = fob !== null && laidIn !== null ? roundMoney(fob + laidIn) : null;
      const sourceBadges = sourceBadgesForRow(vinosmith, supplierCatalog);
      const supplierCatalogLevels = supplierCatalog ? catalogPriceLevelsByWine.get(supplierCatalog.id) || [] : [];

      return {
        item,
        itemCode,
        vinosmith,
        supplierCatalog,
        supplierName: supplierResolution.name,
        supplierSource: supplierResolution.source,
        fob,
        fobSource,
        laidIn,
        laidInSource,
        landedCost,
        sourceBadges,
        supplierCatalogLevels
      };
    });

    const vinosmithPrices = await fetchVinosmithPrices(supabase, Array.from(matchedWineIds));
    const vinosmithPricesByWine = groupVinosmithPrices(vinosmithPrices);
    const rows = provisionalRows.map<ProductWorkspaceRow>((row) => {
      const priceLevels = [
        ...priceLevelsFromVinosmith(vinosmithPricesByWine.get(row.vinosmith?.wine_id || "") || [], row.landedCost),
        ...priceLevelsFromSupplierCatalog(row.supplierCatalogLevels)
      ];
      const frontline = pickPrice(priceLevels, "frontline");
      const bestPrice = pickPrice(priceLevels, "best");
      const gpValues = priceLevels
        .map((level) => level.calculatedGpPercent)
        .filter((value): value is number => value !== null);
      const averageGpPercent = gpValues.length
        ? roundPercent(gpValues.reduce((sum, value) => sum + value, 0) / gpValues.length)
        : null;
      const sourceHealth = sourceHealthForRow(row.fob, row.laidIn, priceLevels);
      const productName = row.vinosmith?.name || row.supplierCatalog?.display_name || row.item.full_name || row.item.name || "Unnamed item";
      const status = statusForRow(row.item, row.vinosmith);

      return {
        id: row.item.list_id,
        itemCode: row.itemCode || row.item.name || row.item.list_id,
        productName,
        brand: row.vinosmith?.producer_name || row.supplierCatalog?.producer || null,
        vintage: row.vinosmith?.vintage || row.supplierCatalog?.vintage || null,
        pack: packLabel(row.vinosmith, row.supplierCatalog),
        supplierName: row.supplierName,
        supplierSource: row.supplierSource,
        revenueCenter: revenueCenterFromItem(row.item, row.itemCode),
        active: row.item.is_active,
        statusLabel: status.label,
        statusDetail: status.detail,
        fob: row.fob,
        fobSource: row.fobSource,
        laidIn: row.laidIn,
        laidInSource: row.laidInSource,
        landedCost: row.landedCost,
        frontline,
        bestPrice,
        averageGpPercent,
        lastSold: null,
        ytdSales: null,
        sourceHealth,
        sourceHealthLabel: sourceHealthLabel(sourceHealth),
        sourceBadges: row.sourceBadges,
        quickbooks: {
          listId: row.item.list_id,
          fullName: row.item.full_name || row.item.name || "",
          purchaseCost: numberOrNull(row.item.purchase_cost),
          averageCost: numberOrNull(row.item.average_cost),
          salesPrice: numberOrNull(row.item.sales_price),
          itemType: row.item.item_type,
          lastSeenAt: row.item.last_seen_at
        },
        vinosmith: row.vinosmith
          ? {
              wineId: row.vinosmith.wine_id,
              code: row.vinosmith.code,
              name: row.vinosmith.name,
              active: row.vinosmith.active,
              orderable: row.vinosmith.orderable
            }
          : null,
        supplierCatalog: row.supplierCatalog
          ? {
              id: row.supplierCatalog.id,
              displayName: row.supplierCatalog.display_name,
              conversionStatus: row.supplierCatalog.conversion_status,
              lifecycleStatus: row.supplierCatalog.product_lifecycle_status,
              quickbooksSyncStatus: row.supplierCatalog.quickbooks_sync_status
            }
          : null,
        priceLevels,
        gpExplanation: gpExplanation(row.fob, row.laidIn, priceLevels)
      };
    });

    const summary = {
      total: await countRows(supabase, "quickbooks_items"),
      active: await countRows(supabase, "quickbooks_items", (query) => query.eq("is_active", true)),
      inactive: await countRows(supabase, "quickbooks_items", (query) => query.eq("is_active", false)),
      visible: rows.length,
      ready: rows.filter((row) => row.sourceHealth === "ready").length,
      partial: rows.filter((row) => row.sourceHealth === "partial").length,
      needsReview: rows.filter((row) => row.sourceHealth === "needs_review").length
    };

    const response: ProductWorkspaceResponse = {
      rows,
      summary,
      includeInactive,
      generatedAt: new Date().toISOString()
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Product Workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function fetchQuickBooksItems(supabase: ProductWorkspaceClient, includeInactive: boolean) {
  const rows: QuickBooksItemRow[] = [];
  let from = 0;

  while (rows.length < MAX_WORKSPACE_ROWS) {
    const base = supabase
      .from("quickbooks_items")
      .select(`
        list_id,
        item_type,
        name,
        full_name,
        is_active,
        sales_price,
        purchase_cost,
        average_cost,
        custom_fields,
        last_seen_at
      `)
      .order("full_name", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    const query = includeInactive ? base : base.eq("is_active", true);
    const { data, error } = await query.returns<QuickBooksItemRow[]>();

    if (error) throw new Error(error.message);

    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchVinosmithWines(supabase: ProductWorkspaceClient, quickBooksItems: QuickBooksItemRow[]) {
  const byWineId = new Map<string, VinosmithWineRow>();
  const itemCodes = uniqueTextValues(quickBooksItems.map((item) => itemCodeFromQuickBooks(item)));
  const itemNames = uniqueTextValues(
    quickBooksItems.flatMap((item) => [item.full_name, item.name])
  );

  await fetchVinosmithWineBatch(supabase, "code", itemCodes, byWineId);
  await fetchVinosmithWineBatch(supabase, "name", itemNames, byWineId);

  return Array.from(byWineId.values());
}

async function fetchVinosmithWineBatch(
  supabase: ProductWorkspaceClient,
  column: "code" | "name",
  values: string[],
  byWineId: Map<string, VinosmithWineRow>
) {
  for (let index = 0; index < values.length; index += 200) {
    const batch = values.slice(index, index + 200);
    if (batch.length === 0) continue;
    const { data, error } = await supabase
      .from("vinosmith_wines")
      .select(`
        wine_id,
        code,
        name,
        vintage,
        importer_name,
        producer_name,
        unit_set,
        bottle_size,
        bottle_size_label,
        category,
        active,
        orderable
      `)
      .in(column, batch)
      .returns<VinosmithWineRow[]>();

    if (error) throw new Error(error.message);

    for (const row of data || []) {
      byWineId.set(row.wine_id, row);
    }
  }
}

async function fetchVinosmithSupplierHints(supabase: ProductWorkspaceClient) {
  const rows: VinosmithSupplierHintRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("vinosmith_wines")
      .select("code,importer_name")
      .not("code", "is", null)
      .not("importer_name", "is", null)
      .order("code", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
      .returns<VinosmithSupplierHintRow[]>();

    if (error) throw new Error(error.message);

    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchSuppliers(supabase: ProductWorkspaceClient) {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id,name,trucking_cost_per_bottle,active")
    .returns<SupplierRow[]>();

  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchSupplierCatalogWines(supabase: ProductWorkspaceClient) {
  const { data, error } = await supabase
    .from("supplier_catalog_wines")
    .select(`
      id,
      supplier_id,
      supplier_name,
      display_name,
      producer,
      wine_name,
      vintage,
      pack_size,
      bottle_size,
      quickbooks_item_id,
      quickbooks_item_name,
      quickbooks_item_number,
      quickbooks_sync_status,
      conversion_status,
      product_lifecycle_status
    `)
    .in("quickbooks_sync_status", ["created", "linked"])
    .limit(2500)
    .returns<SupplierCatalogWineRow[]>();

  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchSupplierCatalogPriceLevels(supabase: ProductWorkspaceClient) {
  const { data, error } = await supabase
    .from("supplier_catalog_price_levels")
    .select(`
      id,
      supplier_catalog_wine_id,
      name,
      bottle_price,
      depletion_allowance,
      calculated_gp_margin,
      is_frontline,
      is_best,
      active
    `)
    .eq("active", true)
    .limit(5000)
    .returns<SupplierCatalogPriceLevelRow[]>();

  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchVinosmithPrices(supabase: ProductWorkspaceClient, wineIds: string[]) {
  if (wineIds.length === 0) return [];
  const rows: VinosmithPriceRow[] = [];

  for (let index = 0; index < wineIds.length; index += 200) {
    const batch = wineIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("vinosmith_prices")
      .select("price_id,wine_id,label,price_cents,bill_back_price_cents,active,disabled,is_default")
      .in("wine_id", batch)
      .eq("active", true)
      .or("disabled.is.null,disabled.eq.false")
      .returns<VinosmithPriceRow[]>();

    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }

  return rows;
}

async function countRows(
  supabase: ProductWorkspaceClient,
  table: string,
  applyFilter?: (query: any) => any
) {
  const baseQuery = supabase.from(table).select("*", { count: "exact", head: true });
  const query = applyFilter ? applyFilter(baseQuery) : baseQuery;
  const { count, error } = await query;

  if (error) throw new Error(error.message);
  return count || 0;
}

function buildVinosmithLookup(rows: VinosmithWineRow[]) {
  const byCode = new Map<string, VinosmithWineRow>();
  const byName = new Map<string, VinosmithWineRow>();

  rows.forEach((row) => {
    if (row.code) byCode.set(normalizeKey(row.code), row);
    if (row.name) byName.set(normalizeKey(row.name), row);
  });

  return { byCode, byName };
}

function buildSupplierCatalogLookup(rows: SupplierCatalogWineRow[]) {
  const byListId = new Map<string, SupplierCatalogWineRow>();
  const byItemNumber = new Map<string, SupplierCatalogWineRow>();
  const byItemName = new Map<string, SupplierCatalogWineRow>();

  rows.forEach((row) => {
    if (row.quickbooks_item_id) byListId.set(row.quickbooks_item_id, row);
    if (row.quickbooks_item_number) byItemNumber.set(normalizeKey(row.quickbooks_item_number), row);
    if (row.quickbooks_item_name) byItemName.set(normalizeKey(row.quickbooks_item_name), row);
  });

  return { byListId, byItemNumber, byItemName };
}

function mapSuppliersByName(rows: SupplierRow[]) {
  return new Map(rows.map((row) => [normalizeKey(row.name), row]));
}

function mapVinosmithSuppliersByCodePrefix(rows: VinosmithSupplierHintRow[]) {
  const namesByPrefix = new Map<string, Set<string>>();

  rows.forEach((row) => {
    const prefix = itemCodePrefix(row.code);
    if (!prefix || !row.importer_name) return;
    const existing = namesByPrefix.get(prefix) || new Set<string>();
    existing.add(row.importer_name.trim());
    namesByPrefix.set(prefix, existing);
  });

  const uniqueSupplierByPrefix = new Map<string, string>();
  namesByPrefix.forEach((names, prefix) => {
    const normalizedNames = new Map(Array.from(names).map((name) => [normalizeKey(name), name]));
    if (normalizedNames.size === 1) {
      uniqueSupplierByPrefix.set(prefix, Array.from(normalizedNames.values())[0]);
    }
  });

  return uniqueSupplierByPrefix;
}

function groupSupplierCatalogPriceLevels(rows: SupplierCatalogPriceLevelRow[]) {
  const byWine = new Map<string, SupplierCatalogPriceLevelRow[]>();
  rows.forEach((row) => {
    const existing = byWine.get(row.supplier_catalog_wine_id) || [];
    existing.push(row);
    byWine.set(row.supplier_catalog_wine_id, existing);
  });
  return byWine;
}

function groupVinosmithPrices(rows: VinosmithPriceRow[]) {
  const byWine = new Map<string, VinosmithPriceRow[]>();
  rows.forEach((row) => {
    if (!row.wine_id) return;
    const existing = byWine.get(row.wine_id) || [];
    existing.push(row);
    byWine.set(row.wine_id, existing);
  });
  return byWine;
}

function resolveVinosmithWine(
  item: QuickBooksItemRow,
  itemCode: string,
  lookup: ReturnType<typeof buildVinosmithLookup>
) {
  return lookup.byCode.get(normalizeKey(itemCode)) ||
    lookup.byName.get(normalizeKey(item.full_name)) ||
    lookup.byName.get(normalizeKey(item.name)) ||
    null;
}

function resolveSupplierCatalogWine(
  item: QuickBooksItemRow,
  itemCode: string,
  lookup: ReturnType<typeof buildSupplierCatalogLookup>
) {
  return lookup.byListId.get(item.list_id) ||
    lookup.byItemNumber.get(normalizeKey(itemCode)) ||
    lookup.byItemName.get(normalizeKey(item.full_name)) ||
    lookup.byItemName.get(normalizeKey(item.name)) ||
    null;
}

function resolveSupplierName(
  itemCode: string,
  vinosmith: VinosmithWineRow | null,
  supplierCatalog: SupplierCatalogWineRow | null,
  supplierNameByCodePrefix: Map<string, string>
) {
  if (isGrwItemCode(itemCode)) return { name: "GRW", source: "GRW item code" };
  if (vinosmith?.importer_name) return { name: vinosmith.importer_name, source: "Vinosmith importer" };
  if (supplierCatalog?.supplier_name) return { name: supplierCatalog.supplier_name, source: "Supplier Hub catalog" };

  const prefixSupplierName = supplierNameByCodePrefix.get(itemCodePrefix(itemCode));
  if (prefixSupplierName) return { name: prefixSupplierName, source: "Item prefix via Vinosmith" };

  return { name: null, source: null };
}

function itemCodeFromQuickBooks(item: QuickBooksItemRow) {
  return textFromCustomFields(item.custom_fields, [
    "item_number",
    "itemNumber",
    "ItemNumber",
    "sku",
    "SKU",
    "product_code",
    "productCode",
    "ProductCode"
  ]) || item.name || item.full_name || item.list_id;
}

function sourceBadgesForRow(vinosmith: VinosmithWineRow | null, supplierCatalog: SupplierCatalogWineRow | null) {
  const badges: ProductWorkspaceSource[] = ["quickbooks"];
  if (vinosmith) badges.push("vinosmith");
  if (supplierCatalog) badges.push("supplier_hub");
  return badges;
}

function priceLevelsFromVinosmith(rows: VinosmithPriceRow[], landedCost: number | null): ProductWorkspacePriceLevel[] {
  return rows
    .filter((row) => row.price_cents !== null)
    .map((row) => {
      const bottlePrice = row.price_cents === null ? null : roundMoney(row.price_cents / 100);
      const depletionAllowance = roundMoney((row.bill_back_price_cents || 0) / 100);
      return {
        id: row.price_id,
        name: row.label || "Price level",
        bottlePrice,
        depletionAllowance,
        calculatedGpPercent: calculateGpPercent(bottlePrice, landedCost, depletionAllowance),
        isFrontline: Boolean(row.is_default) || normalizeKey(row.label).includes("front"),
        isBest: normalizeKey(row.label).includes("best"),
        source: "Vinosmith"
      };
    });
}

function priceLevelsFromSupplierCatalog(rows: SupplierCatalogPriceLevelRow[]): ProductWorkspacePriceLevel[] {
  return rows.map((row) => {
    const calculated = numberOrNull(row.calculated_gp_margin);
    return {
      id: row.id,
      name: row.name,
      bottlePrice: numberOrNull(row.bottle_price),
      depletionAllowance: numberOrNull(row.depletion_allowance) || 0,
      calculatedGpPercent: calculated === null ? null : roundPercent(calculated * 100),
      isFrontline: row.is_frontline,
      isBest: row.is_best,
      source: "Supplier Hub"
    };
  });
}

function pickPrice(priceLevels: ProductWorkspacePriceLevel[], kind: "frontline" | "best") {
  const match = priceLevels.find((level) => (kind === "frontline" ? level.isFrontline : level.isBest));
  return match?.bottlePrice ?? null;
}

function calculateGpPercent(bottlePrice: number | null, landedCost: number | null, depletionAllowance: number) {
  if (bottlePrice === null || bottlePrice <= 0 || landedCost === null) return null;
  const effectiveCost = Math.max(0, landedCost - depletionAllowance);
  return roundPercent(((bottlePrice - effectiveCost) / bottlePrice) * 100);
}

function sourceHealthForRow(fob: number | null, laidIn: number | null, priceLevels: ProductWorkspacePriceLevel[]) {
  if (fob !== null && laidIn !== null && priceLevels.length > 0) return "ready";
  if (fob !== null || laidIn !== null || priceLevels.length > 0) return "partial";
  return "needs_review";
}

function sourceHealthLabel(sourceHealth: ProductWorkspaceRow["sourceHealth"]) {
  if (sourceHealth === "ready") return "Ready";
  if (sourceHealth === "partial") return "Partial";
  return "Needs review";
}

function statusForRow(item: QuickBooksItemRow, vinosmith: VinosmithWineRow | null) {
  const qbActive = item.is_active !== false;
  if (!vinosmith) {
    return {
      label: qbActive ? "QB active" : "QB inactive",
      detail: "No matched Vinosmith wine status."
    };
  }

  const vsActive = vinosmith.active === true || vinosmith.orderable === true;
  if (qbActive && !vsActive) {
    return {
      label: "QB active / VS inactive",
      detail: "QuickBooks is active, but Vinosmith active/orderable is not confirmed."
    };
  }
  if (!qbActive && vsActive) {
    return {
      label: "QB inactive / VS active",
      detail: "QuickBooks is inactive, but Vinosmith is active or orderable."
    };
  }

  return {
    label: qbActive ? "Active" : "Inactive",
    detail: qbActive ? "QuickBooks and Vinosmith are active/current." : "QuickBooks is inactive and Vinosmith is not active/orderable."
  };
}

function gpExplanation(fob: number | null, laidIn: number | null, priceLevels: ProductWorkspacePriceLevel[]) {
  const level = priceLevels.find((row) => row.isFrontline) || priceLevels[0];
  if (!level || level.bottlePrice === null || fob === null || laidIn === null) {
    return "GP needs a sale price, QuickBooks FOB, and Supplier Logistics laid-in cost.";
  }
  return `GP = (${moneyLabel(level.bottlePrice)} sale price - (${moneyLabel(fob)} QB FOB + ${moneyLabel(laidIn)} supplier laid-in - ${moneyLabel(level.depletionAllowance)} depletion)) / ${moneyLabel(level.bottlePrice)} sale price.`;
}

function packLabel(vinosmith: VinosmithWineRow | null, supplierCatalog: SupplierCatalogWineRow | null) {
  if (vinosmith) {
    const unitSet = numberOrNull(vinosmith.unit_set);
    const size = vinosmith.bottle_size_label || vinosmith.bottle_size || "750ml";
    return unitSet ? `${unitSet}/${size}` : size;
  }
  if (supplierCatalog) return `${supplierCatalog.pack_size}/${supplierCatalog.bottle_size}`;
  return null;
}

function revenueCenterFromItem(item: QuickBooksItemRow, itemCode: string) {
  const fullName = normalizeKey(item.full_name);
  if (isGrwItemCode(itemCode) || fullName.includes("grw")) return "GRW Broker";
  return "Stem Core";
}

function isGrwItemCode(value: string) {
  return normalizeKey(value).startsWith("grw");
}

function itemCodePrefix(value: unknown) {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return text.match(/^[A-Z]+/)?.[0] || "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function normalizeKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function uniqueTextValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function moneyLabel(value: number) {
  return `$${value.toFixed(2)}`;
}

function textFromCustomFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const fields = value as Record<string, unknown>;

  for (const key of keys) {
    const direct = fields[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      const nested = direct as Record<string, unknown>;
      const text = nested.value ?? nested.Value ?? nested.text ?? nested.Text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }

  return "";
}
