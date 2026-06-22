"use server";

import { revalidatePath } from "next/cache";
import { APP_PERMISSIONS, requireAppContext, requirePermission, type AppContext, type AppPermission } from "@/lib/auth";
import {
  DEFAULT_ORDERING_LOGIC_SETTINGS,
  normalizeOrderingLogicSettings,
  validateOrderingLogicSettings,
  type OrderingLogicSettings
} from "@/lib/ordering-logic";
import { serviceSettingsClient } from "@/lib/settings-data";

function getString(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function getNumber(formData: FormData, key: string, fallback: number) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : fallback;
}

async function requireSettingsContext(): Promise<AppContext> {
  const context = await requireAppContext();
  if ("pendingEmail" in context) {
    throw new Error("Account is not enabled.");
  }
  return context;
}

function settingsFromForm(formData: FormData): OrderingLogicSettings {
  const current = DEFAULT_ORDERING_LOGIC_SETTINGS;
  const monthly_multipliers = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1);
      return [
        month,
        {
          mode: getString(formData, `month_${month}_mode`) || current.monthly_multipliers[month].mode,
          multiplier: getNumber(formData, `month_${month}_multiplier`, current.monthly_multipliers[month].multiplier)
        }
      ];
    })
  );

  const settings = normalizeOrderingLogicSettings({
    schema_version: 1,
    standard_target_days: getNumber(formData, "standard_target_days", current.standard_target_days),
    core_target_days: getNumber(formData, "core_target_days", current.core_target_days),
    btg_target_days: getNumber(formData, "btg_target_days", current.btg_target_days),
    monthly_mode_enabled: formData.get("monthly_mode_enabled") === "on",
    monthly_multipliers,
    minimum_multiplier: getNumber(formData, "minimum_multiplier", current.minimum_multiplier),
    maximum_multiplier: getNumber(formData, "maximum_multiplier", current.maximum_multiplier),
    default_pack_size: getNumber(formData, "default_pack_size", current.default_pack_size),
    standard_minimum_packs: getNumber(formData, "standard_minimum_packs", current.standard_minimum_packs),
    core_round_sub_case_to_one_pack: formData.get("core_round_sub_case_to_one_pack") === "on",
    btg_round_sub_case_to_one_pack: formData.get("btg_round_sub_case_to_one_pack") === "on",
    rounding_method: "ceil_pack",
    urgent_weeks_threshold: getNumber(formData, "urgent_weeks_threshold", current.urgent_weeks_threshold),
    high_risk_coverage_threshold: getNumber(formData, "high_risk_coverage_threshold", current.high_risk_coverage_threshold),
    medium_risk_coverage_threshold: getNumber(formData, "medium_risk_coverage_threshold", current.medium_risk_coverage_threshold),
    supplier_eta_warning_buffer_days: getNumber(
      formData,
      "supplier_eta_warning_buffer_days",
      current.supplier_eta_warning_buffer_days
    ),
    high_volume_flag_threshold: getNumber(formData, "high_volume_flag_threshold", current.high_volume_flag_threshold),
    recommendation_default_status: "rejected"
  });
  validateOrderingLogicSettings(settings);
  return settings;
}

export async function createLogicChangeRequest(formData: FormData) {
  const context = await requireSettingsContext();
  requirePermission(context, "request_logic_change");
  const settingKey = getString(formData, "setting_key");
  const requestedValue = getString(formData, "requested_value");
  const explanation = getString(formData, "explanation");

  if (!settingKey || !requestedValue || !explanation) {
    throw new Error("Setting, requested value, and business reason are required.");
  }

  const supabase = serviceSettingsClient();
  const { error } = await supabase.from("settings_change_requests").insert({
    domain: "ordering_logic",
    requested_by: context.user.id,
    requested_changes: {
      setting_key: settingKey,
      requested_value: requestedValue,
      current_value: getString(formData, "current_value"),
      effective_timing: getString(formData, "effective_timing"),
      example: getString(formData, "example")
    },
    explanation,
    status: "open"
  });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/settings/logic");
}

export async function createLogicDraft(formData: FormData) {
  const context = await requireSettingsContext();
  requirePermission(context, "draft_logic_changes");
  const supabase = serviceSettingsClient();
  const values = settingsFromForm(formData);
  const summary = getString(formData, "proposal_summary");
  const reason = getString(formData, "change_reason");

  if (!summary || !reason) {
    throw new Error("Proposal summary and business reason are required.");
  }

  const { data: latest, error: latestError } = await supabase
    .from("configuration_versions")
    .select("id,version_number")
    .eq("domain", "ordering_logic")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; version_number: number }>();

  if (latestError) throw new Error(latestError.message);

  const { error } = await supabase.from("configuration_versions").insert({
    domain: "ordering_logic",
    schema_version: 1,
    version_number: (latest?.version_number || 0) + 1,
    status: "draft",
    values,
    based_on_version_id: latest?.id || null,
    proposal_summary: summary,
    change_reason: reason,
    created_by: context.user.id
  });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/settings/logic");
  revalidatePath("/settings/history");
}

export async function submitLogicProposal(formData: FormData) {
  const context = await requireSettingsContext();
  requirePermission(context, "draft_logic_changes");
  const versionId = getString(formData, "version_id");
  if (!versionId) throw new Error("Version is required.");

  const supabase = serviceSettingsClient();
  const { error } = await supabase
    .from("configuration_versions")
    .update({
      status: "pending_approval",
      submitted_by: context.user.id,
      submitted_at: new Date().toISOString()
    })
    .eq("id", versionId)
    .eq("status", "draft");

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/settings/logic");
}

export async function publishLogicProposal(formData: FormData) {
  const context = await requireSettingsContext();
  requirePermission(context, "publish_logic_changes");
  const versionId = getString(formData, "version_id");
  const reason = getString(formData, "publish_reason");
  const previewConfirmed = formData.get("preview_confirmed") === "on";
  const futureRunsConfirmed = formData.get("future_runs_confirmed") === "on";

  if (!versionId) throw new Error("Version is required.");
  if (!reason) throw new Error("Publication reason is required.");
  if (!previewConfirmed || !futureRunsConfirmed) {
    throw new Error("Preview and future-run confirmations are required before publication.");
  }

  const supabase = serviceSettingsClient();
  const { error } = await supabase.rpc("publish_configuration_version", {
    p_version_id: versionId,
    p_actor_id: context.user.id,
    p_reason: reason
  });

  if (error) throw new Error(error.message);
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/settings/logic");
  revalidatePath("/settings/history");
}

export async function resolveLogicChangeRequest(formData: FormData) {
  const context = await requireSettingsContext();
  requirePermission(context, "draft_logic_changes");
  const requestId = getString(formData, "request_id");
  const status = getString(formData, "status");
  const adminResponse = getString(formData, "admin_response");
  if (!requestId || !["accepted", "declined", "implemented"].includes(status)) {
    throw new Error("Request and valid status are required.");
  }

  const supabase = serviceSettingsClient();
  const { error } = await supabase
    .from("settings_change_requests")
    .update({
      status,
      admin_response: adminResponse || null,
      resolved_at: new Date().toISOString()
    })
    .eq("id", requestId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/settings/logic");
}

export async function setProfilePermission(formData: FormData) {
  const context = await requireSettingsContext();
  requirePermission(context, "manage_user_access");
  const profileId = getString(formData, "profile_id");
  const permission = getString(formData, "permission") as AppPermission;
  const enabled = formData.get("enabled") === "true";
  if (!profileId || !permission) throw new Error("Profile and permission are required.");
  if (!APP_PERMISSIONS.includes(permission)) throw new Error("Unsupported permission.");

  const supabase = serviceSettingsClient();
  const result = enabled
    ? await supabase.from("app_profile_permissions").upsert({
        profile_id: profileId,
        permission,
        granted_by: context.user.id
      })
    : await supabase.from("app_profile_permissions").delete().eq("profile_id", profileId).eq("permission", permission);

  if (result.error) throw new Error(result.error.message);
  revalidatePath("/settings/access");
}
