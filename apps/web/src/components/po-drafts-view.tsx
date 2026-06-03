import { useMemo, useState } from "react";
import type { PurchaseOrderDraftWithLines, SupplierLogistics } from "@/lib/types";
import { asNumber, formatCurrency, formatCurrencyCents, formatInteger } from "@/lib/order-data";
import {
  poDraftOrderPath,
  poDraftSupplierLabel,
  poLineCosts,
  poOrderPathLabel,
  poTimestamp,
  supplierLaidInForDraft,
  supplierLogisticsLookup
} from "@/lib/po-utils";

function csvEscape(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function poCsvText(draft: PurchaseOrderDraftWithLines, fallbackLaidInPerBottle = 0): string {
  const headers = [
    "Supplier",
    "Wine",
    "Code",
    "Quantity",
    "FOB",
    "Laid In Cost",
    "Total Wine Cost",
    "Total Laid In Cost",
    "Estimated Cost"
  ];
  const rows = (draft.lines || []).map((line) => {
    const { qty, fob, laidIn, wineCost, laidInCost, estimatedCost } = poLineCosts(line, fallbackLaidInPerBottle);

    return [
      poDraftSupplierLabel(draft),
      line.product_name || "",
      line.product_code || "",
      qty,
      fob.toFixed(2),
      laidIn.toFixed(4),
      wineCost.toFixed(2),
      laidInCost.toFixed(2),
      estimatedCost.toFixed(2)
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  return csv;
}

function allPoCsvText(drafts: PurchaseOrderDraftWithLines[], suppliers: Map<string, SupplierLogistics>): string {
  const headers = [
    "Supplier",
    "Wine",
    "Code",
    "Quantity",
    "FOB",
    "Laid In Cost",
    "Total Wine Cost",
    "Total Laid In Cost",
    "Estimated Cost"
  ];
  const rows = drafts.flatMap((draft) => {
    const fallbackLaidInPerBottle = supplierLaidInForDraft(draft, suppliers);

    return (draft.lines || []).map((line) => {
      const { qty, fob, laidIn, wineCost, laidInCost, estimatedCost } = poLineCosts(line, fallbackLaidInPerBottle);

      return [
        poDraftSupplierLabel(draft),
        line.product_name || "",
        line.product_code || "",
        qty,
        fob.toFixed(2),
        laidIn.toFixed(4),
        wineCost.toFixed(2),
        laidInCost.toFixed(2),
        estimatedCost.toFixed(2)
      ];
    });
  });

  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function poCsvFilename(draft: PurchaseOrderDraftWithLines): string {
  const supplier = poDraftSupplierLabel(draft)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
  return `PO ${supplier || "supplier"} ${stamp}.csv`;
}

function poXlsxFilename(draft: PurchaseOrderDraftWithLines): string {
  const supplier = poDraftSupplierLabel(draft)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `PO ${supplier || "supplier"} ${poTimestamp()}.xlsx`;
}

export function PoDraftsView({
  drafts,
  isPending,
  reportRunId,
  suppliers,
  onDeleteLine,
  onStatusChange
}: {
  drafts: PurchaseOrderDraftWithLines[];
  isPending: boolean;
  reportRunId: string;
  suppliers: SupplierLogistics[];
  onDeleteLine: (lineId: string, draftId: string) => void;
  onStatusChange: (draftId: string, status: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const supplierMetadata = useMemo(() => supplierLogisticsLookup(suppliers), [suppliers]);
  const draftSummaries = useMemo(() => drafts.map((draft) => {
    const lines = draft.lines || [];
    const fallbackLaidIn = supplierLaidInForDraft(draft, supplierMetadata);
    const costs = lines.map((line) => poLineCosts(line, fallbackLaidIn));
    const approvedQty = costs.reduce((sum, cost) => sum + cost.qty, 0);
    const wineCost = costs.reduce((sum, cost) => sum + cost.wineCost, 0);
    const laidInCost = costs.reduce((sum, cost) => sum + cost.laidInCost, 0);
    const estimatedCost = costs.reduce((sum, cost) => sum + cost.estimatedCost, 0);
    return {
      draft,
      lineCount: lines.length,
      approvedQty,
      wineCost,
      laidInCost,
      estimatedCost
    };
  }), [drafts, supplierMetadata]);
  const filteredSummaries = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return draftSummaries.filter(({ draft }) => {
      if (statusFilter === "active" && !["draft", "ready_for_entry"].includes(draft.status)) return false;
      if (statusFilter !== "all" && statusFilter !== "active" && draft.status !== statusFilter) return false;
      if (!needle) return true;

      return [
        draft.supplier_name,
        draft.status,
        draft.po_number,
        ...(draft.lines || []).flatMap((line) => [line.product_name, line.product_code, line.planning_sku])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [draftSummaries, search, statusFilter]);
  const totalLines = filteredSummaries.reduce((sum, summary) => sum + summary.lineCount, 0);
  const totalBottles = filteredSummaries.reduce((sum, summary) => sum + summary.approvedQty, 0);
  const totalWineCost = filteredSummaries.reduce((sum, summary) => sum + summary.wineCost, 0);
  const totalLaidInCost = filteredSummaries.reduce((sum, summary) => sum + summary.laidInCost, 0);
  const totalEstimatedCost = filteredSummaries.reduce((sum, summary) => sum + (summary.estimatedCost || summary.wineCost + summary.laidInCost), 0);
  const exportableDrafts = useMemo(
    () => draftSummaries.map(({ draft }) => draft).filter((draft) => draft.status !== "cancelled"),
    [draftSummaries]
  );

  function downloadCsv(draft: PurchaseOrderDraftWithLines) {
    const blob = new Blob([poCsvText(draft, supplierLaidInForDraft(draft, supplierMetadata))], {
      type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = poCsvFilename(draft);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadAllCsv() {
    const blob = new Blob([allPoCsvText(exportableDrafts, supplierMetadata)], {
      type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `POs ${poTimestamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel po-panel" id="po-drafts">
      <div className="section-heading">
        <div>
          <h1>PO Drafts</h1>
          <p>Drafts created from approved lines in the current report run.</p>
        </div>
        <div className="po-export-all-actions">
          <a
            className={exportableDrafts.length === 0 ? "button button-small disabled-link" : "button button-small"}
            download={`POs ${poTimestamp()}.xlsx`}
            href={`/api/po-drafts/xlsx?reportRunId=${encodeURIComponent(reportRunId)}`}
            aria-disabled={exportableDrafts.length === 0}
          >
            Export ALL PO XLSX
          </a>
          <button className="button button-small" disabled={exportableDrafts.length === 0} onClick={downloadAllCsv} type="button">
            Export ALL PO CSV
          </button>
        </div>
      </div>
      <div className="po-summary-grid">
        <div>
          <span>Drafts</span>
          <strong>{formatInteger(filteredSummaries.length)}</strong>
        </div>
        <div>
          <span>Lines</span>
          <strong>{formatInteger(totalLines)}</strong>
        </div>
        <div>
          <span>Bottles</span>
          <strong>{formatInteger(totalBottles)}</strong>
        </div>
        <div>
          <span>Wine Cost</span>
          <strong>{formatCurrency(totalWineCost)}</strong>
        </div>
        <div>
          <span>Laid In Cost</span>
          <strong>{formatCurrency(totalLaidInCost)}</strong>
        </div>
        <div>
          <span>Estimated</span>
          <strong>{formatCurrency(totalEstimatedCost)}</strong>
        </div>
      </div>
      <div className="po-filter-bar">
        <label className="search-field">
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Supplier, wine, item number"
          />
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="active">Active Drafts</option>
            <option value="draft">Draft</option>
            <option value="ready_for_entry">Ready for Entry</option>
            <option value="entered_in_quickbooks">Entered in QuickBooks</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>
      {draftSummaries.length === 0 ? (
        <div className="empty-inline">No PO drafts exist for this report run yet.</div>
      ) : (
        <div className="po-draft-stack">
          {filteredSummaries.map(({ draft, lineCount, approvedQty, wineCost, laidInCost, estimatedCost }) => (
            <details className="po-draft-card" key={draft.id}>
              <summary>
                <div>
                  <span className="supplier-chip">{draft.supplier_name || "Unknown Supplier"}</span>
                  <span className={poDraftOrderPath(draft) === "di" ? "order-path-chip is-di" : "order-path-chip"}>
                    {poOrderPathLabel(poDraftOrderPath(draft))}
                  </span>
                  <strong>{formatInteger(approvedQty)} bottles</strong>
                  <span>{formatCurrency(estimatedCost || wineCost + laidInCost)} estimated</span>
                </div>
                <span>
                  {draft.status.replaceAll("_", " ")} | {formatInteger(lineCount)} lines
                </span>
              </summary>
              <div className="po-draft-actions">
                <DraftStatusActions draft={draft} disabled={isPending} onStatusChange={onStatusChange} />
                <a
                  className="button button-tiny"
                  download={poXlsxFilename(draft)}
                  href={`/api/po-drafts/xlsx?reportRunId=${encodeURIComponent(reportRunId)}&draftId=${encodeURIComponent(draft.id)}`}
                >
                  Export XLSX
                </a>
                <button
                  className="button button-tiny"
                  onClick={() => downloadCsv(draft)}
                  type="button"
                >
                  Export CSV
                </button>
              </div>
              <SupplierDraftMetadata supplier={supplierMetadata.get((draft.supplier_name || "").trim().toLowerCase())} />
              <PoDraftLinesTable
                draft={draft}
                disabled={isPending}
                fallbackLaidInPerBottle={supplierLaidInForDraft(draft, supplierMetadata)}
                onDeleteLine={onDeleteLine}
              />
            </details>
          ))}
          {filteredSummaries.length === 0 ? <div className="empty-inline">No PO drafts match the current filters.</div> : null}
        </div>
      )}
    </section>
  );
}

function SupplierDraftMetadata({ supplier }: { supplier?: SupplierLogistics }) {
  if (!supplier) return null;

  const details = [
    supplier.pick_up_location ? `Pickup: ${supplier.pick_up_location}` : "",
    supplier.eta_days ? `ETA: ${supplier.eta_days} days` : "",
    supplier.freight_forwarder ? `Forwarder: ${supplier.freight_forwarder}` : "",
    asNumber(supplier.trucking_cost_per_bottle) > 0
      ? `Laid In: ${formatCurrencyCents(asNumber(supplier.trucking_cost_per_bottle))}/bottle`
      : ""
  ].filter(Boolean);

  if (details.length === 0) return null;

  return <div className="po-draft-metadata">{details.map((detail) => <span key={detail}>{detail}</span>)}</div>;
}

function PoDraftLinesTable({
  draft,
  disabled,
  fallbackLaidInPerBottle,
  onDeleteLine
}: {
  draft: PurchaseOrderDraftWithLines;
  disabled: boolean;
  fallbackLaidInPerBottle: number;
  onDeleteLine: (lineId: string, draftId: string) => void;
}) {
  return (
    <div className="table-shell po-lines-shell">
      <table>
        <thead>
          <tr>
            <th>Wine</th>
            <th>Code</th>
            <th>Quantity</th>
            <th>FOB</th>
            <th>Laid In / Bottle</th>
            <th>Total Wine Cost</th>
            <th>Total Laid In Cost</th>
            <th>Estimated Cost</th>
            <th>Remove</th>
          </tr>
        </thead>
        <tbody>
          {(draft.lines || []).map((line) => {
            const { qty, fob, laidIn, wineCost, laidInCost, estimatedCost } = poLineCosts(line, fallbackLaidInPerBottle);

            return (
              <tr key={line.id}>
                <td>{line.product_name || "Unnamed wine"}</td>
                <td>{line.product_code || ""}</td>
                <td>{formatInteger(qty)}</td>
                <td>{formatCurrency(fob)}</td>
                <td>{formatCurrencyCents(laidIn)}</td>
                <td>{formatCurrency(wineCost)}</td>
                <td>{formatCurrency(laidInCost)}</td>
                <td>{formatCurrency(estimatedCost)}</td>
                <td>
                  <button
                    className="ghost-button remove-line-button"
                    disabled={disabled}
                    onClick={() => onDeleteLine(line.id, draft.id)}
                    type="button"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DraftStatusActions({
  draft,
  disabled,
  onStatusChange
}: {
  draft: PurchaseOrderDraftWithLines;
  disabled: boolean;
  onStatusChange: (draftId: string, status: string) => void;
}) {
  if (draft.status === "draft") {
    return (
      <>
        <button className="button button-tiny" disabled={disabled} onClick={() => onStatusChange(draft.id, "ready_for_entry")}>
          Mark Ready
        </button>
        <button className="ghost-button remove-line-button" disabled={disabled} onClick={() => onStatusChange(draft.id, "cancelled")}>
          Cancel Draft
        </button>
      </>
    );
  }

  if (draft.status === "ready_for_entry") {
    return (
      <>
        <button
          className="button button-tiny"
          disabled={disabled}
          onClick={() => onStatusChange(draft.id, "entered_in_quickbooks")}
        >
          Mark Entered
        </button>
        <button className="ghost-button remove-line-button" disabled={disabled} onClick={() => onStatusChange(draft.id, "cancelled")}>
          Cancel Draft
        </button>
      </>
    );
  }

  return <span className="muted">Complete</span>;
}
