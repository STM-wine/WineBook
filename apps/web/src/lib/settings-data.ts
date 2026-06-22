import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  DEFAULT_ORDERING_LOGIC_SETTINGS,
  normalizeOrderingLogicSettings,
  type ConfigurationVersion,
  type OrderingLogicSettings,
  type SettingsChangeRequest
} from "@/lib/ordering-logic";
import type { AppPermission, AppContext } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/auth";
import type { AppProfile, Recommendation, ReportRun } from "@/lib/types";

export type SettingsOverviewData = {
  publishedVersion: ConfigurationVersion;
  latestReportRun: ReportRun | null;
  pendingProposals: ConfigurationVersion[];
  changeRequests: SettingsChangeRequest[];
  recentVersions: ConfigurationVersion[];
  latestRecommendations: Recommendation[];
  profiles: Array<AppProfile & { permissions?: AppPermission[] }>;
};

type RawConfigurationVersion = Omit<ConfigurationVersion, "values"> & {
  values: Partial<OrderingLogicSettings> | null;
};

function normalizeVersion(row: RawConfigurationVersion): ConfigurationVersion {
  return {
    ...row,
    values: normalizeOrderingLogicSettings(row.values)
  };
}

export function serviceSettingsClient() {
  return createServiceRoleClient();
}

export async function fetchSettingsOverview(context: AppContext): Promise<SettingsOverviewData> {
  if (!hasAnyPermission(context.permissions, ["view_settings", "view_logic_settings", "view_settings_history"])) {
    throw new Error("Settings access required.");
  }

  let supabase: ReturnType<typeof serviceSettingsClient> | AppContext["supabase"];
  try {
    supabase = serviceSettingsClient();
  } catch {
    supabase = context.supabase;
  }
  const [
    publishedResult,
    proposalResult,
    requestsResult,
    versionsResult,
    reportRunResult,
    recommendationsResult,
    profilesResult,
    permissionsResult
  ] = await Promise.all([
    supabase
      .from("configuration_versions")
      .select("*")
      .eq("domain", "ordering_logic")
      .eq("status", "published")
      .maybeSingle<RawConfigurationVersion>(),
    supabase
      .from("configuration_versions")
      .select("*")
      .eq("domain", "ordering_logic")
      .in("status", ["draft", "pending_approval"])
      .order("created_at", { ascending: false })
      .returns<RawConfigurationVersion[]>(),
    supabase
      .from("settings_change_requests")
      .select("*")
      .eq("domain", "ordering_logic")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<SettingsChangeRequest[]>(),
    supabase
      .from("configuration_versions")
      .select("*")
      .eq("domain", "ordering_logic")
      .order("version_number", { ascending: false })
      .limit(12)
      .returns<RawConfigurationVersion[]>(),
    supabase
      .from("report_runs")
      .select("id,report_date,completed_at,diagnostics,configuration_version_id,configuration_snapshot")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle<ReportRun>(),
    supabase
      .from("reorder_recommendations")
      .select(`
        id,
        report_run_id,
        planning_sku,
        product_name,
        product_code,
        supplier_name,
        brand_manager,
        is_btg,
        is_core,
        weekly_velocity,
        true_available,
        on_order,
        recommended_qty_rounded,
        fob,
        pack_size
      `)
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<Recommendation[]>(),
    supabase
      .from("app_profiles")
      .select("id,email,full_name,role")
      .order("email", { ascending: true })
      .returns<AppProfile[]>(),
    supabase
      .from("app_profile_permissions")
      .select("profile_id,permission")
      .returns<{ profile_id: string; permission: AppPermission }[]>()
  ]);

  const error =
    publishedResult.error ||
    proposalResult.error ||
    requestsResult.error ||
    versionsResult.error ||
    reportRunResult.error ||
    recommendationsResult.error ||
    profilesResult.error ||
    permissionsResult.error;
  if (error) throw new Error(error.message);

  const publishedVersion = publishedResult.data
    ? normalizeVersion(publishedResult.data)
    : fallbackPublishedVersion();
  const permissionsByProfile = new Map<string, AppPermission[]>();
  for (const row of permissionsResult.data || []) {
    const next = permissionsByProfile.get(row.profile_id) || [];
    next.push(row.permission);
    permissionsByProfile.set(row.profile_id, next);
  }

  return {
    publishedVersion,
    latestReportRun: reportRunResult.data || null,
    pendingProposals: (proposalResult.data || []).map(normalizeVersion),
    changeRequests: requestsResult.data || [],
    recentVersions: (versionsResult.data || []).map(normalizeVersion),
    latestRecommendations: (recommendationsResult.data || []).filter(
      (row) => !reportRunResult.data || row.report_run_id === reportRunResult.data.id
    ),
    profiles: (profilesResult.data || []).map((profile) => ({
      ...profile,
      permissions: permissionsByProfile.get(profile.id) || []
    }))
  };
}

function fallbackPublishedVersion(): ConfigurationVersion {
  const now = new Date().toISOString();
  return {
    id: "default",
    domain: "ordering_logic",
    schema_version: 1,
    version_number: 1,
    status: "published",
    values: DEFAULT_ORDERING_LOGIC_SETTINGS,
    based_on_version_id: null,
    proposal_summary: "Checked-in default ordering logic",
    change_reason: "Used until the settings migration is applied.",
    created_by: null,
    submitted_by: null,
    approved_by: null,
    published_by: null,
    created_at: now,
    submitted_at: null,
    published_at: now,
    effective_at: now
  };
}
