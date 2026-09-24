import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseOrderDraftWithLines, PurchaseOrderLine, PurchaseOrderLineNote, SupplierLogistics } from "@/lib/types";
import { auditActorName, formatAuditTimestamp, poDraftAuditTrail } from "@/lib/audit-trail";
import { asNumber, formatCurrency, formatCurrencyCents, formatInteger } from "@/lib/order-data";
import { isActivePoStatus } from "@/lib/po-status";
import {
  poDraftOrderPath,
  poLineCollaborationKey,
  poLineCosts,
  poOrderPathLabel,
  supplierLaidInForDraft,
  supplierLogisticsLookup
} from "@/lib/po-utils";

export function PoDraftsView({
  drafts,
  isPending,
  reportRunId,
  suppliers,
  auditActorNames,
  onAddLineNote,
  onCancelDrafts,
  onDeleteLine,
  onStatusChange
}: {
  drafts: PurchaseOrderDraftWithLines[];
  isPending: boolean;
  reportRunId: string;
  suppliers: SupplierLogistics[];
  auditActorNames: Record<string, string>;
  onAddLineNote: (lineId: string, body: string) => Promise<void>;
  onCancelDrafts: (draftIds: string[]) => void;
  onDeleteLine: (lineId: string, draftId: string) => void;
  onStatusChange: (draftId: string, status: string) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(() => new Set());
  const [exportStatus, setExportStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const [noteTarget, setNoteTarget] = useState<{ draftId: string; lineKey: string } | null>(null);
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
      if (statusFilter === "active" && !isActivePoStatus(draft.status)) return false;
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
    () => draftSummaries.map(({ draft }) => draft).filter((draft) => isActivePoStatus(draft.status)),
    [draftSummaries]
  );
  const exportableDraftIds = useMemo(() => new Set(exportableDrafts.map((draft) => draft.id)), [exportableDrafts]);
  const filteredSelectableDraftIds = useMemo(
    () => filteredSummaries.map(({ draft }) => draft).filter((draft) => isActivePoStatus(draft.status)).map((draft) => draft.id),
    [filteredSummaries]
  );
  const selectedExportableDrafts = useMemo(
    () => exportableDrafts.filter((draft) => selectedDraftIds.has(draft.id)),
    [exportableDrafts, selectedDraftIds]
  );
  const selectedDraftIdList = selectedExportableDrafts.map((draft) => draft.id);
  const allFilteredSelected =
    filteredSelectableDraftIds.length > 0 && filteredSelectableDraftIds.every((id) => selectedDraftIds.has(id));
  const selectedCount = selectedExportableDrafts.length;
  const noteDraft = noteTarget ? drafts.find((draft) => draft.id === noteTarget.draftId) : undefined;
  const noteLine = (noteDraft?.lines || []).find((line) => poLineCollaborationKey(line) === noteTarget?.lineKey);

  useEffect(() => {
    setSelectedDraftIds((current) => {
      const next = new Set(Array.from(current).filter((id) => exportableDraftIds.has(id)));
      if (next.size === current.size && Array.from(current).every((id) => next.has(id))) {
        return current;
      }
      return next;
    });
  }, [exportableDraftIds]);

  function toggleDraftSelection(draftId: string, checked: boolean) {
    setSelectedDraftIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(draftId);
      } else {
        next.delete(draftId);
      }
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedDraftIds((current) => {
      const next = new Set(current);
      for (const draftId of filteredSelectableDraftIds) {
        if (checked) {
          next.add(draftId);
        } else {
          next.delete(draftId);
        }
      }
      return next;
    });
  }

  async function downloadExport(
    format: "xlsx" | "csv",
    scope: "single" | "selected" | "all",
    draftIds: string[] = []
  ) {
    setExporting(true);
    setExportStatus("Generating and auditing export...");
    try {
      const response = await fetch("/api/po-drafts/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportRunId, draftIds, format, scope })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "PO export failed.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `PO export.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportStatus(`Generated ${filename}. The exact draft revision was recorded.`);
      router.refresh();
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "PO export failed.");
    } finally {
      setExporting(false);
    }
  }

  function cancelDrafts(ids: string[], label: string) {
    if (ids.length === 0) return;
    if (!window.confirm(`Are you sure you want to cancel ${ids.length.toLocaleString()} ${label} PO draft${ids.length === 1 ? "" : "s"}? They will disappear from Active Drafts, but their audit history will be retained. Entered drafts will not be changed.`)) return;
    onCancelDrafts(ids);
    setSelectedDraftIds((current) => new Set(Array.from(current).filter((id) => !ids.includes(id))));
  }

  return (
    <>
    <section className="panel po-panel" id="po-drafts">
      <div className="section-heading">
        <div>
          <h1>PO Drafts</h1>
          <p>Drafts created from approved lines in the current report run.</p>
        </div>
        <div className="po-export-all-actions">
          <button
            className="ghost-button remove-line-button"
            disabled={selectedCount === 0 || isPending}
            onClick={() => cancelDrafts(selectedDraftIdList, "selected")}
            type="button"
          >
            Cancel Selected
          </button>
          <button
            className="ghost-button remove-line-button"
            disabled={exportableDrafts.length === 0 || isPending}
            onClick={() => cancelDrafts(exportableDrafts.map((draft) => draft.id), "active")}
            type="button"
          >
            Cancel All Active
          </button>
          <button
            className="button button-small"
            disabled={selectedCount === 0 || exporting}
            onClick={() => void downloadExport("xlsx", "selected", selectedDraftIdList)}
            type="button"
          >
            Export Selected PO XLSX
          </button>
          <button className="button button-small" disabled={selectedCount === 0 || exporting} onClick={() => void downloadExport("csv", "selected", selectedDraftIdList)} type="button">
            Export Selected PO CSV
          </button>
          <button
            className="button button-small"
            disabled={exportableDrafts.length === 0 || exporting}
            onClick={() => void downloadExport("xlsx", "all")}
            type="button"
          >
            Export ALL PO XLSX
          </button>
          <button className="button button-small" disabled={exportableDrafts.length === 0 || exporting} onClick={() => void downloadExport("csv", "all")} type="button">
            Export ALL PO CSV
          </button>
        </div>
      </div>
      {exportStatus ? <p className="muted" role="status">{exportStatus}</p> : null}
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
        <label className="check-control po-select-all-control">
          <input
            checked={allFilteredSelected}
            disabled={filteredSelectableDraftIds.length === 0}
            onChange={(event) => toggleSelectAll(event.target.checked)}
            type="checkbox"
          />
          <span>Select All</span>
        </label>
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
          {filteredSummaries.map(({ draft, lineCount, approvedQty, wineCost, laidInCost, estimatedCost }) => {
            const isExportable = isActivePoStatus(draft.status);
            const activity = poDraftAuditTrail(draft, auditActorNames);

            return (
            <details className="po-draft-card" key={draft.id}>
              <summary>
                <div className="po-draft-summary-main">
                  <input
                    aria-label={`Select ${draft.supplier_name || "Unknown Supplier"} PO draft`}
                    checked={selectedDraftIds.has(draft.id)}
                    disabled={!isExportable}
                    onChange={(event) => toggleDraftSelection(draft.id, event.target.checked)}
                    onClick={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                  <span className="supplier-chip">{draft.supplier_name || "Unknown Supplier"}</span>
                  <span className={poDraftOrderPath(draft) === "di" ? "order-path-chip is-di" : "order-path-chip"}>
                    {poOrderPathLabel(poDraftOrderPath(draft))}
                  </span>
                  <strong>{formatInteger(approvedQty)} bottles</strong>
                  <span>{formatCurrency(estimatedCost || wineCost + laidInCost)} estimated</span>
                </div>
                <div className="po-draft-summary-meta">
                  <span>{draft.status.replaceAll("_", " ")} · revision {formatInteger(Number(draft.revision_no) || 1)} · {formatInteger(lineCount)} lines</span>
                  <small className="buyer-activity-line">
                    {activity[0]?.label} · {formatAuditTimestamp(activity[0]?.at || draft.created_at)} · {activity[0]?.actor}
                  </small>
                </div>
              </summary>
              <div className="po-draft-actions">
                <DraftStatusActions draft={draft} disabled={isPending} onStatusChange={onStatusChange} />
                {isExportable ? (
                  <>
                    <button
                      className="button button-tiny"
                      disabled={exporting}
                      onClick={() => void downloadExport("xlsx", "single", [draft.id])}
                      type="button"
                    >
                      Export XLSX
                    </button>
                    <button
                      className="button button-tiny"
                      disabled={exporting}
                      onClick={() => void downloadExport("csv", "single", [draft.id])}
                      type="button"
                    >
                      Export CSV
                    </button>
                  </>
                ) : null}
              </div>
              <div className="po-draft-activity" aria-label="PO draft activity">
                {activity.map((item) => (
                  <span className="buyer-activity-line" key={item.key} title={item.at}>
                    {item.label} · {formatAuditTimestamp(item.at)} · {item.actor}
                  </span>
                ))}
              </div>
              <SupplierDraftMetadata supplier={supplierMetadata.get((draft.supplier_name || "").trim().toLowerCase())} />
              <PoDraftLinesTable
                draft={draft}
                disabled={isPending}
                fallbackLaidInPerBottle={supplierLaidInForDraft(draft, supplierMetadata)}
                onDeleteLine={onDeleteLine}
                onOpenNotes={(line) => setNoteTarget({ draftId: draft.id, lineKey: poLineCollaborationKey(line) })}
              />
            </details>
            );
          })}
          {filteredSummaries.length === 0 ? <div className="empty-inline">No PO drafts match the current filters.</div> : null}
        </div>
      )}
    </section>
    {noteDraft && noteLine ? (
      <PoLineNotesDialog
        actorNames={auditActorNames}
        draft={noteDraft}
        line={noteLine}
        onClose={() => setNoteTarget(null)}
        onSave={onAddLineNote}
      />
    ) : null}
    </>
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
  onDeleteLine,
  onOpenNotes
}: {
  draft: PurchaseOrderDraftWithLines;
  disabled: boolean;
  fallbackLaidInPerBottle: number;
  onDeleteLine: (lineId: string, draftId: string) => void;
  onOpenNotes: (line: PurchaseOrderLine) => void;
}) {
  return (
    <div className="table-shell po-lines-shell">
      <table>
        <thead>
          <tr>
            <th>Wine</th>
            <th>Code</th>
            <th>Item</th>
            <th>Quantity</th>
            <th>FOB</th>
            <th>Laid In / Bottle</th>
            <th>Total Wine Cost</th>
            <th>Total Laid In Cost</th>
            <th>Estimated Cost</th>
            <th>Internal Notes</th>
            <th>Remove</th>
          </tr>
        </thead>
        <tbody>
          {(draft.lines || []).map((line) => {
            const { qty, fob, laidIn, wineCost, laidInCost, estimatedCost } = poLineCosts(line, fallbackLaidInPerBottle);
            const lineKey = poLineCollaborationKey(line);
            const notes = (draft.line_notes || [])
              .filter((note) => note.line_key === lineKey)
              .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
            const latestNote = notes[notes.length - 1];

            return (
              <tr className={line.is_new_item ? "new-item-row" : undefined} key={line.id}>
                <td>
                  {line.product_name || "Unnamed wine"}
                  {line.is_new_item ? <span className="new-item-badge">New Item</span> : null}
                </td>
                <td>{line.product_code || ""}</td>
                <td>{line.is_new_item ? line.new_item_warning || "QuickBooks Item Number required." : ""}</td>
                <td>{formatInteger(qty)}</td>
                <td>{formatCurrency(fob)}</td>
                <td>{formatCurrencyCents(laidIn)}</td>
                <td>{formatCurrency(wineCost)}</td>
                <td>{formatCurrency(laidInCost)}</td>
                <td>{formatCurrency(estimatedCost)}</td>
                <td>
                  <div className="po-line-note-cell">
                    <button className="ghost-button po-line-note-button" onClick={() => onOpenNotes(line)} type="button">
                      {notes.length > 0 ? `Notes (${formatInteger(notes.length)})` : "Add Note"}
                    </button>
                    {latestNote ? <small title={latestNote.body}>{latestNote.body}</small> : null}
                  </div>
                </td>
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

function PoLineNotesDialog({
  actorNames,
  draft,
  line,
  onClose,
  onSave
}: {
  actorNames: Record<string, string>;
  draft: PurchaseOrderDraftWithLines;
  line: PurchaseOrderLine;
  onClose: () => void;
  onSave: (lineId: string, body: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lineKey = poLineCollaborationKey(line);
  const notes = useMemo(
    () => (draft.line_notes || [])
      .filter((note) => note.line_key === lineKey)
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)),
    [draft.line_notes, lineKey]
  );
  const canAddNote = isActivePoStatus(draft.status);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = body.trim();
    if (!note) {
      setError("Write a note before saving.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(line.id, note);
      setBody("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the SKU note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="new-item-edit-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <div className="new-item-edit-dialog po-line-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="po-line-notes-title">
        <div className="new-item-edit-header">
          <div>
            <p className="eyebrow">Internal collaboration</p>
            <h2 id="po-line-notes-title">SKU Notes</h2>
            <p>{line.product_name || "Unnamed wine"} · {line.product_code || line.planning_sku || "No item number"}</p>
          </div>
          <button aria-label="Close SKU notes" className="ghost-button" disabled={saving} onClick={onClose} type="button">Close</button>
        </div>

        <p className="po-line-notes-internal-callout">Internal only. Notes are permanent and attributed; they are never included in supplier XLSX or CSV exports.</p>

        <div className="po-line-notes-thread" aria-live="polite">
          {notes.length > 0 ? notes.map((note: PurchaseOrderLineNote) => (
            <article className="po-line-note" key={note.id}>
              <div>
                <strong>{auditActorName(note.created_by, actorNames)}</strong>
                <time dateTime={note.created_at}>{formatAuditTimestamp(note.created_at)}</time>
              </div>
              <p>{note.body}</p>
            </article>
          )) : <p className="muted">No internal notes for this SKU yet.</p>}
        </div>

        {canAddNote ? (
          <form className="po-line-note-form" onSubmit={submit}>
            <label htmlFor="po-line-note-body">Add a note</label>
            <textarea
              autoFocus
              id="po-line-note-body"
              maxLength={2000}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Add context for the other buyers or AP..."
              rows={4}
              value={body}
            />
            <div className="po-line-note-form-footer">
              <small>{body.length.toLocaleString()} / 2,000</small>
              <button className="button button-small" disabled={saving || !body.trim()} type="submit">
                {saving ? "Saving..." : "Add Note"}
              </button>
            </div>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </form>
        ) : (
          <p className="muted">This PO draft is complete. Its collaboration notes are read-only.</p>
        )}
      </div>
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
          onClick={() => {
            if (!window.confirm(
              "Mark this PO as entered in QuickBooks? This records its current revision as an immutable commitment. Later quantity changes will create a delta or correction."
            )) return;
            onStatusChange(draft.id, "entered_in_quickbooks");
          }}
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
