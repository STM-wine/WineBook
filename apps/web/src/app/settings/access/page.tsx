import { APP_PERMISSIONS, AccountPending, getAppContext, hasPermission, roleDefaultPermissions, type AppPermission } from "@/lib/auth";
import { fetchSettingsOverview } from "@/lib/settings-data";
import { setProfilePermission } from "@/app/settings/actions";
import { UserAccessManager } from "@/components/user-access-manager";

function permissionLabel(permission: AppPermission) {
  return permission.replaceAll("_", " ");
}

export default async function SettingsAccessPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;
  const data = await fetchSettingsOverview(context, { includeProfiles: true });
  const canManage = hasPermission(context.permissions, "manage_user_access");

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>User Access</h1>
        <p className="muted">Capabilities are stored in the database. Publisher rights are not inferred from UI email checks.</p>
      </header>

      <UserAccessManager
        canManage={canManage}
        currentUserId={context.user.id}
        profiles={data.profiles}
      />

      <section className="settings-panel">
        <div className="settings-panel-header">
          <div>
            <h2>Capabilities</h2>
            <p className="muted">Filled role capabilities are included automatically; other capabilities may be granted individually.</p>
          </div>
        </div>
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Capabilities</th>
              </tr>
            </thead>
            <tbody>
              {data.profiles.map((profile) => {
                const effectivePermissions = new Set([...(profile.permissions || []), ...roleDefaultPermissions(profile.role)]);
                return (
                  <tr key={profile.id}>
                    <td>
                      <strong>{profile.full_name || profile.email}</strong>
                      <small>{profile.email}</small>
                    </td>
                    <td>{profile.role}</td>
                    <td>
                      <div className="permission-grid">
                        {APP_PERMISSIONS.map((permission) => {
                          const rolePermission = roleDefaultPermissions(profile.role).includes(permission);
                          const explicitlyGranted = (profile.permissions || []).includes(permission);
                          const checked = effectivePermissions.has(permission);
                          return canManage && !rolePermission ? (
                            <form action={setProfilePermission} key={permission}>
                              <input name="profile_id" type="hidden" value={profile.id} />
                              <input name="permission" type="hidden" value={permission} />
                              <input name="enabled" type="hidden" value={explicitlyGranted ? "false" : "true"} />
                              <button className={checked ? "permission-chip active" : "permission-chip"} type="submit">
                                {permissionLabel(permission)}
                              </button>
                            </form>
                          ) : (
                            <span
                              className={checked ? "permission-chip active role-default" : "permission-chip"}
                              key={permission}
                              title={rolePermission ? `Included with the ${profile.role} role` : undefined}
                            >
                              {permissionLabel(permission)}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
