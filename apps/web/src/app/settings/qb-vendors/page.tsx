import { QuickBooksVendorsSettingsView } from "@/components/quickbooks-vendors-settings-view";
import { AccountPending, getAppContext } from "@/lib/auth";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { QuickBooksVendor, QuickBooksVendorMapping, SupplierLogistics } from "@/lib/types";
import { unstable_cache } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 1000;

export default async function QuickBooksVendorsSettingsPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;

  const { vendors, mappings, suppliers, vinosmithImporters } = await cachedQuickBooksVendorSettingsData();

  return (
    <QuickBooksVendorsSettingsView
      vendors={vendors}
      mappings={mappings}
      suppliers={suppliers}
      vinosmithImporters={vinosmithImporters}
    />
  );
}

async function loadQuickBooksVendorSettingsData() {
  const supabase = createServiceRoleClient();
  const [
    vendors,
    mappings,
    suppliers,
    vinosmithImporterRows
  ] = await Promise.all([
    fetchAll<QuickBooksVendor>((from, to) =>
      supabase
        .from("quickbooks_vendors")
        .select("list_id,name,full_name,is_active,account_number,terms_ref,raw_data,last_seen_at")
        .order("name", { ascending: true })
        .range(from, to)
        .returns<QuickBooksVendor[]>()
    ),
    fetchAll<QuickBooksVendorMapping>((from, to) =>
      supabase
        .from("quickbooks_vendor_mappings")
        .select("quickbooks_vendor_list_id,supplier_id,vendor_classification,notes,updated_by,updated_at")
        .range(from, to)
        .returns<QuickBooksVendorMapping[]>()
    ),
    fetchAll<SupplierLogistics>((from, to) =>
      supabase
        .from("suppliers")
        .select(`
          id,
          importer_id,
          name,
          eta_days,
          pick_up_location,
          freight_forwarder,
          order_frequency,
          tdm,
          trucking_cost_per_bottle,
          notes,
          active
        `)
        .order("name", { ascending: true })
        .range(from, to)
        .returns<SupplierLogistics[]>()
    ),
    fetchAll<{ importer_name: string | null }>((from, to) =>
      supabase
        .from("vinosmith_wines")
        .select("importer_name")
        .order("importer_name", { ascending: true })
        .range(from, to)
        .returns<Array<{ importer_name: string | null }>>()
    )
  ]);

  return (
    {
      vendors: (vendors || []).map(compactVendorForSettings),
      mappings: mappings || [],
      suppliers: suppliers || [],
      vinosmithImporters: Array.from(
        new Set((vinosmithImporterRows || []).map((row) => row.importer_name?.trim()).filter((name): name is string => Boolean(name)))
      ).sort((a, b) => a.localeCompare(b))
    }
  );
}

function compactVendorForSettings(vendor: QuickBooksVendor): QuickBooksVendor {
  return {
    ...vendor,
    raw_data: compactVendorRawData(vendor.raw_data)
  };
}

function compactVendorRawData(rawData: QuickBooksVendor["raw_data"]) {
  const vendorTypeRef = rawData?.vendor_type_ref;
  if (!vendorTypeRef || typeof vendorTypeRef !== "object" || Array.isArray(vendorTypeRef)) return null;
  return { vendor_type_ref: vendorTypeRef };
}

async function cachedQuickBooksVendorSettingsData() {
  return unstable_cache(
    loadQuickBooksVendorSettingsData,
    ["quickbooks-vendor-settings-data"],
    {
      revalidate: 60,
      tags: [CACHE_TAGS.quickBooksVendors, CACHE_TAGS.quickBooksVendorMappings, CACHE_TAGS.suppliers]
    }
  )();
}

async function fetchAll<Row>(fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      throw new Error(error.message);
    }
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
