"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const [supabase] = useState(createClient);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState("");

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setComplete(true);
    setMessage("Password updated. You can continue to Stem Intelligence.");
    await fetch("/auth/reset-password/complete", { method: "POST" }).catch(() => undefined);
  }

  if (complete) {
    return <div className="auth-card"><p className="form-message form-message-success" role="status">{message}</p><Link className="button invite-login-link" href="/">Continue</Link></div>;
  }

  return (
    <form className="login-form" onSubmit={resetPassword}>
      <label>
        New password
        <input autoComplete="new-password" minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
      </label>
      <label>
        Confirm new password
        <input autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
      </label>
      <button className="button" disabled={loading} type="submit">{loading ? "Updating..." : "Reset password"}</button>
      {message ? <p className="form-message" role="alert">{message}</p> : null}
    </form>
  );
}
