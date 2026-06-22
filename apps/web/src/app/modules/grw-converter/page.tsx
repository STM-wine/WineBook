import { AppTopbar } from "@/components/app-topbar";
import { GrwConverterUploader } from "@/components/grw-converter-uploader";
import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";

export default async function GrwConverterPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) {
    return <AccountPending email={context.pendingEmail} />;
  }

  return (
    <main className="app-shell module-page">
      <AppTopbar activeModule="grw-converter" canViewSettings={hasPermission(context.permissions, "view_settings")} />

      <section className="module-header">
        <p className="eyebrow">Modules</p>
        <h1>GRW Converter</h1>
        <p className="muted">Convert GRW invoice PDFs into Stem-ready PO import files.</p>
      </section>

      <GrwConverterUploader />
    </main>
  );
}
