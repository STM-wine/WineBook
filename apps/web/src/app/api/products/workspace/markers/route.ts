import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { replenishmentPolicy } from "@/lib/replenishment-policy";

type PermissionRow = {
  permission: string;
};

type MarkerRequestBody = {
  itemCode?: unknown;
  quickbooksItemListId?: unknown;
  isBtg?: unknown;
  isCore?: unknown;
  replenishmentPolicy?: unknown;
  recommendationsSuppressed?: unknown;
  suppressionReason?: unknown;
  suppressedUntil?: unknown;
  note?: unknown;
};

export async function POST(request: Request) {
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
    .returns<PermissionRow[]>();

  if (permissionError) {
    return NextResponse.json({ error: permissionError.message }, { status: 500 });
  }
  if (!canManageOrderingMarkers(profile.role, permissionRows || [])) {
    return NextResponse.json({ error: "You do not have permission to update ordering markers." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as MarkerRequestBody | null;
  const itemCode = normalizeCode(body?.itemCode);
  if (!itemCode) {
    return NextResponse.json({ error: "Item code is required." }, { status: 400 });
  }

  const policy = replenishmentPolicy(body?.replenishmentPolicy);
  const recommendationsSuppressed = policy === "Limited" && body?.recommendationsSuppressed === true;
  const suppressionReason = recommendationsSuppressed ? stringOrNull(body?.suppressionReason) : null;
  const suppressedUntil = recommendationsSuppressed ? dateOrNull(body?.suppressedUntil) : null;
  const quickbooksItemListId = stringOrNull(body?.quickbooksItemListId);
  const note = stringOrNull(body?.note) || "Manual Product Workspace marker update";

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product Workspace is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const update = {
    is_btg: false,
    is_core: policy === "Core",
    replenishment_policy: policy,
    recommendations_suppressed: recommendationsSuppressed,
    suppression_reason: suppressionReason,
    suppressed_until: suppressedUntil,
    marker_note: note,
    note_source: "manual",
    updated_by: user.id
  };
  const { error: upsertError } = await supabase.from("ordering_item_markers").upsert({
    item_code: itemCode,
    ...(quickbooksItemListId ? { quickbooks_item_list_id: quickbooksItemListId } : {}),
    ...update
  }, { onConflict: "item_code" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const { data: marker, error: markerError } = await supabase
    .from("ordering_item_markers")
    .select("item_code,is_btg,is_core,replenishment_policy,policy_family_key,policy_family_name,family_default_policy,recommendations_suppressed,suppression_reason,suppressed_until,marker_note,note_source,updated_at,updated_by")
    .eq("item_code", itemCode)
    .maybeSingle<{
      item_code: string;
      is_btg: boolean | null;
      is_core: boolean | null;
      replenishment_policy: string | null;
      policy_family_key: string | null;
      policy_family_name: string | null;
      family_default_policy: string | null;
      recommendations_suppressed: boolean | null;
      suppression_reason: string | null;
      suppressed_until: string | null;
      marker_note: string | null;
      note_source: string | null;
      updated_at: string | null;
      updated_by: string | null;
    }>();

  if (markerError) {
    return NextResponse.json({ error: markerError.message }, { status: 500 });
  }

  return NextResponse.json({
    itemCode,
    orderingMarker: {
      isBtg: marker?.is_btg === true,
      isCore: marker?.is_core === true,
      replenishmentPolicy: replenishmentPolicy(marker?.replenishment_policy),
      policyFamilyKey: marker?.policy_family_key || null,
      policyFamilyName: marker?.policy_family_name || null,
      familyDefaultPolicy: replenishmentPolicy(marker?.family_default_policy || marker?.replenishment_policy),
      recommendationsSuppressed: marker?.recommendations_suppressed === true,
      suppressionReason: marker?.suppression_reason || null,
      suppressedUntil: marker?.suppressed_until || null,
      markerNote: marker?.marker_note || null,
      noteSource: marker?.note_source || null,
      updatedAt: marker?.updated_at || null,
      updatedBy: marker?.updated_by || null
    }
  });
}

function canManageOrderingMarkers(role: string, permissionRows: PermissionRow[]) {
  if (role === "admin") return true;
  return permissionRows.some((row) => row.permission === "draft_logic_changes" || row.permission === "manage_supplier_settings");
}

function normalizeCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateOrNull(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  return value.trim();
}
