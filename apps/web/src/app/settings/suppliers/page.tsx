import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

type SupplierRow = {
  id: string;
  name: string;
  qb_vendor_name: string | null;
  importer_id: string | null;
  importer_winery_name: string | null;
  eta_days: number | null;
  pick_up_location: string | null;
  active: boolean | null;
};

export default async function SupplierSettingsPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;
  const canManage = hasPermission(context.permissions, "manage_supplier_settings");
  const { data: suppliers, error } = await createServiceRoleClient()
    .from("suppliers")
    .select("id,name,qb_vendor_name,importer_id,importer_winery_name,eta_days,pick_up_location,active")
    .order("name", { ascending: true })
    .returns<SupplierRow[]>();

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>Supplier Settings</h1>
        <p className="muted">
          Durable supplier logistics remain managed in Supplier Hub. Supplier-specific logic overrides are intentionally deferred until there are real recurring exceptions.
        </p>
      </header>

      <section className="settings-panel">
        <div className="settings-panel-header">
          <div>
            <h2>Suppliers from QuickBooks and Vinosmith</h2>
            <p className="muted">After a Vinosmith source refresh, an active QuickBooks vendor with an exact active Vinosmith producer or importer name is added here. Similar names stay for review so existing suppliers are not duplicated.</p>
          </div>
          {canManage ? <a className="button button-small button-outline" href="/?view=supplier-hub">Edit logistics in Supplier Hub</a> : null}
        </div>
        {error ? <p className="muted">Supplier records are temporarily unavailable.</p> : (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead><tr><th>Supplier</th><th>QuickBooks vendor</th><th>Vinosmith importer</th><th>Logistics</th></tr></thead>
              <tbody>
                {(suppliers || []).map((supplier) => (
                  <tr key={supplier.id}>
                    <td><strong>{supplier.name}</strong><small>{supplier.active === false ? "Inactive" : "Active"}</small></td>
                    <td>{supplier.qb_vendor_name || "Not linked"}</td>
                    <td>{supplier.importer_winery_name || (supplier.importer_id ? `Linked (${supplier.importer_id})` : "Not linked")}</td>
                    <td>{supplier.eta_days && supplier.pick_up_location ? "Ready" : "Needs setup"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="settings-panel">
        <h2>V1 Scope</h2>
        <div className="settings-field-grid">
          <article className="settings-field">
            <span>Supplier logistics</span>
            <strong>Supplier Hub</strong>
            <p>ETA, pickup point, freight forwarder, order frequency, TDM, and trucking cost are already durable supplier data.</p>
            <small>{canManage ? "Editable in Supplier Hub today." : "Buyer-visible operational data."}</small>
          </article>
          <article className="settings-field">
            <span>Supplier logic overrides</span>
            <strong>Deferred</strong>
            <p>Durable target/minimum overrides should wait until Mark and Junaid identify suppliers that consistently require different policy.</p>
            <small>The settings schema can support this later without changing global settings.</small>
          </article>
          <article className="settings-field">
            <span>Temporary target weeks</span>
            <strong>Order Review</strong>
            <p>Current-run target-week changes remain buyer scenarios, not durable supplier policy.</p>
            <small>Approved quantities remain the persisted operational decision.</small>
          </article>
        </div>
      </section>
    </>
  );
}
