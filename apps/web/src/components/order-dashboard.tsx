"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deletePurchaseOrderLine,
  saveSupplierLogistics,
  updatePurchaseOrderDraftStatus,
  updateRecommendationOrderPath,
  updateRecommendationApproval
} from "@/app/actions";
import type {
  AppProfile,
  PurchaseOrderDraftWithLines,
  Recommendation,
  ReportRun,
  SupplierLogistics
} from "@/lib/types";
import { applyDiContainerRecommendations } from "@/lib/di-planning";
import {
  asNumber,
  buildMetrics,
  buildSupplierGroups,
  filterRecommendations,
  rowRecommendedQty,
  uniqueSorted
} from "@/lib/order-data";
import { ActiveView, isActiveView, NAV_VIEW_LABELS } from "./dashboard-types";
import { FreightView } from "./freight-view";
import { OrderReviewView } from "./order-review-view";
import { PoDraftsView } from "./po-drafts-view";
import { SignOutButton } from "./sign-out-button";
import { StatusMessages } from "./status-messages";
import { SupplierBoardView } from "./supplier-board-view";
import { SupplierHubView } from "./supplier-hub-view";

type Props = {
  profile: AppProfile;
  reportRun: ReportRun;
  recommendations: Recommendation[];
  poDrafts: PurchaseOrderDraftWithLines[];
  suppliers: SupplierLogistics[];
};

export function OrderDashboard({ profile, reportRun, recommendations, poDrafts, suppliers }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(recommendations);
  const [activeView, setActiveView] = useState<ActiveView>("order-review");
  const [supplier, setSupplier] = useState("All");
  const [brandManager, setBrandManager] = useState("All");
  const [search, setSearch] = useState("");
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [pendingMessage, setPendingMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRows(recommendations);
  }, [recommendations]);

  useEffect(() => {
    const syncViewFromUrl = () => {
      const view = new URLSearchParams(window.location.search).get("view");
      setActiveView(isActiveView(view) ? view : "order-review");
    };

    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    return () => window.removeEventListener("popstate", syncViewFromUrl);
  }, []);

  const displayRows = useMemo(() => applyDiContainerRecommendations(rows), [rows]);
  const supplierOptions = useMemo(
    () => ["All", ...uniqueSorted(displayRows.map((row) => row.supplier_name || "Unknown Supplier"))],
    [displayRows]
  );
  const brandManagerOptions = useMemo(
    () => ["All", ...uniqueSorted(displayRows.map((row) => row.brand_manager))],
    [displayRows]
  );
  const visibleRecommendations = useMemo(
    () => filterRecommendations(displayRows, { supplier, brandManager, search, suggestedOnly }),
    [displayRows, supplier, brandManager, search, suggestedOnly]
  );
  const metrics = useMemo(() => buildMetrics(visibleRecommendations), [visibleRecommendations]);
  const supplierGroups = useMemo(() => buildSupplierGroups(visibleRecommendations), [visibleRecommendations]);
  const allSupplierGroups = useMemo(() => buildSupplierGroups(displayRows), [displayRows]);
  const dataDate = reportRun.report_date || "Latest run";

  function selectView(view: ActiveView) {
    setActiveView(view);
    const url = new URL(window.location.href);
    if (view === "order-review") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", view);
    }
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function patchRow(id: string, patch: Partial<Recommendation>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function saveApproval(row: Recommendation, approved: boolean, qtyOverride?: number) {
    const suggestedQty = asNumber(row.recommended_qty_rounded);
    const qty = approved ? Math.max(0, Math.round(qtyOverride ?? rowRecommendedQty(row))) : 0;
    const status = approved ? (qty !== suggestedQty ? "edited" : "approved") : "rejected";

    patchRow(row.id, {
      recommendation_status: status,
      approved_qty: qty
    });
    setPendingMessage("Saving...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await updateRecommendationApproval({
          id: row.id,
          recommendationStatus: status,
          approvedQty: qty
        });
        setPendingMessage("Saved");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not save recommendation.");
        setPendingMessage("");
      }
    });
  }

  function setWorkingQty(row: Recommendation, qty: number) {
    patchRow(row.id, { approved_qty: Math.max(0, Math.round(qty)) });
  }

  function saveWorkingQty(row: Recommendation, qty: number) {
    const checked = row.recommendation_status === "approved" || row.recommendation_status === "edited";
    if (checked) {
      saveApproval({ ...row, approved_qty: qty }, true, qty);
    }
  }

  function saveOrderPath(row: Recommendation, orderPath: "stateside" | "di") {
    patchRow(row.id, { order_path: orderPath });
    setPendingMessage("Saving order path...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await updateRecommendationOrderPath({ id: row.id, orderPath });
        setPendingMessage("Order path saved");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not save order path.");
        setPendingMessage("");
      }
    });
  }

  function createDrafts() {
    setPendingMessage("Creating PO drafts...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/po-drafts/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportRunId: reportRun.id })
        });
        const result = (await response.json()) as {
          created?: string[];
          skipped?: string[];
          errors?: string[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(result.error || "Could not create PO drafts.");
        }

        const createdList = result.created || [];
        const skippedList = result.skipped || [];
        const errorList = result.errors || [];
        const created = createdList.length;
        const skipped = skippedList.length;
        const errors = errorList.length;

        if (errors) {
          setErrorMessage(errorList.join("; "));
        }
        if (created) {
          setPendingMessage(`Draft created: ${created.toLocaleString()} supplier PO draft(s).`);
        } else if (skipped && !errors) {
          setPendingMessage("PO drafts already exist for approved supplier lines.");
        } else {
          setPendingMessage("No approved quantities are ready for PO drafts.");
        }
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not create PO drafts.");
        setPendingMessage("");
      }
    });
  }

  function changeDraftStatus(draftId: string, status: string) {
    setPendingMessage("Updating PO draft...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await updatePurchaseOrderDraftStatus({ id: draftId, status });
        setPendingMessage("PO draft updated");
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not update PO draft.");
        setPendingMessage("");
      }
    });
  }

  function removeDraftLine(lineId: string, draftId: string) {
    setPendingMessage("Removing PO draft line...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await deletePurchaseOrderLine({ id: lineId, draftId });
        setPendingMessage("PO draft line removed");
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not remove PO draft line.");
        setPendingMessage("");
      }
    });
  }

  function saveSupplier(row: SupplierLogistics) {
    setPendingMessage("Saving supplier logistics...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await saveSupplierLogistics({
          id: row.id?.startsWith("new-") ? undefined : row.id,
          name: row.name,
          importerId: row.importer_id || undefined,
          etaDays: asNumber(row.eta_days),
          pickUpLocation: row.pick_up_location || undefined,
          freightForwarder: row.freight_forwarder || undefined,
          orderFrequency: row.order_frequency || undefined,
          tdm: row.tdm || undefined,
          truckingCostPerBottle: asNumber(row.trucking_cost_per_bottle),
          notes: row.notes || undefined,
          active: row.active ?? true
        });
        setPendingMessage("Supplier logistics saved");
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not save supplier logistics.");
        setPendingMessage("");
      }
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <img alt="" src="/brand/stem-intelligence-logo-cropped.png" />
          </div>
          <div>
            <strong>Stem Intelligence</strong>
            <span>{profile.full_name || profile.email}</span>
          </div>
        </div>
        <nav className="nav-tabs" aria-label="Primary">
          {NAV_VIEW_LABELS.map((view) => (
            <button
              key={view.id}
              className={activeView === view.id ? "active" : ""}
              onClick={() => selectView(view.id)}
              type="button"
            >
              {view.label}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className="data-pill">Data Date {dataDate}</span>
          <button className="button button-small" onClick={createDrafts} disabled={isPending}>
            Create PO Drafts
          </button>
          <SignOutButton />
        </div>
      </header>

      <StatusMessages errorMessage={errorMessage} pendingMessage={isPending ? pendingMessage || "Working..." : pendingMessage} />

      {activeView === "order-review" ? (
        <OrderReviewView
          brandManager={brandManager}
          brandManagerOptions={brandManagerOptions}
          expandAll={expandAll}
          metrics={metrics}
          search={search}
          setBrandManager={setBrandManager}
          setExpandAll={setExpandAll}
          setSearch={setSearch}
          setSuggestedOnly={setSuggestedOnly}
          setSupplier={setSupplier}
          suggestedOnly={suggestedOnly}
          supplier={supplier}
          supplierGroups={supplierGroups}
          supplierOptions={supplierOptions}
          visibleCount={visibleRecommendations.length}
          onSaveApproval={saveApproval}
          onSaveOrderPath={saveOrderPath}
          onSaveWorkingQty={saveWorkingQty}
          onSetWorkingQty={setWorkingQty}
        />
      ) : null}

      {activeView === "supplier-hub" ? (
        <SupplierHubView suppliers={suppliers} isPending={isPending} onSaveSupplier={saveSupplier} />
      ) : null}

      {activeView === "supplier-board" ? <SupplierBoardView groups={allSupplierGroups} /> : null}

      {activeView === "freight" ? <FreightView rows={displayRows} suppliers={suppliers} /> : null}

      {activeView === "po-drafts" ? (
        <PoDraftsView
          drafts={poDrafts}
          isPending={isPending}
          reportRunId={reportRun.id}
          suppliers={suppliers}
          onCreateDrafts={createDrafts}
          onDeleteLine={removeDraftLine}
          onStatusChange={changeDraftStatus}
        />
      ) : null}
    </main>
  );
}
