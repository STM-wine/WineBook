import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export type VisitActor = {
  id: string;
  name: string;
  email: string;
  role: string;
  canManageAssigned: boolean;
  isAdmin: boolean;
};

export class VisitAccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function getVisitActor(): Promise<VisitActor> {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) throw new VisitAccessError("Sign in required.", 401);
  const { data: profile, error } = await auth.from("app_profiles")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .maybeSingle<{ id: string; email: string; full_name: string | null; role: string }>();
  if (error) throw new VisitAccessError("Account access could not be checked.", 503);
  if (!profile) throw new VisitAccessError("Account is not enabled.", 403);
  const { data: grants, error: grantsError } = await auth.from("app_profile_permissions")
    .select("permission").eq("profile_id", user.id)
    .returns<{ permission: string }[]>();
  if (grantsError) throw new VisitAccessError("Visit permissions could not be checked.", 503);
  const permissions = new Set((grants || []).map((row) => row.permission));
  const isAdmin = profile.role === "admin";
  if (!isAdmin && profile.role !== "visit_sales" && !permissions.has("visit_access")) {
    throw new VisitAccessError("Visit access is not enabled.", 403);
  }
  if (profile.role === "visit_sales") {
    const { data: { session } } = await auth.auth.getSession();
    const token = session?.access_token?.split(".")[1];
    let dbRole: string | undefined;
    try { dbRole = token ? JSON.parse(Buffer.from(token, "base64url").toString("utf8")).role : undefined; }
    catch { /* Fail closed below. */ }
    if (dbRole !== "visit_sales") throw new VisitAccessError("Visit-only login is not configured safely.", 403);
  }
  return {
    id: user.id,
    name: profile.full_name?.trim() || profile.email,
    email: profile.email,
    role: profile.role,
    isAdmin,
    canManageAssigned: isAdmin || permissions.has("visit_manage_assigned")
  };
}

export function visitDb() { return createServiceRoleClient(); }

export function visitErrorResponse(error: unknown) {
  const status = error instanceof VisitAccessError ? error.status : 500;
  return Response.json({ error: error instanceof Error ? error.message : "Visit request failed." },
    { status, headers: { "Cache-Control": "no-store" } });
}

export function canReadPrivate(actor: VisitActor, request: { requester_id: string; manager_user_id: string | null }) {
  return actor.isAdmin || request.requester_id === actor.id ||
    (actor.canManageAssigned && request.manager_user_id === actor.id);
}

export function canCoordinate(actor: VisitActor, request: { manager_user_id: string | null }) {
  return actor.isAdmin || (actor.canManageAssigned && request.manager_user_id === actor.id);
}
