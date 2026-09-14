import { NextResponse } from "next/server";
import {
  isLikelyQuickBooksWineItem,
  quickBooksItemCode,
  quickBooksItemDisplayName,
  quickBooksPackFormat,
  quickBooksProducer,
  quickBooksVintage,
  type QuickBooksItemIdentityRow
} from "@/lib/quickbooks-item-fields";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { InactiveQuickBooksItem } from "@/lib/types";

type SearchRow = QuickBooksItemIdentityRow & {
  purchase_cost: number | string | null;
  average_cost: number | string | null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supplierName = url.searchParams.get("supplier")?.trim() || "";
  const query = url.searchParams.get("q")?.replace(/[,%_()]/g, " ").replace(/\s+/g, " ").trim() || "";
  if (!supplierName || query.length < 2) return NextResponse.json({ items: [] });

  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data: profile } = await authSupabase
    .from("app_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "Account is not enabled." }, { status: 403 });

  const supabase = createServiceRoleClient();
  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select("id,name")
    .eq("name", supplierName)
    .limit(1)
    .maybeSingle<{ id: string; name: string }>();
  if (supplierError) return NextResponse.json({ error: supplierError.message }, { status: 500 });
  if (!supplier) return NextResponse.json({ items: [] });

  const { data: mappings, error: mappingError } = await supabase
    .from("quickbooks_vendor_mappings")
    .select("quickbooks_vendor_list_id")
    .eq("supplier_id", supplier.id);
  if (mappingError) return NextResponse.json({ error: mappingError.message }, { status: 500 });
  const vendorIds = (mappings || []).map((mapping) => mapping.quickbooks_vendor_list_id).filter(Boolean);
  if (vendorIds.length === 0) return NextResponse.json({ items: [] });

  const pattern = `%${query}%`;
  const { data, error } = await supabase
    .from("quickbooks_items")
    .select("list_id,name,full_name,sales_desc,purchase_desc,purchase_cost,average_cost,custom_fields,raw_data")
    .eq("is_active", false)
    .eq("item_type", "Inventory")
    .in("raw_data->preferred_vendor_ref->>ListID", vendorIds)
    .or(`name.ilike.${pattern},full_name.ilike.${pattern},sales_desc.ilike.${pattern},purchase_desc.ilike.${pattern}`)
    .order("sales_desc", { ascending: true, nullsFirst: false })
    .limit(50)
    .returns<SearchRow[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items: InactiveQuickBooksItem[] = (data || [])
    .filter(isLikelyQuickBooksWineItem)
    .map((item) => {
      const format = quickBooksPackFormat(item);
      const cost = Number(item.purchase_cost ?? item.average_cost);
      return {
        listId: item.list_id,
        itemNumber: quickBooksItemCode(item),
        displayName: quickBooksItemDisplayName(item),
        supplierName: supplier.name,
        producer: quickBooksProducer(item) || null,
        vintage: quickBooksVintage(item),
        packSize: format.packSize,
        bottleSize: format.bottleSize,
        packLabel: format.label,
        purchaseCost: Number.isFinite(cost) ? cost : null
      };
    });

  return NextResponse.json({ items });
}
