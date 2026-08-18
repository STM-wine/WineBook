export default function DataHealthLoading() {
  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>Data Health</h1>
        <p className="muted">Loading source health diagnostics...</p>
      </header>
      <section className="settings-panel data-health-loading-panel" aria-label="Loading Data Health">
        <div className="data-health-loading-pulse" />
        <div>
          <h2>Checking source mirrors</h2>
          <p className="muted">QuickBooks, Vinosmith, Supplier Logistics, and the ordering bridge are being checked.</p>
        </div>
      </section>
    </>
  );
}
