import { AppTopbar } from "@/components/app-topbar";
import { SupplierOfferCompilerView } from "@/components/supplier-offer-compiler/supplier-offer-compiler-view";
import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";

export default async function SupplierOfferCompilerPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) {
    return <AccountPending email={context.pendingEmail} />;
  }

  return (
    <main className="app-shell module-page">
      <AppTopbar activeModule="supplier-offer-compiler" canViewSettings={hasPermission(context.permissions, "view_settings")} />

      <section className="module-header">
        <p className="eyebrow">Modules</p>
        <h1>Supplier Offer Compiler</h1>
        <p className="muted">Compile messy supplier CSV/XLSX offers into evidence-backed, reviewed supplier offer candidates.</p>
      </section>

      <SupplierOfferCompilerView />
    </main>
  );
}
