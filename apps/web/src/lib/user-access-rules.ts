import type { AppPermission } from "@/lib/auth";
import type { AppProfile } from "@/lib/types";

export const APP_ROLES = ["viewer", "buyer", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function isAppRole(value: string): value is AppRole {
  return APP_ROLES.includes(value as AppRole);
}

export function validateInviteInput(input: { email: string; fullName: string; role: string }) {
  if (!input.email || !/^\S+@\S+\.\S+$/.test(input.email)) return "Enter a valid email address.";
  if (!input.fullName) return "Full name is required.";
  if (input.email.length > 320 || input.fullName.length > 120) return "Name or email is too long.";
  if (!isAppRole(input.role)) return "Choose a valid role.";
  return null;
}

export function validateProfileUpdate(input: { profileId: string; fullName: string; role: string }) {
  if (!input.profileId || !input.fullName) return "User and full name are required.";
  if (input.fullName.length > 120) return "Full name is too long.";
  if (!isAppRole(input.role)) return "Choose a valid role.";
  return null;
}

export function canChangeProfileRole(input: {
  actorId: string;
  actorRole: AppProfile["role"];
  profileId: string;
  requestedRole: string;
}) {
  return input.profileId !== input.actorId || input.requestedRole === input.actorRole;
}

export function canSetPermission(input: {
  actorId: string;
  profileId: string;
  permission: AppPermission;
  enabled: boolean;
}) {
  return !(
    input.actorId === input.profileId &&
    input.permission === "manage_user_access" &&
    !input.enabled
  );
}
