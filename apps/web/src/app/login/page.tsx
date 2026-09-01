import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div>
          <img className="login-logo" src="/brand/stem-intelligence-logo-cropped.png" alt="Stem Intelligence" />
          <h1>Sign in</h1>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
