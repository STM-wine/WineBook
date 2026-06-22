import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";

export default async function SupplierSettingsPage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;
  const canManage = hasPermission(context.permissions, "manage_supplier_settings");

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
