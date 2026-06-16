"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSupplierWineRequest,
  deletePurchaseOrderLine,
  refreshVinosmithReports,
  saveSupplierCatalogWine,
  saveSupplierLogistics,
  updateSupplierWineRequestApproval,
  updatePurchaseOrderDraftStatus,
  updateRecommendationOrderPath,
  updateRecommendationApprovals
} from "@/app/actions";
import type {
  PriceChangeEvent,
  PurchaseOrderDraftWithLines,
  Recommendation,
  ReportRun,
  SupplierCatalogWine,
  VinosmithExplorerData,
  WineRequest,
  SupplierLogistics
} from "@/lib/types";
import { applyDiContainerRecommendations } from "@/lib/di-planning";
import {
  applySupplierTargetWeeks,
  asNumber,
  buildMetrics,
  buildSupplierGroups,
  filterRecommendations,
  sortSupplierGroups,
  type SupplierGroupSortMode,
  rowRecommendedQty,
  uniqueSorted
} from "@/lib/order-data";
import { AppTopbar } from "./app-topbar";
import { ActiveView, isActiveView } from "./dashboard-types";
import { FreightView } from "./freight-view";
import { OrderReviewView } from "./order-review-view";
import { PoDraftsView } from "./po-drafts-view";
import { StatusMessages } from "./status-messages";
import { SupplierBoardView } from "./supplier-board-view";
import { SupplierHubView } from "./supplier-hub-view";
import { VinosmithRescueExplorerView } from "./vinosmith-rescue-explorer-view";

type Props = {
  reportRun: ReportRun;
  recommendations: Recommendation[];
  poDrafts: PurchaseOrderDraftWithLines[];
  suppliers: SupplierLogistics[];
  supplierCatalogWines: SupplierCatalogWine[];
  vinosmithExplorer: VinosmithExplorerData;
  wineRequests: WineRequest[];
  priceChangeEvents: PriceChangeEvent[];
};

function formatReportUpdatedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function OrderDashboard({
  reportRun,
  recommendations,
  poDrafts,
  suppliers,
  supplierCatalogWines,
  vinosmithExplorer,
  wineRequests,
  priceChangeEvents
}: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(recommendations);
  const [draftRows, setDraftRows] = useState(poDrafts);
  const [activeView, setActiveView] = useState<ActiveView>("order-review");
  const [supplier, setSupplier] = useState("All");
  const [brandManager, setBrandManager] = useState("All");
  const [search, setSearch] = useState("");
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [supplierSort, setSupplierSort] = useState<SupplierGroupSortMode>("default");
  const [supplierTargetWeeks, setSupplierTargetWeeks] = useState<Record<string, string>>({});
  const [pendingMessage, setPendingMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const approvalQueueRef = useRef(new Map<string, { recommendationStatus: string; approvedQty: number }>());
  const approvalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvalFlushRef = useRef<Promise<void> | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRows(recommendations);
  }, [recommendations]);

  useEffect(() => {
    setDraftRows(poDrafts);
  }, [poDrafts]);

  useEffect(() => {
    const syncViewFromUrl = () => {
      const view = new URLSearchParams(window.location.search).get("view");
      setActiveView(isActiveView(view) ? view : "order-review");
    };

    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    return () => window.removeEventListener("popstate", syncViewFromUrl);
  }, []);

  const parsedSupplierTargetWeeks = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(supplierTargetWeeks)
          .map(([supplierName, value]) => [supplierName, Number(value)] as const)
          .filter(([, value]) => Number.isFinite(value) && value > 0)
      ),
    [supplierTargetWeeks]
  );
  const displayRows = useMemo(
    () => applySupplierTargetWeeks(applyDiContainerRecommendations(rows), parsedSupplierTargetWeeks),
    [parsedSupplierTargetWeeks, rows]
  );
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
  const supplierGroups = useMemo(
    () => sortSupplierGroups(buildSupplierGroups(visibleRecommendations), supplierSort),
    [supplierSort, visibleRecommendations]
  );
  const allSupplierGroups = useMemo(() => buildSupplierGroups(displayRows), [displayRows]);
  const dataUpdatedAt = formatReportUpdatedAt(reportRun.completed_at);
  const dataLabel = dataUpdatedAt ? `Data Updated ${dataUpdatedAt}` : `Data Date ${reportRun.report_date || "Latest run"}`;
  const dataTitle = reportRun.report_date
    ? `Report date ${reportRun.report_date}${dataUpdatedAt ? `, completed ${dataUpdatedAt}` : ""}`
    : undefined;

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

  async function flushApprovalQueue() {
    if (approvalTimerRef.current) {
      clearTimeout(approvalTimerRef.current);
      approvalTimerRef.current = null;
    }
    if (approvalFlushRef.current) {
      await approvalFlushRef.current;
      return;
    }

    const updates = Array.from(approvalQueueRef.current.entries()).map(([id, value]) => ({ id, ...value }));
    approvalQueueRef.current.clear();
    if (updates.length === 0) return;

    approvalFlushRef.current = updateRecommendationApprovals({ updates })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Could not save approvals.");
        throw error;
      })
      .finally(() => {
        approvalFlushRef.current = null;
      });

    await approvalFlushRef.current;
  }

  function queueApprovalSave(id: string, recommendationStatus: string, approvedQty: number) {
    approvalQueueRef.current.set(id, { recommendationStatus, approvedQty });
    if (approvalTimerRef.current) {
      clearTimeout(approvalTimerRef.current);
    }
    approvalTimerRef.current = setTimeout(() => {
      void flushApprovalQueue();
    }, 650);
  }

  function setSupplierTargetWeeksValue(supplierName: string, value: string) {
    setSupplierTargetWeeks((current) => {
      const next = { ...current };
      if (!value.trim()) {
        delete next[supplierName];
      } else {
        next[supplierName] = value;
      }
      return next;
    });
  }

  function saveApproval(row: Recommendation, approved: boolean, qtyOverride?: number) {
    const suggestedQty = asNumber(row.recommended_qty_rounded);
    const qty = approved ? Math.max(0, Math.round(qtyOverride ?? rowRecommendedQty(row))) : 0;
    const status = approved ? (qty !== suggestedQty ? "edited" : "approved") : "rejected";

    patchRow(row.id, {
      recommendation_status: status,
      approved_qty: qty
    });
    setPendingMessage("");
    setErrorMessage("");

    queueApprovalSave(row.id, status, qty);
  }

  function clearSupplierApprovals(supplierName: string) {
    const supplierRows = displayRows.filter((row) => (row.supplier_name?.trim() || "Unknown Supplier") === supplierName);
    const approvedRows = supplierRows.filter((row) => row.recommendation_status === "approved" || row.recommendation_status === "edited");
    if (approvedRows.length === 0) return;

    setRows((current) =>
      current.map((row) =>
        (row.supplier_name?.trim() || "Unknown Supplier") === supplierName &&
        (row.recommendation_status === "approved" || row.recommendation_status === "edited")
          ? { ...row, recommendation_status: "rejected", approved_qty: 0 }
          : row
      )
    );
    setErrorMessage("");
    approvedRows.forEach((row) => queueApprovalSave(row.id, "rejected", 0));
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
    const nextRows = rows.map((current) => (current.id === row.id ? { ...current, order_path: orderPath } : current));
    const nextDisplayRow = applyDiContainerRecommendations(nextRows).find((current) => current.id === row.id);
    const isApprovedRow = row.recommendation_status === "approved" || row.recommendation_status === "edited";
    const approvedQty = isApprovedRow ? Math.max(0, Math.round(asNumber(nextDisplayRow?.recommended_qty_rounded))) : undefined;
    const recommendationStatus = isApprovedRow ? "approved" : undefined;

    patchRow(row.id, {
      order_path: orderPath,
      ...(approvedQty !== undefined ? { approved_qty: approvedQty, recommendation_status: recommendationStatus } : {})
    });
    setPendingMessage("Saving order path...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await updateRecommendationOrderPath({
          id: row.id,
          orderPath,
          approvedQty,
          recommendationStatus
        });
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
        await flushApprovalQueue();
        const response = await fetch("/api/po-drafts/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportRunId: reportRun.id })
        });
        const result = (await response.json()) as {
          created?: string[];
          updated?: string[];
          skipped?: string[];
          errors?: string[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(result.error || "Could not create PO drafts.");
        }

        const createdList = result.created || [];
        const updatedList = result.updated || [];
        const skippedList = result.skipped || [];
        const errorList = result.errors || [];
        const created = createdList.length;
        const updated = updatedList.length;
        const skipped = skippedList.length;
        const errors = errorList.length;

        if (errors) {
          setErrorMessage(errorList.join("; "));
        }
        if (created) {
          setPendingMessage(`Draft created: ${created.toLocaleString()} supplier PO draft(s).`);
        } else if (updated) {
          setPendingMessage(`Draft updated: ${updated.toLocaleString()} supplier PO draft(s).`);
        } else if (skipped && !errors) {
          setPendingMessage("PO drafts are already current for approved supplier lines.");
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

  function refreshReports() {
    setPendingMessage("Queueing Vinosmith report refresh...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await flushApprovalQueue();
        const result = await refreshVinosmithReports();
        if (!result.ok) {
          setErrorMessage(result.error);
          setPendingMessage("");
          return;
        }
        setPendingMessage(
          `Refresh queued for ${result.reportDate}. New report emails will be ingested as soon as GitHub Actions runs.`
        );
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not queue Vinosmith report refresh.");
        setPendingMessage("");
      }
    });
  }

  function changeDraftStatus(draftId: string, status: string) {
    setPendingMessage("Updating PO draft...");
    setErrorMessage("");
    const previousDraft = draftRows.find((draft) => draft.id === draftId);

    setDraftRows((current) =>
      current.map((draft) =>
        draft.id === draftId ? { ...draft, status, updated_at: new Date().toISOString() } : draft
      )
    );

    startTransition(async () => {
      try {
        await updatePurchaseOrderDraftStatus({ id: draftId, status });
        setPendingMessage("PO draft updated");
      } catch (error) {
        if (previousDraft) {
          setDraftRows((current) => current.map((draft) => (draft.id === draftId ? previousDraft : draft)));
        }
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

  function saveCatalogWine(input: Parameters<typeof saveSupplierCatalogWine>[0]) {
    setPendingMessage("Saving supplier wine...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        const result = await saveSupplierCatalogWine(input);
        const changeText = result.priceChangeCreated ? " Price-change draft created." : "";
        setPendingMessage(
          `${result.mode === "updated" ? "Updated" : "Created"} supplier wine: ${result.displayName}.${changeText}`
        );
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not save supplier wine.");
        setPendingMessage("");
      }
    });
  }

  function createWineRequest(input: Parameters<typeof createSupplierWineRequest>[0]) {
    setPendingMessage("Saving wine request...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        const result = await createSupplierWineRequest(input);
        setPendingMessage(`Request created: ${result.requestId}`);
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not save wine request.");
        setPendingMessage("");
      }
    });
  }

  function updateWineRequestApproval(input: Parameters<typeof updateSupplierWineRequestApproval>[0]) {
    setPendingMessage("Updating request approval...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await updateSupplierWineRequestApproval(input);
        setPendingMessage("Request approval updated");
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not update request approval.");
        setPendingMessage("");
      }
    });
  }

  return (
    <main className="app-shell">
      <AppTopbar
        activeView={activeView}
        dataLabel={dataLabel}
        dataTitle={dataTitle}
        isPending={isPending}
        onCreateDrafts={createDrafts}
        onRefreshReports={refreshReports}
        onSelectView={selectView}
      />

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
          setSupplierSort={setSupplierSort}
          suggestedOnly={suggestedOnly}
          supplier={supplier}
          supplierGroups={supplierGroups}
          supplierSort={supplierSort}
          supplierOptions={supplierOptions}
          supplierTargetWeeks={supplierTargetWeeks}
          visibleCount={visibleRecommendations.length}
          onSaveApproval={saveApproval}
          onClearSupplierApprovals={clearSupplierApprovals}
          onSaveOrderPath={saveOrderPath}
          onSaveWorkingQty={saveWorkingQty}
          onSetWorkingQty={setWorkingQty}
          onSetSupplierTargetWeeks={setSupplierTargetWeeksValue}
        />
      ) : null}

      {activeView === "supplier-hub" ? (
        <SupplierHubView
          suppliers={suppliers}
          supplierCatalogWines={supplierCatalogWines}
          wineRequests={wineRequests}
          priceChangeEvents={priceChangeEvents}
          isPending={isPending}
          onCreateWineRequest={createWineRequest}
          onSaveCatalogWine={saveCatalogWine}
          onSaveSupplier={saveSupplier}
          onUpdateWineRequestApproval={updateWineRequestApproval}
        />
      ) : null}

      {activeView === "vinosmith-rescue" ? <VinosmithRescueExplorerView data={vinosmithExplorer} /> : null}

      {activeView === "supplier-board" ? <SupplierBoardView groups={allSupplierGroups} /> : null}

      {activeView === "freight" ? <FreightView rows={displayRows} suppliers={suppliers} /> : null}

      {activeView === "po-drafts" ? (
        <PoDraftsView
          drafts={draftRows}
          isPending={isPending}
          reportRunId={reportRun.id}
          suppliers={suppliers}
          onDeleteLine={removeDraftLine}
          onStatusChange={changeDraftStatus}
        />
      ) : null}
    </main>
  );
}
