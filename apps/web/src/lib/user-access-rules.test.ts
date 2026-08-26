import { describe, expect, it } from "vitest";
import {
  canChangeProfileRole,
  canSetPermission,
  isAppRole,
  validateInviteInput,
  validateProfileUpdate
} from "./user-access-rules";

describe("user access rules", () => {
  it("accepts supported roles and rejects arbitrary role values", () => {
    expect(isAppRole("viewer")).toBe(true);
    expect(isAppRole("buyer")).toBe(true);
    expect(isAppRole("admin")).toBe(true);
    expect(isAppRole("owner")).toBe(false);
  });

  it("validates invitation fields", () => {
    expect(validateInviteInput({ email: "buyer@example.com", fullName: "Stem Buyer", role: "buyer" })).toBeNull();
    expect(validateInviteInput({ email: "not-an-email", fullName: "Stem Buyer", role: "buyer" })).toBe(
      "Enter a valid email address."
    );
    expect(validateInviteInput({ email: "buyer@example.com", fullName: "", role: "buyer" })).toBe(
      "Full name is required."
    );
    expect(validateInviteInput({ email: "buyer@example.com", fullName: "Stem Buyer", role: "owner" })).toBe(
      "Choose a valid role."
    );
  });

  it("validates profile updates", () => {
    expect(validateProfileUpdate({ profileId: "profile-1", fullName: "Stem Buyer", role: "viewer" })).toBeNull();
    expect(validateProfileUpdate({ profileId: "", fullName: "Stem Buyer", role: "viewer" })).toBe(
      "User and full name are required."
    );
  });

  it("prevents an administrator from changing their own role", () => {
    expect(
      canChangeProfileRole({ actorId: "one", actorRole: "admin", profileId: "one", requestedRole: "buyer" })
    ).toBe(false);
    expect(
      canChangeProfileRole({ actorId: "one", actorRole: "admin", profileId: "one", requestedRole: "admin" })
    ).toBe(true);
    expect(
      canChangeProfileRole({ actorId: "one", actorRole: "admin", profileId: "two", requestedRole: "buyer" })
    ).toBe(true);
  });

  it("prevents administrators from removing their own access-management capability", () => {
    expect(
      canSetPermission({ actorId: "one", profileId: "one", permission: "manage_user_access", enabled: false })
    ).toBe(false);
    expect(
      canSetPermission({ actorId: "one", profileId: "two", permission: "manage_user_access", enabled: false })
    ).toBe(true);
    expect(
      canSetPermission({ actorId: "one", profileId: "one", permission: "view_settings", enabled: false })
    ).toBe(true);
  });
});
