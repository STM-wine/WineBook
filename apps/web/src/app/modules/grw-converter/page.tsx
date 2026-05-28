import { redirect } from "next/navigation";
import { AppTopbar } from "@/components/app-topbar";
import { GrwConverterUploader } from "@/components/grw-converter-uploader";
import { createClient } from "@/lib/supabase/server";
import type { AppProfile } from "@/lib/types";

export default async function GrwConverterPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("app_profiles")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .maybeSingle<AppProfile>();

  if (!profile) {
    return (
      <main className="empty-state">
        <section>
          <p className="eyebrow">Stem Intelligence</p>
          <h1>Account pending</h1>
          <p className="muted">
            You are signed in as {user.email}, but this account is not enabled in Stem Intelligence yet.
            Add a matching row to Supabase app_profiles to grant access.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell module-page">
      <AppTopbar activeModule="grw-converter" profileLabel={profile.full_name || profile.email} />

      <section className="module-header">
        <p className="eyebrow">Modules</p>
        <h1>GRW Converter</h1>
        <p className="muted">Convert GRW invoice PDFs into Stem-ready PO import files.</p>
      </section>

      <GrwConverterUploader />
    </main>
  );
}
