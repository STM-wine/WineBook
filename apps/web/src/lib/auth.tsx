import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppProfile } from "@/lib/types";

export const APP_PERMISSIONS = [
  "view_settings",
  "view_logic_settings",
  "request_logic_change",
  "draft_logic_changes",
  "publish_logic_changes",
  "manage_user_access",
  "manage_supplier_settings",
  "view_settings_history"
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

export type AppContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string | null };
  profile: AppProfile;
  permissions: AppPermission[];
};

const BUYER_DEFAULT_PERMISSIONS: AppPermission[] = [
  "view_settings",
  "view_logic_settings",
  "request_logic_change",
  "view_settings_history"
];

const ADMIN_DEFAULT_PERMISSIONS: AppPermission[] = [
  ...BUYER_DEFAULT_PERMISSIONS,
  "draft_logic_changes",
  "manage_user_access",
  "manage_supplier_settings"
];

export function roleDefaultPermissions(role: AppProfile["role"]): AppPermission[] {
  if (role === "admin") return ADMIN_DEFAULT_PERMISSIONS;
  if (role === "buyer") return BUYER_DEFAULT_PERMISSIONS;
  return [];
}

export function hasPermission(permissions: AppPermission[], permission: AppPermission) {
  return permissions.includes(permission);
}

export function hasAnyPermission(permissions: AppPermission[], required: AppPermission[]) {
  return required.some((permission) => hasPermission(permissions, permission));
}

export async function getAppContext(): Promise<AppContext | { pendingEmail: string | null }> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("app_profiles")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .maybeSingle<AppProfile>();

  if (!profile) {
    return { pendingEmail: user.email || null };
  }

  const { data: permissionRows } = await supabase
    .from("app_profile_permissions")
    .select("permission")
    .eq("profile_id", user.id)
    .returns<{ permission: AppPermission }[]>();

  const permissions = Array.from(
    new Set([...(permissionRows || []).map((row) => row.permission), ...roleDefaultPermissions(profile.role)])
  ).filter((permission): permission is AppPermission => APP_PERMISSIONS.includes(permission as AppPermission));

  return {
    supabase,
    user: {
      id: user.id,
      email: user.email
    },
    profile,
    permissions
  };
}

export async function requireAppContext() {
  const context = await getAppContext();
  if ("pendingEmail" in context) {
    return context;
  }
  return context;
}

export function requirePermission(context: AppContext, permission: AppPermission) {
  if (!hasPermission(context.permissions, permission)) {
    throw new Error("You do not have permission to perform this action.");
  }
}

export function AccountPending({ email }: { email: string | null }) {
  return (
    <main className="empty-state">
      <section>
        <p className="eyebrow">Stem Intelligence</p>
        <h1>Account pending</h1>
        <p className="muted">
          You are signed in as {email || "this account"}, but this account is not enabled in Stem Intelligence yet.
          Add a matching row to Supabase app_profiles to grant access.
        </p>
      </section>
    </main>
  );
}
