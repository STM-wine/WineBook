import { QuickBooksVendorsSettingsView } from "@/components/quickbooks-vendors-settings-view";
import { AccountPending, getAppContext } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { QuickBooksVendor, QuickBooksVendorMapping, SupplierLogistics } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function QuickBooksVendorsSettingsPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;

  const supabase = createServiceRoleClient();
  const [
    { data: vendors },
    { data: mappings },
    { data: suppliers }
  ] = await Promise.all([
    supabase
      .from("quickbooks_vendors")
      .select("list_id,name,full_name,is_active,account_number,terms_ref,raw_data,last_seen_at")
      .order("name", { ascending: true })
      .returns<QuickBooksVendor[]>(),
    supabase
      .from("quickbooks_vendor_mappings")
      .select("quickbooks_vendor_list_id,supplier_id,vendor_classification,notes,updated_by,updated_at")
      .returns<QuickBooksVendorMapping[]>(),
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
      .returns<SupplierLogistics[]>()
  ]);

  return (
    <QuickBooksVendorsSettingsView
      vendors={vendors || []}
      mappings={mappings || []}
      suppliers={suppliers || []}
    />
  );
}
