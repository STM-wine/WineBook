"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AccountMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setMessageTone("error");

    if (newPassword.length < 8) {
      setMessage("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("New passwords do not match.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setMessageTone("success");
    setMessage("Password updated.");
  }

  return (
    <div className="account-menu" ref={menuRef}>
      <button className="ghost-button account-menu-trigger" onClick={() => setIsOpen((current) => !current)} type="button">
        Account
      </button>
      {isOpen ? (
        <div className="account-menu-panel">
          <h2>Change password</h2>
          <form className="account-password-form" onSubmit={changePassword}>
            <label>
              New password
              <input
                autoComplete="new-password"
                minLength={8}
                required
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Confirm new password
              <input
                autoComplete="new-password"
                minLength={8}
                required
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <button className="button button-small" disabled={loading} type="submit">
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
          {message ? <p className={messageTone === "success" ? "form-message form-message-success" : "form-message"}>{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
