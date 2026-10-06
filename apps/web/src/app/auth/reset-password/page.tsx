import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "@/components/reset-password-form";

export default async function ResetPasswordPage() {
  const recoveryCookie = (await cookies()).get("stem_password_recovery");
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  const canReset = recoveryCookie?.value === "1" && !!user && !error;

  return (
    <main className="login-page">
      <section className="login-panel">
        <div>
          <img className="login-logo" src="/brand/stem-intelligence-logo-cropped.png" alt="Stem Intelligence" />
          <p className="eyebrow">Account recovery</p>
          <h1>Reset your password</h1>
          <p className="muted">{canReset ? "Choose a new password for your account." : "This reset link is invalid or has expired. Request a new link from the sign-in page."}</p>
        </div>
        {canReset ? <ResetPasswordForm /> : <div className="auth-card"><Link className="button button-outline invite-login-link" href="/login">Return to sign in</Link></div>}
      </section>
    </main>
  );
}
