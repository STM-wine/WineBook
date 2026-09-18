"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    window.location.href = "/";
  }

  async function sendSignInLink() {
    if (!email) {
      setMessage("Enter your email address first.");
      return;
    }

    setLoading(true);
    setMessage("");
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
        shouldCreateUser: false
      }
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Check your email for a fresh sign-in link.");
  }

  return (
    <div className="auth-card">
      <form onSubmit={signInWithPassword} className="login-form">
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
          />
        </label>
        <button className="button" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <div className="divider">or</div>
        <button className="button button-secondary" disabled={loading} onClick={sendSignInLink} type="button">
          Email me a sign-in link
        </button>
      </form>
      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
