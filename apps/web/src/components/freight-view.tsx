import { useMemo, useState } from "react";
import type { Recommendation, SupplierLogistics } from "@/lib/types";
import {
  asNumber,
  formatCurrency,
  formatDecimal,
  formatInteger,
  isApproved
} from "@/lib/order-data";
import { buildDiContainerPlans, formatDiPlanRange } from "@/lib/di-planning";
import { MetricCard } from "./metric-card";

type FreightMode = "suggested" | "approved";

type FreightSupplierRollup = {
  supplier: string;
  freightForwarder: string;
  orderFrequency: string;
  skuCount: number;
  quantity: number;
  cases: number;
  wineCost: number;
  laidInCost: number;
  estimatedCost: number;
};

type FreightLocationRollup = {
  location: string;
  supplierCount: number;
  skuCount: number;
  quantity: number;
  cases: number;
  wineCost: number;
  laidInCost: number;
  estimatedCost: number;
  suppliers: FreightSupplierRollup[];
};

function lineQuantity(row: Recommendation, mode: FreightMode): number {
  if (mode === "approved") {
    return isApproved(row) ? Math.max(0, Math.round(asNumber(row.approved_qty))) : 0;
  }

  return Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)));
}

function lineCosts(row: Recommendation, quantity: number) {
  const fob = asNumber(row.fob);
  const laidIn = asNumber(row.trucking_cost_per_bottle);
  const wineCost = fob * quantity;
  const laidInCost = laidIn * quantity;

  return {
    wineCost,
    laidInCost,
    estimatedCost: wineCost + laidInCost
  };
}

export function FreightView({
  rows,
  suppliers
}: {
  rows: Recommendation[];
  suppliers: SupplierLogistics[];
}) {
  const [mode, setMode] = useState<FreightMode>("suggested");
  const [locationFilter, setLocationFilter] = useState("All");

  const supplierLookup = useMemo(() => {
    const lookup = new Map<string, SupplierLogistics>();
    suppliers.forEach((supplier) => lookup.set(supplier.name.trim().toLowerCase(), supplier));
    return lookup;
  }, [suppliers]);

  const freightRows = useMemo(() => {
    const locations = new Map<string, Map<string, FreightSupplierRollup>>();

    rows.forEach((row) => {
      const quantity = lineQuantity(row, mode);
      if (quantity <= 0) return;

      const location = row.pickup_location?.trim() || "Unassigned";
      const supplier = row.supplier_name?.trim() || "Unknown Supplier";
      const logistics = supplierLookup.get(supplier.toLowerCase());
      const { wineCost, laidInCost, estimatedCost } = lineCosts(row, quantity);
      const locationGroup = locations.get(location) || new Map<string, FreightSupplierRollup>();
      const supplierGroup =
        locationGroup.get(supplier) || {
          supplier,
          freightForwarder: logistics?.freight_forwarder || "",
          orderFrequency: logistics?.order_frequency || "",
          skuCount: 0,
          quantity: 0,
          cases: 0,
          wineCost: 0,
          laidInCost: 0,
          estimatedCost: 0
        };

      supplierGroup.skuCount += 1;
      supplierGroup.quantity += quantity;
      supplierGroup.cases += quantity / 12;
      supplierGroup.wineCost += wineCost;
      supplierGroup.laidInCost += laidInCost;
      supplierGroup.estimatedCost += estimatedCost;
      locationGroup.set(supplier, supplierGroup);
      locations.set(location, locationGroup);
    });

    return Array.from(locations.entries())
      .map(([location, suppliersMap]) => {
        const supplierRows = Array.from(suppliersMap.values()).sort(
          (a, b) => b.estimatedCost - a.estimatedCost || a.supplier.localeCompare(b.supplier)
        );
        return {
          location,
          supplierCount: supplierRows.length,
          skuCount: supplierRows.reduce((sum, supplier) => sum + supplier.skuCount, 0),
          quantity: supplierRows.reduce((sum, supplier) => sum + supplier.quantity, 0),
          cases: supplierRows.reduce((sum, supplier) => sum + supplier.cases, 0),
          wineCost: supplierRows.reduce((sum, supplier) => sum + supplier.wineCost, 0),
          laidInCost: supplierRows.reduce((sum, supplier) => sum + supplier.laidInCost, 0),
          estimatedCost: supplierRows.reduce((sum, supplier) => sum + supplier.estimatedCost, 0),
          suppliers: supplierRows
        } satisfies FreightLocationRollup;
      })
      .sort((a, b) => b.estimatedCost - a.estimatedCost || a.location.localeCompare(b.location));
  }, [mode, rows, supplierLookup]);

  const locationOptions = useMemo(
    () => ["All", ...freightRows.map((row) => row.location).sort((a, b) => a.localeCompare(b))],
    [freightRows]
  );
  const visibleRows = useMemo(
    () => freightRows.filter((row) => locationFilter === "All" || row.location === locationFilter),
    [freightRows, locationFilter]
  );

  const california = freightRows.find((row) => row.location.toLowerCase() === "california");
  const caQty = california?.quantity || 0;
  const ftlBottles = 10200;
  const ftlCases = 850;
  const progressPct = Math.min(100, (caQty / ftlBottles) * 100);
  const bottlesNeeded = Math.max(0, ftlBottles - caQty);
  const estimatedSavings = caQty >= ftlBottles ? (caQty / 12) * 2 : 0;
  const totalQuantity = visibleRows.reduce((sum, row) => sum + row.quantity, 0);
  const totalEstimatedCost = visibleRows.reduce((sum, row) => sum + row.estimatedCost, 0);
  const totalLaidInCost = visibleRows.reduce((sum, row) => sum + row.laidInCost, 0);
  const diPlans = useMemo(() => buildDiContainerPlans(rows), [rows]);

  return (
    <section className="panel freight-panel" id="freight">
      <div className="section-heading">
        <div>
          <h1>Freight</h1>
          <p>Roll up ordering pressure by pickup location, supplier, and California truck economics.</p>
        </div>
      </div>
      <div className="freight-controls">
        <div className="segmented-control" aria-label="Freight quantity basis">
          <button className={mode === "suggested" ? "active" : ""} onClick={() => setMode("suggested")} type="button">
            Suggested
          </button>
          <button className={mode === "approved" ? "active" : ""} onClick={() => setMode("approved")} type="button">
            Approved
          </button>
        </div>
        <label>
          Pickup
          <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
            {locationOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="freight-summary">
        <MetricCard label="CA Truck" value={`${formatDecimal(progressPct, 0)}%`} detail={`${formatInteger(caQty)} bottles selected`} tone="blue" />
        <MetricCard label="To Full Truck" value={formatInteger(bottlesNeeded)} detail={`${formatInteger(ftlCases)} cases / ${formatInteger(ftlBottles)} bottles`} tone="gold" />
        <MetricCard label="FTL Savings" value={formatCurrency(estimatedSavings)} detail="$2 per case at threshold" tone="green" />
        <MetricCard label="Visible Qty" value={formatInteger(totalQuantity)} detail={`${mode} bottles`} tone="ink" />
        <MetricCard label="Laid In" value={formatCurrency(totalLaidInCost)} detail="Visible freight cost" tone="plum" />
        <MetricCard label="Order Value" value={formatCurrency(totalEstimatedCost)} detail="Wine + laid in" tone="ink" />
      </div>
      <div className="freight-progress" aria-label="California full-truck progress">
        <span style={{ width: `${progressPct}%` }} />
      </div>
      <DiContainerPlans plans={diPlans} />
      <div className="table-shell freight-location-shell">
        <table>
          <thead>
            <tr>
              <th>Pickup Location</th>
              <th>Suppliers</th>
              <th>SKUs</th>
              <th>Bottles</th>
              <th>Cases</th>
              <th>Total Wine Cost</th>
              <th>Total Laid In Cost</th>
              <th>Estimated Cost</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.location}>
                <td>{row.location}</td>
                <td>{formatInteger(row.supplierCount)}</td>
                <td>{formatInteger(row.skuCount)}</td>
                <td>{formatInteger(row.quantity)}</td>
                <td>{formatDecimal(row.cases, 1)}</td>
                <td>{formatCurrency(row.wineCost)}</td>
                <td>{formatCurrency(row.laidInCost)}</td>
                <td>{formatCurrency(row.estimatedCost)}</td>
              </tr>
            ))}
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty-inline">No freight rows match the current filters.</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="freight-location-stack">
        {visibleRows.map((location) => (
          <details className="freight-location-card" key={location.location}>
            <summary>
              <div>
                <span className="supplier-chip">{location.location}</span>
                <strong>{formatInteger(location.quantity)} bottles</strong>
                <span>{formatCurrency(location.estimatedCost)} estimated</span>
              </div>
              <span>{formatInteger(location.supplierCount)} suppliers</span>
            </summary>
            <div className="table-shell freight-supplier-shell">
              <table>
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Forwarder</th>
                    <th>Frequency</th>
                    <th>SKUs</th>
                    <th>Bottles</th>
                    <th>Cases</th>
                    <th>Total Wine Cost</th>
                    <th>Total Laid In Cost</th>
                    <th>Estimated Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {location.suppliers.map((supplier) => (
                    <tr key={supplier.supplier}>
                      <td>{supplier.supplier}</td>
                      <td>{supplier.freightForwarder || "—"}</td>
                      <td>{supplier.orderFrequency || "—"}</td>
                      <td>{formatInteger(supplier.skuCount)}</td>
                      <td>{formatInteger(supplier.quantity)}</td>
                      <td>{formatDecimal(supplier.cases, 1)}</td>
                      <td>{formatCurrency(supplier.wineCost)}</td>
                      <td>{formatCurrency(supplier.laidInCost)}</td>
                      <td>{formatCurrency(supplier.estimatedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function DiContainerPlans({ plans }: { plans: ReturnType<typeof buildDiContainerPlans> }) {
  return (
    <section className="di-plan-panel" aria-label="Direct Import container plans">
      <div className="section-heading compact-heading">
        <div>
          <h2>DI Container Plans</h2>
          <p>Buyer-selected DI rows only. Containers are grouped by origin port and never mixed across ports.</p>
        </div>
      </div>
      {plans.length === 0 ? (
        <div className="empty-inline">No rows are currently selected for Direct Import planning.</div>
      ) : (
        <div className="di-plan-stack">
          {plans.map((plan) => (
            <details className="di-plan-card" key={plan.containerGroup} open>
              <summary>
                <div>
                  <span className="supplier-chip">{plan.containerGroup}</span>
                  <strong>{plan.originPort}</strong>
                  <span>{formatInteger(plan.totalAllocated)} bottles allocated</span>
                </div>
                <span>Target {formatInteger(plan.targetBottles)} | tolerance {formatDiPlanRange(plan)}</span>
              </summary>
              <div className="table-shell di-plan-table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Wine</th>
                      <th>Brand</th>
                      <th>Share</th>
                      <th>Pack</th>
                      <th>Allocated Qty</th>
                      <th>30d Sales</th>
                      <th>90d Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((row) => (
                      <tr key={row.row.id}>
                        <td>{row.row.product_name || row.row.planning_sku || "Unnamed wine"}</td>
                        <td>{row.brand}</td>
                        <td>{formatDecimal(row.share * 100, 1)}%</td>
                        <td>{formatInteger(row.packSize)}</td>
                        <td>{formatInteger(row.allocatedQty)}</td>
                        <td>{formatInteger(asNumber(row.row.last_30_day_sales))}</td>
                        <td>{formatInteger(asNumber(row.row.last_90_day_sales))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
