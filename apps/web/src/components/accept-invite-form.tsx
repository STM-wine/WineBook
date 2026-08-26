"use client";

import { FormEvent, useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type InviteState = "checking" | "ready" | "saving" | "complete" | "invalid";

export function AcceptInviteForm() {
  const [supabase] = useState(createClient);
  const [state, setState] = useState<InviteState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("Checking your invitation...");

  useEffect(() => {
    let active = true;

    async function establishInviteSession() {
      const url = new URL(window.location.href);
      const linkError = url.searchParams.get("error_description") || url.searchParams.get("error");
      if (linkError) {
        if (active) {
          setState("invalid");
          setMessage(linkError.replaceAll("+", " "));
        }
        return;
      }

      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type") as EmailOtpType | null;
      let error: { message: string } | null = null;

      if (code) {
        ({ error } = await supabase.auth.exchangeCodeForSession(code));
      } else if (tokenHash && type === "invite") {
        ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
      }

      if (error) {
        if (active) {
          setState("invalid");
          setMessage(error.message);
        }
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !data.session) {
        setState("invalid");
        setMessage(sessionError?.message || "This invitation is invalid or has expired. Ask an administrator for a new invitation.");
        return;
      }

      window.history.replaceState({}, document.title, url.pathname);
      setState("ready");
      setMessage("");
    }

    void establishInviteSession();
    return () => {
      active = false;
    };
  }, [supabase]);

  async function setInitialPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setState("saving");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setState("ready");
      setMessage(error.message);
      return;
    }

    setState("complete");
    setMessage("Your account is ready. Opening Stem Intelligence...");
    window.setTimeout(() => {
      window.location.assign("/");
    }, 700);
  }

  if (state === "checking" || state === "invalid") {
    return (
      <div className="auth-card">
        <p className={state === "invalid" ? "form-message" : "muted"} role="status">{message}</p>
        {state === "invalid" ? <a className="button button-outline invite-login-link" href="/login">Return to sign in</a> : null}
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={setInitialPassword}>
      <label>
        New password
        <input
          autoComplete="new-password"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <label>
        Confirm password
        <input
          autoComplete="new-password"
          minLength={8}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          type="password"
          value={confirmPassword}
        />
      </label>
      <button className="button" disabled={state === "saving" || state === "complete"} type="submit">
        {state === "saving" ? "Saving..." : state === "complete" ? "Account ready" : "Set password"}
      </button>
      {message ? <p className={state === "complete" ? "form-message form-message-success" : "form-message"} role="status">{message}</p> : null}
    </form>
  );
}
