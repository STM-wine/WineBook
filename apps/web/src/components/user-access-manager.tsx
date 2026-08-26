"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteAppUser, updateAppUser, type UserAccessActionResult } from "@/app/settings/actions";
import type { AppProfile } from "@/lib/types";

type Props = {
  canManage: boolean;
  currentUserId: string;
  profiles: AppProfile[];
};

function ResultMessage({ result }: { result: UserAccessActionResult | null }) {
  if (!result) return null;
  return (
    <p className={result.ok ? "form-message form-message-success" : "form-message"} role="status">
      {result.message}
    </p>
  );
}

export function UserAccessManager({ canManage, currentUserId, profiles }: Props) {
  const router = useRouter();
  const inviteForm = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<UserAccessActionResult | null>(null);

  function runAction(action: (formData: FormData) => Promise<UserAccessActionResult>, formData: FormData, reset = false) {
    setResult(null);
    startTransition(async () => {
      const next = await action(formData);
      setResult(next);
      if (next.ok) {
        if (reset) inviteForm.current?.reset();
        router.refresh();
      }
    });
  }

  return (
    <>
      {canManage ? (
        <section className="settings-panel">
          <div className="settings-panel-header">
            <div>
              <h2>Add a user</h2>
              <p className="muted">New accounts receive an email invitation. Existing Supabase accounts are enabled immediately.</p>
            </div>
          </div>
          <form
            className="settings-form"
            ref={inviteForm}
            onSubmit={(event) => {
              event.preventDefault();
              runAction(inviteAppUser, new FormData(event.currentTarget), true);
            }}
          >
            <div className="settings-form-grid user-access-form-grid">
              <label>
                Full name
                <input name="full_name" autoComplete="name" required />
              </label>
              <label>
                Email
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                Role
                <select name="role" defaultValue="buyer">
                  <option value="viewer">Viewer</option>
                  <option value="buyer">Buyer</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button className="button button-small user-access-submit" disabled={isPending} type="submit">
                {isPending ? "Working..." : "Add user"}
              </button>
            </div>
          </form>
          <ResultMessage result={result} />
        </section>
      ) : null}

      <section className="settings-panel">
        <div className="settings-panel-header">
          <div>
            <h2>People</h2>
            <p className="muted">Roles provide baseline capabilities. Individual capabilities can be added below.</p>
          </div>
        </div>
        <div className="settings-table-wrap">
          <table className="settings-table user-access-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Profile</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <td>
                    <strong>{profile.full_name || profile.email}</strong>
                    <small>{profile.email}{profile.id === currentUserId ? " · You" : ""}</small>
                  </td>
                  <td><span className={`user-role-badge role-${profile.role}`}>{profile.role}</span></td>
                  <td>
                    {canManage ? (
                      <form
                        className="user-profile-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          runAction(updateAppUser, new FormData(event.currentTarget));
                        }}
                      >
                        <input name="profile_id" type="hidden" value={profile.id} />
                        <input aria-label={`Full name for ${profile.email}`} name="full_name" defaultValue={profile.full_name || ""} required />
                        <select
                          aria-label={`Role for ${profile.email}`}
                          name="role"
                          defaultValue={profile.role}
                          disabled={profile.id === currentUserId}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="buyer">Buyer</option>
                          <option value="admin">Admin</option>
                        </select>
                        {profile.id === currentUserId ? <input name="role" type="hidden" value={profile.role} /> : null}
                        <button className="button button-tiny" disabled={isPending} type="submit">Save</button>
                      </form>
                    ) : (
                      <span>{profile.full_name || "No name set"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
