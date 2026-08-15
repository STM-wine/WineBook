import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const ITEM_FIELDS = [
  "quantity_on_hand",
  "quantity_on_order",
  "quantity_on_sales_order",
  "average_cost",
  "purchase_cost",
  "sales_price"
] as const;

const ITEM_TYPES = [
  "Inventory",
  "NonInventory",
  "Service",
  "OtherCharge",
  "InventoryAssembly",
  "Group",
  "SalesTax",
  "FixedAsset"
] as const;

type CountClient = {
  from: (table: string) => any;
};

export async function GET() {
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

  const { data: permissionRows, error: permissionError } = await authSupabase
    .from("app_profile_permissions")
    .select("permission")
    .eq("profile_id", user.id)
    .returns<Array<{ permission: string }>>();

  if (permissionError) {
    return NextResponse.json({ error: permissionError.message }, { status: 500 });
  }
  if (!canViewSettings(profile.role, permissionRows || [])) {
    return NextResponse.json({ error: "Settings access required." }, { status: 403 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks item master summary is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const [statusCounts, fieldCoverage, itemTypes, inventorySnapshots, itemCheckpoint] = await Promise.all([
      itemStatusCounts(supabase),
      itemFieldCoverage(supabase),
      itemTypeCounts(supabase),
      countRows(supabase, "quickbooks_inventory_snapshots"),
      latestItemCheckpoint(supabase)
    ]);

    return NextResponse.json({
      statusCounts,
      fieldCoverage,
      itemTypes,
      inventorySnapshots,
      itemCheckpoint
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load QuickBooks item master summary.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function itemStatusCounts(supabase: CountClient) {
  const [total, active, inactive, unknown] = await Promise.all([
    countRows(supabase, "quickbooks_items"),
    countRows(supabase, "quickbooks_items", (query) => query.eq("is_active", true)),
    countRows(supabase, "quickbooks_items", (query) => query.eq("is_active", false)),
    countRows(supabase, "quickbooks_items", (query) => query.is("is_active", null))
  ]);

  return { total, active, inactive, unknown };
}

async function itemFieldCoverage(supabase: CountClient) {
  const rows = await Promise.all(
    ITEM_FIELDS.map(async (field) => {
      const [present, activePresent] = await Promise.all([
        countRows(supabase, "quickbooks_items", (query) => query.not(field, "is", null)),
        countRows(supabase, "quickbooks_items", (query) => query.eq("is_active", true).not(field, "is", null))
      ]);

      return {
        field,
        present,
        activePresent
      };
    })
  );

  return rows;
}

async function itemTypeCounts(supabase: CountClient) {
  const rows = await Promise.all(
    ITEM_TYPES.map(async (itemType) => ({
      itemType,
      count: await countRows(supabase, "quickbooks_items", (query) => query.eq("item_type", itemType))
    }))
  );

  return rows;
}

async function latestItemCheckpoint(supabase: CountClient) {
  const { data, error } = await supabase
    .from("source_sync_checkpoints")
    .select("checkpoint_key,status,cursor_data,diagnostics,last_synced_at,updated_at")
    .eq("source_system", "quickbooks_desktop")
    .eq("resource_name", "quickbooks_items")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data || null;
}

async function countRows(
  supabase: CountClient,
  table: string,
  applyFilter?: (query: any) => any
) {
  const baseQuery = supabase.from(table).select("*", { count: "exact", head: true });
  const query = applyFilter ? applyFilter(baseQuery) : baseQuery;
  const { count, error } = await query;

  if (error) throw new Error(error.message);
  return count || 0;
}

function canViewSettings(role: string, permissionRows: Array<{ permission: string }>) {
  if (role === "admin" || role === "buyer") return true;
  return permissionRows.some((row) => row.permission === "view_settings");
}
