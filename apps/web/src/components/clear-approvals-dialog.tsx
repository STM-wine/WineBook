"use client";
import { useEffect, useRef, useState } from "react";
import { clearOrderApprovals, previewClearOrderApprovals } from "@/app/actions";
import { flushAllApprovals } from "@/lib/approval-navigation";
import type { ApprovalClearPreview, ApprovalClearScope } from "@/lib/clear-order-approvals";
import { formatInteger } from "@/lib/order-data";

export function ClearApprovalsDialog({ scope, onClose, onCleared }: {
  scope: ApprovalClearScope; onClose: () => void; onCleared: (count: number) => void;
}) {
  const [preview, setPreview] = useState<ApprovalClearPreview | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    void flushAllApprovals().then(() => previewClearOrderApprovals(scope))
      .then(result => { if (active) setPreview(result); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "Could not load saved approvals."); });
    return () => { active = false; trigger?.focus(); };
  }, [scope]);
  async function confirm() {
    if (!preview || saving || error) return;
    setSaving(true);
    try {
      await flushAllApprovals();
      const result = await clearOrderApprovals(preview);
      onCleared(result.cleared);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not clear approvals."); }
    finally { setSaving(false); }
  }
  return <div className="new-item-edit-overlay" role="presentation">
    <section className="new-item-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-approvals-title"
      onKeyDown={event => {
        if (event.key === "Escape" && !saving) onClose();
        if (event.key === "Tab") {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const first = buttons[0], last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <h2 id="clear-approvals-title">{scope.supplier ? `Clear approved orders for ${scope.supplier}?` : "Clear approved orders for all suppliers?"}</h2>
      {preview ? <p>{preview.rows.length ? `${formatInteger(preview.rows.length)} saved ${preview.rows.length === 1 ? "approval" : "approvals"} · ${formatInteger(preview.bottles)} bottles · ${formatInteger(preview.supplierCount)} ${preview.supplierCount === 1 ? "supplier" : "suppliers"}` : "There are no saved approvals to clear."}</p> : !error ? <p role="status">Checking saved approvals…</p> : null}
      <p>{scope.supplier ? "This includes all wines in this supplier’s workbench, even if hidden by filters." : "This includes all suppliers in the current ordering run, even if hidden by filters or not opened."}</p>
      <p>Existing PO drafts and order history stay unchanged. Use Create PO Drafts afterward if you also want to update the open drafts.</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="clear-approval-actions">
        <button className="ghost-button" disabled={saving} onClick={onClose} ref={cancel} type="button">Cancel</button>
        <button className="ghost-button clear-approvals-button" disabled={saving || !preview?.rows.length || Boolean(error)} onClick={() => void confirm()} type="button">{saving ? "Clearing…" : "Clear approved orders"}</button>
      </div>
    </section>
  </div>;
}
