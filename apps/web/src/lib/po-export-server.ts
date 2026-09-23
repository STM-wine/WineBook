import { quickBooksProducer, type QuickBooksItemIdentityRow } from "./quickbooks-item-fields";
import { hydratePoLineProducers, poLinePriceKey, type PoExportPriceLookup } from "./po-utils";
import type { PurchaseOrderDraftWithLines } from "./types";
import type { createServiceRoleClient } from "./supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export async function hydratePoExportProducers(supabase: ServiceClient, drafts: PurchaseOrderDraftWithLines[]) {
  const missing = drafts.flatMap((draft) => draft.lines || []).filter((line) => !line.producer_name?.trim());
  const catalogIds = Array.from(new Set(missing.map((line) => line.supplier_catalog_wine_id).filter(Boolean))) as string[];
  const codes = Array.from(new Set(missing.map((line) => line.product_code?.trim()).filter(Boolean))) as string[];
  if (!catalogIds.length && !codes.length) return drafts;

  const [catalogResult, vinosmithResult, quickBooksResult] = await Promise.all([
    catalogIds.length
      ? supabase.from("supplier_catalog_wines").select("id,producer").in("id", catalogIds)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? supabase.from("vinosmith_wines").select("code,producer_name").in("code", codes)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? supabase.from("quickbooks_items").select("list_id,name,full_name,custom_fields").in("name", codes).returns<QuickBooksItemIdentityRow[]>()
      : Promise.resolve({ data: [], error: null })
  ]);
  if (catalogResult.error) throw new Error(catalogResult.error.message);
  if (vinosmithResult.error) throw new Error(vinosmithResult.error.message);
  if (quickBooksResult.error) throw new Error(quickBooksResult.error.message);

  return hydratePoLineProducers(
    drafts,
    Object.fromEntries((catalogResult.data || []).map((wine) => [wine.id as string, wine.producer as string | null])),
    Object.fromEntries((vinosmithResult.data || []).filter((wine) => wine.code).map((wine) => [String(wine.code).trim().toLowerCase(), wine.producer_name as string | null])),
    Object.fromEntries((quickBooksResult.data || []).flatMap((item) => {
      const producer = quickBooksProducer(item) || null;
      return [item.name, item.full_name]
        .filter((code): code is string => Boolean(code?.trim()))
        .map((code) => [code.trim().toLowerCase(), producer]);
    }))
  );
}

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function positivePrice(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

export async function loadPoExportPrices(supabase: ServiceClient, drafts: PurchaseOrderDraftWithLines[]): Promise<PoExportPriceLookup> {
  const lines = drafts.flatMap((draft) => draft.lines || []);
  const catalogIds = Array.from(new Set(lines.map((line) => line.supplier_catalog_wine_id).filter(Boolean))) as string[];
  const codes = Array.from(new Set(lines.map((line) => line.product_code?.trim()).filter(Boolean))) as string[];
  const [catalogResult, winesResult, qbNameResult, qbFullNameResult] = await Promise.all([
    catalogIds.length
      ? supabase.from("supplier_catalog_wines").select("id,frontline_bottle_price,best_price").in("id", catalogIds)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? supabase.from("vinosmith_wines").select("wine_id,code").in("code", codes)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? supabase.from("quickbooks_items").select("name,full_name,sales_price").in("name", codes)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? supabase.from("quickbooks_items").select("name,full_name,sales_price").in("full_name", codes)
      : Promise.resolve({ data: [], error: null })
  ]);
  for (const result of [catalogResult, winesResult, qbNameResult, qbFullNameResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const wineIds = (winesResult.data || []).map((wine) => wine.wine_id as string);
  const pricesResult = wineIds.length
    ? await supabase.from("vinosmith_prices").select("wine_id,label,price_cents,is_default,active,disabled")
        .in("wine_id", wineIds).eq("active", true).or("disabled.is.null,disabled.eq.false")
    : { data: [], error: null };
  if (pricesResult.error) throw new Error(pricesResult.error.message);

  const catalogById = new Map((catalogResult.data || []).map((wine) => [wine.id as string, {
    frontline: positivePrice(wine.frontline_bottle_price as number | string | null),
    best: positivePrice(wine.best_price as number | string | null)
  }]));
  const wineIdByCode = new Map((winesResult.data || []).map((wine) => [normalize(wine.code as string | null), wine.wine_id as string]));
  const levelsByWine = new Map<string, Array<{ label: string | null; price_cents: number | null; is_default: boolean | null }>>();
  for (const price of pricesResult.data || []) {
    const list = levelsByWine.get(price.wine_id as string) || [];
    list.push(price as { label: string | null; price_cents: number | null; is_default: boolean | null });
    levelsByWine.set(price.wine_id as string, list);
  }
  const qbByCode = new Map<string, number | null>();
  const qbRows = Array.from(new Map([...(qbNameResult.data || []), ...(qbFullNameResult.data || [])]
    .map((item) => [`${item.name || ""}\u0000${item.full_name || ""}`, item])).values());
  for (const item of qbRows) {
    if (item.name) qbByCode.set(normalize(item.name as string), positivePrice(item.sales_price as number | string | null));
    if (item.full_name) qbByCode.set(normalize(item.full_name as string), positivePrice(item.sales_price as number | string | null));
  }

  return Object.fromEntries(lines.map((line) => {
    const code = normalize(line.product_code);
    const catalog = line.supplier_catalog_wine_id ? catalogById.get(line.supplier_catalog_wine_id) : undefined;
    const levels = levelsByWine.get(wineIdByCode.get(code) || "") || [];
    const frontlineLevel = levels.find((level) => level.is_default && positivePrice((level.price_cents || 0) / 100) !== null)
      || levels.find((level) => normalize(level.label).includes("front"));
    const bestLevel = levels.find((level) => normalize(level.label).includes("best"));
    const vinosmith = {
      frontline: positivePrice(frontlineLevel?.price_cents ? frontlineLevel.price_cents / 100 : null),
      best: positivePrice(bestLevel?.price_cents ? bestLevel.price_cents / 100 : null)
    };
    const price = line.is_new_item
      ? { frontline: catalog?.frontline ?? vinosmith.frontline, best: catalog?.best ?? vinosmith.best }
      : { frontline: vinosmith.frontline ?? catalog?.frontline ?? qbByCode.get(code) ?? null, best: vinosmith.best ?? catalog?.best ?? null };
    return [poLinePriceKey(line), price];
  }));
}
