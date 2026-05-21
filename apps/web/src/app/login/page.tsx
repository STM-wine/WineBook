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
          <p className="eyebrow">WineBook</p>
          <h1>Sign in to Stem ordering</h1>
          <p className="muted">
            Use a Stem-approved account to review supplier recommendations, approve order quantities,
            and draft purchase orders.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
