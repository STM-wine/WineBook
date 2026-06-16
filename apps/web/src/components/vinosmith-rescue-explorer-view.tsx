"use client";

import { useMemo, useState } from "react";
import type {
  VinosmithExplorerAccount,
  VinosmithExplorerData,
  VinosmithExplorerInventory,
  VinosmithExplorerPriceSummary,
  VinosmithExplorerWine
} from "@/lib/types";
import { asNumber, formatCurrency, formatInteger, uniqueSorted } from "@/lib/order-data";
import { MetricCard } from "./metric-card";

type ExplorerArea = "health" | "wines" | "accounts" | "orders";

const AREAS: Array<{ id: ExplorerArea; label: string }> = [
  { id: "health", label: "Health" },
  { id: "wines", label: "Wine Catalog" },
  { id: "accounts", label: "Accounts" },
  { id: "orders", label: "Order History" }
];

export function VinosmithRescueExplorerView({ data }: { data: VinosmithExplorerData }) {
  const [activeArea, setActiveArea] = useState<ExplorerArea>("health");
  const [wineSearch, setWineSearch] = useState("");
  const [wineSupplier, setWineSupplier] = useState("All");
  const [accountSearch, setAccountSearch] = useState("");
  const [orderSearch, setOrderSearch] = useState("");

  const inventoryByWine = useMemo(() => new Map(data.inventory.map((row) => [row.wine_id, row])), [data.inventory]);
  const pricesByWine = useMemo(() => new Map(data.priceSummaries.map((row) => [row.wine_id, row])), [data.priceSummaries]);
  const contactsByAccount = useMemo(() => countBy(data.contacts, "account_id"), [data.contacts]);
  const repsByAccount = useMemo(() => countBy(data.salesReps, "account_id"), [data.salesReps]);
  const supplierOptions = useMemo(
    () => ["All", ...uniqueSorted(data.wines.map((wine) => wine.importer_name || "Unknown Supplier"))],
    [data.wines]
  );

  const filteredWines = useMemo(() => {
    const query = wineSearch.trim().toLowerCase();
    return data.wines
      .filter((wine) => wineSupplier === "All" || (wine.importer_name || "Unknown Supplier") === wineSupplier)
      .filter((wine) => {
        if (!query) return true;
        return [wine.name, wine.code, wine.vintage, wine.importer_name, wine.producer_name, wine.region, wine.category]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 250);
  }, [data.wines, wineSearch, wineSupplier]);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    return data.accounts
      .filter((account) => {
        if (!query) return true;
        return [account.name, account.code, account.status, account.kind, account.shipping_city, account.shipping_state]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 250);
  }, [accountSearch, data.accounts]);

  const filteredOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    return data.recentOrders.filter((order) => {
      if (!query) return true;
      return [order.supplier_order_id, order.account_name, order.user_full_name, order.invoice_number, order.po_number, order.delivery_status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [data.recentOrders, orderSearch]);

  const visibleWineInventory = useMemo(
    () => filteredWines.reduce((total, wine) => total + (inventoryByWine.has(wine.wine_id) ? 1 : 0), 0),
    [filteredWines, inventoryByWine]
  );

  return (
    <section className="panel rescue-explorer-panel" id="vinosmith-rescue">
      <div className="section-heading">
        <div>
          <h1>Vinosmith Rescue Explorer</h1>
          <p>Read-only operational view of rescued Vinosmith wines, accounts, orders, and sync health.</p>
        </div>
        <span className="data-pill">Read Only</span>
      </div>

      {data.error ? <div className="error-banner">{data.error}</div> : null}

      <section className="metric-grid rescue-metrics">
        <MetricCard label="Wine Identities" value={formatInteger(data.counts.wines)} detail={`${formatOptionalInteger(data.counts.latestWinesResponse)} latest /wines`} tone="green" />
        <MetricCard label="Inventory Wines" value={formatInteger(data.counts.latestInventoryWines)} detail={data.latestInventorySnapshotDate || "Latest snapshot"} tone="blue" />
        <MetricCard label="Accounts" value={formatInteger(data.counts.accounts)} detail={`${formatInteger(data.counts.contacts)} contacts`} tone="gold" />
        <MetricCard label="Orders" value={formatInteger(data.counts.orders)} detail={`${formatInteger(data.counts.orderLines)} lines`} tone="plum" />
        <MetricCard label="Prices" value={formatInteger(data.counts.prices)} detail="Rescued price rows" tone="ink" />
        <MetricCard label="Prearrivals" value={formatInteger(data.counts.prearrivals)} detail="Endpoint currently empty" tone="red" />
      </section>

      <div className="supplier-hub-tabs rescue-tabs" role="tablist" aria-label="Vinosmith Rescue Explorer areas">
        {AREAS.map((area) => (
          <button
            key={area.id}
            className={activeArea === area.id ? "active" : undefined}
            onClick={() => setActiveArea(area.id)}
            type="button"
          >
            {area.label}
          </button>
        ))}
      </div>

      {activeArea === "health" ? <HealthPanel data={data} /> : null}
      {activeArea === "wines" ? (
        <WineCatalogPanel
          inventoryByWine={inventoryByWine}
          pricesByWine={pricesByWine}
          search={wineSearch}
          setSearch={setWineSearch}
          setSupplier={setWineSupplier}
          supplier={wineSupplier}
          supplierOptions={supplierOptions}
          visibleInventoryCount={visibleWineInventory}
          wines={filteredWines}
          totalMatches={data.wines.length}
        />
      ) : null}
      {activeArea === "accounts" ? (
        <AccountsPanel
          accounts={filteredAccounts}
          contactsByAccount={contactsByAccount}
          repsByAccount={repsByAccount}
          search={accountSearch}
          setSearch={setAccountSearch}
          totalAccounts={data.accounts.length}
        />
      ) : null}
      {activeArea === "orders" ? (
        <OrdersPanel orders={filteredOrders} search={orderSearch} setSearch={setOrderSearch} totalOrders={data.counts.orders} />
      ) : null}
    </section>
  );
}

function HealthPanel({ data }: { data: VinosmithExplorerData }) {
  const failedRuns = data.syncRuns.filter((run) => run.status === "failed").length;
  const incompleteCheckpoints = data.checkpoints.filter((checkpoint) => checkpoint.status !== "completed").length;

  return (
    <div className="rescue-grid rescue-grid-two">
      <section className="rescue-card">
        <h2>Coverage</h2>
        <dl className="rescue-definition-grid">
          <div>
            <dt>Latest inventory rows</dt>
            <dd>{formatInteger(data.counts.latestInventoryRows)}</dd>
          </div>
          <div>
            <dt>Wine identities with inventory</dt>
            <dd>{formatPercent(data.counts.latestInventoryWines, data.counts.wines)}</dd>
          </div>
          <div>
            <dt>Account contacts</dt>
            <dd>{formatInteger(data.counts.contacts)}</dd>
          </div>
          <div>
            <dt>Sales rep links</dt>
            <dd>{formatInteger(data.counts.salesReps)}</dd>
          </div>
          <div>
            <dt>Failed recent syncs</dt>
            <dd>{formatInteger(failedRuns)}</dd>
          </div>
          <div>
            <dt>Open checkpoints</dt>
            <dd>{formatInteger(incompleteCheckpoints)}</dd>
          </div>
        </dl>
      </section>

      <section className="rescue-card">
        <h2>Recent Sync Runs</h2>
        <div className="rescue-list">
          {data.syncRuns.slice(0, 8).map((run) => (
            <div className="rescue-list-row" key={run.id}>
              <div>
                <strong>{run.sync_type}</strong>
                <span>{formatDateTime(run.completed_at || run.started_at)}</span>
              </div>
              <span className={`status-pill status-${run.status}`}>{run.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rescue-card rescue-card-wide">
        <h2>Checkpoints</h2>
        <div className="table-shell compact-table">
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Checkpoint</th>
                <th>Status</th>
                <th>Synced</th>
              </tr>
            </thead>
            <tbody>
              {data.checkpoints.map((checkpoint) => (
                <tr key={`${checkpoint.resource_name}-${checkpoint.checkpoint_key}`}>
                  <td>{checkpoint.resource_name}</td>
                  <td>{checkpoint.checkpoint_key}</td>
                  <td>{checkpoint.status}</td>
                  <td>{formatDateTime(checkpoint.last_synced_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function WineCatalogPanel({
  inventoryByWine,
  pricesByWine,
  search,
  setSearch,
  setSupplier,
  supplier,
  supplierOptions,
  visibleInventoryCount,
  wines,
  totalMatches
}: {
  inventoryByWine: Map<string, VinosmithExplorerInventory>;
  pricesByWine: Map<string, VinosmithExplorerPriceSummary>;
  search: string;
  setSearch: (value: string) => void;
  setSupplier: (value: string) => void;
  supplier: string;
  supplierOptions: string[];
  visibleInventoryCount: number;
  wines: VinosmithExplorerWine[];
  totalMatches: number;
}) {
  return (
    <section className="rescue-workspace">
      <div className="filter-bar">
        <label>
          Supplier
          <select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
            {supplierOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="search-field">
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Wine, code, producer, region" />
        </label>
        <span className="result-count">
          {formatInteger(wines.length)} shown, {formatInteger(visibleInventoryCount)} with inventory
        </span>
      </div>

      <div className="table-shell rescue-table-shell">
        <table>
          <thead>
            <tr>
              <th>Wine</th>
              <th>Supplier</th>
              <th>Producer</th>
              <th>Pack</th>
              <th>FOB</th>
              <th>Available</th>
              <th>Prices</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {wines.map((wine) => {
              const inventory = inventoryByWine.get(wine.wine_id);
              const price = pricesByWine.get(wine.wine_id);
              return (
                <tr key={wine.wine_id}>
                  <td>
                    <strong>{wine.name || "Unnamed wine"}</strong>
                    <span className="muted-line">{[wine.code, wine.vintage, wine.region].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td>{wine.importer_name || "Unknown"}</td>
                  <td>{wine.producer_name || "—"}</td>
                  <td>{[formatNumber(wine.unit_set), wine.bottle_size_label || wine.bottle_size].filter(Boolean).join("/")}</td>
                  <td>{formatMoneyValue(wine.fob_price)}</td>
                  <td>{inventory ? formatNumber(inventory.available) : "—"}</td>
                  <td>{price ? `${formatInteger(price.prices)} (${formatInteger(price.activePrices)} active)` : "—"}</td>
                  <td>
                    <FlagList wine={wine} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {wines.length < totalMatches ? <p className="muted rescue-footnote">Showing first {formatInteger(wines.length)} filtered wines for browser speed.</p> : null}
    </section>
  );
}

function AccountsPanel({
  accounts,
  contactsByAccount,
  repsByAccount,
  search,
  setSearch,
  totalAccounts
}: {
  accounts: VinosmithExplorerAccount[];
  contactsByAccount: Map<string, number>;
  repsByAccount: Map<string, number>;
  search: string;
  setSearch: (value: string) => void;
  totalAccounts: number;
}) {
  return (
    <section className="rescue-workspace">
      <div className="filter-bar">
        <label className="search-field">
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Account, city, status, code" />
        </label>
        <span className="result-count">
          {formatInteger(accounts.length)} shown of {formatInteger(totalAccounts)}
        </span>
      </div>
      <div className="table-shell rescue-table-shell">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Status</th>
              <th>Type</th>
              <th>Location</th>
              <th>Contacts</th>
              <th>Sales Reps</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.account_id}>
                <td>
                  <strong>{account.name || "Unnamed account"}</strong>
                  <span className="muted-line">{account.code || account.account_id}</span>
                </td>
                <td>{account.status || "—"}</td>
                <td>{account.kind || "—"}</td>
                <td>{[account.shipping_city, account.shipping_state].filter(Boolean).join(", ") || "—"}</td>
                <td>{formatInteger(contactsByAccount.get(account.account_id) || 0)}</td>
                <td>{formatInteger(repsByAccount.get(account.account_id) || 0)}</td>
                <td>{account.phone_number || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrdersPanel({
  orders,
  search,
  setSearch,
  totalOrders
}: {
  orders: VinosmithExplorerData["recentOrders"];
  search: string;
  setSearch: (value: string) => void;
  totalOrders: number;
}) {
  const totalVisible = orders.reduce((sum, order) => sum + (order.total_cents || 0), 0);

  return (
    <section className="rescue-workspace">
      <div className="filter-bar">
        <label className="search-field">
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Account, invoice, rep, status" />
        </label>
        <span className="result-count">
          {formatInteger(orders.length)} recent orders, {formatCurrency(totalVisible / 100)}
        </span>
      </div>
      <div className="table-shell rescue-table-shell">
        <table>
          <thead>
            <tr>
              <th>Delivery</th>
              <th>Account</th>
              <th>Rep</th>
              <th>Invoice</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.supplier_order_id}>
                <td>
                  <strong>{formatDate(order.delivery_at)}</strong>
                  <span className="muted-line">{order.supplier_order_id}</span>
                </td>
                <td>{order.account_name || order.account_id || "—"}</td>
                <td>{order.user_full_name || "—"}</td>
                <td>{order.invoice_number || order.po_number || "—"}</td>
                <td>{order.delivery_status || "—"}</td>
                <td>{order.payment_status || "—"}</td>
                <td>{formatCurrency((order.total_cents || 0) / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted rescue-footnote">Showing {formatInteger(orders.length)} most recent rescued orders from {formatInteger(totalOrders)} total.</p>
    </section>
  );
}

function FlagList({ wine }: { wine: VinosmithExplorerWine }) {
  const flags = [
    wine.core ? "Core" : null,
    wine.active === false ? "Inactive" : null,
    wine.orderable === false ? "Not orderable" : null,
    wine.inventory_item === false ? "No inventory" : null
  ].filter(Boolean);
  if (!flags.length) return <span className="muted">—</span>;
  return (
    <span className="rescue-flags">
      {flags.map((flag) => (
        <span key={flag}>{flag}</span>
      ))}
    </span>
  );
}

function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = String(row[key] || "");
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return counts;
}

function formatOptionalInteger(value: number | null) {
  return typeof value === "number" ? formatInteger(value) : "unknown";
}

function formatPercent(value: number, total: number) {
  if (!total) return "0.00%";
  return `${((value / total) * 100).toFixed(2)}%`;
}

function formatNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? formatInteger(number) : String(value);
}

function formatMoneyValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const number = asNumber(value);
  return number ? formatCurrency(number) : "—";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
