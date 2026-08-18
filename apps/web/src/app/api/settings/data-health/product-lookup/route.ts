import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

type QuickBooksLookupRow = {
  list_id: string;
  name: string | null;
  full_name: string | null;
  is_active: boolean | null;
  custom_fields: Record<string, unknown> | null;
  time_modified: string | null;
  last_seen_at: string | null;
};

type VinosmithLookupRow = {
  wine_id: string;
  code: string | null;
  name: string | null;
  importer_name: string | null;
  producer_name: string | null;
  active: boolean | null;
  orderable: boolean | null;
  source_updated_at: string | null;
  last_seen_at: string | null;
};

type CheckpointRow = {
  last_synced_at: string | null;
};

type LookupSourceRow = {
  source: "QuickBooks" | "Vinosmith";
  code: string | null;
  name: string;
  status: string;
  detail: string;
  supplierName: string | null;
  brandName: string | null;
  lastSeenAt: string | null;
};

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

  const url = new URL(request.url);
  const tokens = parseLookupTokens(url.searchParams.get("q") || "");
  if (tokens.length === 0) {
    return NextResponse.json({ error: "Enter at least one item code or name." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const [quickBooksItemsUpdatedAt, vinosmithWinesUpdatedAt] = await Promise.all([
    latestCheckpointAt(supabase, "quickbooks_desktop", "quickbooks_items"),
    latestCheckpointAt(supabase, "vinosmith", "wines")
  ]);

  const groups = await Promise.all(
    tokens.map(async (token) => {
      const [quickBooksRows, vinosmithRows] = await Promise.all([
        fetchQuickBooksMatches(supabase, token),
        fetchVinosmithMatches(supabase, token)
      ]);
      const rows = [
        ...quickBooksRows.map(formatQuickBooksRow),
        ...vinosmithRows.map(formatVinosmithRow)
      ];
      const guidance = guidanceForRows(quickBooksRows, vinosmithRows);

      return {
        query: token,
        rows,
        guidance: guidance.message,
        tone: guidance.tone
      };
    })
  );

  return NextResponse.json({
    groups,
    quickBooksItemsUpdatedAt,
    vinosmithWinesUpdatedAt
  });
}

async function fetchQuickBooksMatches(supabase: ReturnType<typeof createServiceRoleClient>, token: string) {
  const pattern = `%${escapeIlike(token)}%`;
  const { data, error } = await supabase
    .from("quickbooks_items")
    .select("list_id,name,full_name,is_active,custom_fields,time_modified,last_seen_at")
    .or(`name.ilike.${pattern},full_name.ilike.${pattern}`)
    .order("full_name", { ascending: true })
    .limit(12)
    .returns<QuickBooksLookupRow[]>();

  if (error) throw new Error(error.message);
  return (data || []).filter((row) => rowMatchesToken(row.name, token) || rowMatchesToken(row.full_name, token) || rowMatchesToken(itemCodeFromQuickBooks(row), token));
}

async function fetchVinosmithMatches(supabase: ReturnType<typeof createServiceRoleClient>, token: string) {
  const pattern = `%${escapeIlike(token)}%`;
  const { data, error } = await supabase
    .from("vinosmith_wines")
    .select("wine_id,code,name,importer_name,producer_name,active,orderable,source_updated_at,last_seen_at")
    .or(`code.ilike.${pattern},name.ilike.${pattern}`)
    .order("name", { ascending: true })
    .limit(12)
    .returns<VinosmithLookupRow[]>();

  if (error) throw new Error(error.message);
  return data || [];
}

async function latestCheckpointAt(
  supabase: ReturnType<typeof createServiceRoleClient>,
  sourceSystem: string,
  resourceName: string
) {
  const { data, error } = await supabase
    .from("source_sync_checkpoints")
    .select("last_synced_at")
    .eq("source_system", sourceSystem)
    .eq("resource_name", resourceName)
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<CheckpointRow>();

  if (error) throw new Error(error.message);
  return data?.last_synced_at || null;
}

function formatQuickBooksRow(row: QuickBooksLookupRow): LookupSourceRow {
  return {
    source: "QuickBooks",
    code: itemCodeFromQuickBooks(row),
    name: row.full_name || row.name || "Unnamed QuickBooks item",
    status: row.is_active === false ? "Inactive" : row.is_active === true ? "Active" : "Unknown",
    detail: row.time_modified ? "Changed in QuickBooks before mirror import" : "Current QuickBooks mirror row",
    supplierName: null,
    brandName: null,
    lastSeenAt: row.last_seen_at
  };
}

function formatVinosmithRow(row: VinosmithLookupRow): LookupSourceRow {
  return {
    source: "Vinosmith",
    code: row.code,
    name: row.name || "Unnamed Vinosmith wine",
    status: vinosmithStatus(row),
    detail: row.source_updated_at ? "Changed in Vinosmith before mirror import" : "Current Vinosmith mirror row",
    supplierName: row.importer_name,
    brandName: row.producer_name,
    lastSeenAt: row.last_seen_at
  };
}

function guidanceForRows(quickBooksRows: QuickBooksLookupRow[], vinosmithRows: VinosmithLookupRow[]) {
  const hasActiveQb = quickBooksRows.some((row) => row.is_active !== false);
  const hasInactiveQb = quickBooksRows.some((row) => row.is_active === false);
  const hasSellableVs = vinosmithRows.some((row) => isVinosmithSellable(row));
  const hasInactiveVs = vinosmithRows.some((row) => !isVinosmithSellable(row));

  if (quickBooksRows.length === 0 && vinosmithRows.length === 0) {
    return { tone: "neutral" as const, message: "No source mirror match found. Check the code/name, then confirm the source refresh actually ran." };
  }
  if (hasActiveQb && !hasSellableVs) {
    return { tone: "danger" as const, message: "Still looks active in QuickBooks while Vinosmith is inactive or missing. If you changed QuickBooks, run Web Connector again and confirm QB Items Updated changes." };
  }
  if (hasSellableVs && !hasActiveQb) {
    return { tone: "danger" as const, message: "Still looks sellable in Vinosmith while QuickBooks is inactive or missing. If you changed Vinosmith, run Re-sync Vinosmith and wait for VS Wines Updated to change." };
  }
  if (hasInactiveQb && hasInactiveVs) {
    return { tone: "good" as const, message: "Both mirrors now look inactive/not orderable. If this still appears in the queue, reload Data Health after both refresh times are current." };
  }
  return { tone: "warning" as const, message: "The mirror has source data, but lifecycle status still needs review against the queue." };
}

function canViewSettings(role: string, permissionRows: Array<{ permission: string }>) {
  if (role === "admin" || role === "buyer") return true;
  return permissionRows.some((row) => row.permission === "view_settings");
}

function parseLookupTokens(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 8)
    )
  );
}

function escapeIlike(value: string) {
  return value.replace(/[%,]/g, "").trim();
}

function rowMatchesToken(value: unknown, token: string) {
  return typeof value === "string" && value.toLowerCase().includes(token.toLowerCase());
}

function isVinosmithSellable(row: VinosmithLookupRow) {
  return row.active === true || row.orderable === true;
}

function vinosmithStatus(row: VinosmithLookupRow) {
  if (row.active === true && row.orderable === true) return "Active + orderable";
  if (row.active === true) return "Active";
  if (row.orderable === true) return "Orderable";
  if (row.active === false || row.orderable === false) return "Inactive";
  return "Unknown";
}

function itemCodeFromQuickBooks(row: QuickBooksLookupRow) {
  return textFromCustomFields(row.custom_fields, [
    "item_number",
    "itemNumber",
    "ItemNumber",
    "sku",
    "SKU",
    "product_code",
    "productCode",
    "ProductCode"
  ]) || row.name || row.full_name || row.list_id;
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
