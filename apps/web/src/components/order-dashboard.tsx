"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  cancelPurchaseOrderDrafts,
  clearAllOrderApprovals,
  createSupplierWineRequest,
  deletePendingSupplierCatalogWine,
  deletePurchaseOrderLine,
  refreshOrderingData,
  restoreInactiveQuickBooksItemToWorkbench,
  saveSupplierCatalogWine,
  saveSupplierLogisticsBatch,
  updateSupplierCatalogWorkbenchItems,
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
  SupplierQuickBooksVendorMatch,
  VinosmithExplorerData,
  WineRequest,
  SupplierLogistics
} from "@/lib/types";
import { applyDiContainerRecommendations } from "@/lib/di-planning";
import {
  MANUAL_RECOMMENDATION_PAUSE_REASON,
  type ReplenishmentPolicy,
  type ReplenishmentPolicyFilter
} from "@/lib/replenishment-policy";
import {
  applySupplierTargetWeeks,
  applySupplierTdmAssignments,
  asNumber,
  buildMetrics,
  buildSupplierGroups,
  enrichRecommendationsWithSupplierCatalogPrograms,
  filterRecommendations,
  mergeSupplierCatalogRows,
  removeSupplierCatalogWineFromWorkbench,
  replaceSupplierCatalogWineInWorkbench,
  sortSupplierGroups,
  type SupplierGroupSortMode,
  rowRecommendedQty,
  uniqueSorted
} from "@/lib/order-data";
import { AppTopbar } from "./app-topbar";
import { ActiveView, DEFAULT_VIEW, isActiveView } from "./dashboard-types";
import { StatusMessages } from "./status-messages";

const FreightView = dynamic(() => import("./freight-view").then((module) => module.FreightView), { loading: ViewLoading });
const OrderReviewView = dynamic(() => import("./order-review-view").then((module) => module.OrderReviewView), { loading: ViewLoading });
const PoDraftsView = dynamic(() => import("./po-drafts-view").then((module) => module.PoDraftsView), { loading: ViewLoading });
const ProductWorkspaceView = dynamic(() => import("./product-workspace-view").then((module) => module.ProductWorkspaceView), { loading: ViewLoading });
const SupplierBoardView = dynamic(() => import("./supplier-board-view").then((module) => module.SupplierBoardView), { loading: ViewLoading });
const SupplierHubView = dynamic(() => import("./supplier-hub-view").then((module) => module.SupplierHubView), { loading: ViewLoading });
const VinosmithRescueExplorerView = dynamic(
  () => import("./vinosmith-rescue-explorer-view").then((module) => module.VinosmithRescueExplorerView),
  { loading: ViewLoading }
);

function ViewLoading() {
  return <section className="panel"><p className="muted">Loading workspace...</p></section>;
}

type Props = {
  reportRun: ReportRun;
  recommendations: Recommendation[];
  poDrafts: PurchaseOrderDraftWithLines[];
  suppliers: SupplierLogistics[];
  supplierCatalogWines: SupplierCatalogWine[];
  vinosmithExplorer: VinosmithExplorerData;
  wineRequests: WineRequest[];
  priceChangeEvents: PriceChangeEvent[];
  quickBooksSupplierMatches: SupplierQuickBooksVendorMatch[];
  initialView: ActiveView;
  quickBooksLastSyncAt: string | null;
  vinosmithLastSyncAt: string | null;
  orderingDataWarning?: string | null;
  canViewSettings?: boolean;
};

function formatSourceUpdatedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("month")} ${part("day")}, ${part("hour")}:${part("minute")} ${part("dayPeriod")}`;
}

export function OrderDashboard({
  reportRun,
  recommendations,
  poDrafts,
  suppliers,
  supplierCatalogWines,
  vinosmithExplorer,
  wineRequests,
  priceChangeEvents,
  quickBooksSupplierMatches,
  initialView,
  quickBooksLastSyncAt,
  vinosmithLastSyncAt,
  orderingDataWarning,
  canViewSettings
}: Props) {
  const router = useRouter();
  const combinedRecommendations = useMemo(
    () =>
      applySupplierTdmAssignments(
        enrichRecommendationsWithSupplierCatalogPrograms(
          mergeSupplierCatalogRows(recommendations, supplierCatalogWines, reportRun.id),
          supplierCatalogWines
        ),
        suppliers
      ),
    [recommendations, reportRun.id, supplierCatalogWines, suppliers]
  );
  const [rows, setRows] = useState(combinedRecommendations);
  const [draftRows, setDraftRows] = useState(poDrafts);
  const [activeView, setActiveView] = useState<ActiveView>(initialView);
  const [supplier, setSupplier] = useState("All");
  const [brandManager, setBrandManager] = useState("All");
  const [search, setSearch] = useState("");
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [supplierSort, setSupplierSort] = useState<SupplierGroupSortMode>("default");
  const [replenishmentPolicyFilter, setReplenishmentPolicyFilter] = useState<ReplenishmentPolicyFilter>("All");
  const [supplierHubAddWineSupplier, setSupplierHubAddWineSupplier] = useState<string | null>(null);
  const [supplierTargetWeeks, setSupplierTargetWeeks] = useState<Record<string, string>>({});
  const [globalTargetWeeks, setGlobalTargetWeeks] = useState("");
  const [pendingMessage, setPendingMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [showPoDraftProgress, setShowPoDraftProgress] = useState(false);
  const approvalQueueRef = useRef(new Map<string, { recommendationStatus: string; approvedQty: number }>());
  const approvalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvalFlushRef = useRef<Promise<void> | null>(null);
  const catalogWorkbenchSavesRef = useRef(new Set<Promise<void>>());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRows(combinedRecommendations);
  }, [combinedRecommendations]);

  useEffect(() => {
    setDraftRows(poDrafts);
  }, [poDrafts]);

  useEffect(() => {
    const syncViewFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view");
      setActiveView(isActiveView(view) ? view : DEFAULT_VIEW);
      setSupplierHubAddWineSupplier(view === "supplier-hub" ? params.get("addWineSupplier") : null);
    };

    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    return () => window.removeEventListener("popstate", syncViewFromUrl);
  }, []);

  const parsedSupplierTargetWeeks = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(supplierTargetWeeks)
          .filter(([, value]) => value.trim() !== "")
          .map(([supplierName, value]) => [supplierName, Number(value)] as const)
          .filter(([, value]) => Number.isFinite(value) && value >= 0)
      ),
    [supplierTargetWeeks]
  );
  const parsedGlobalTargetWeeks = useMemo(() => {
    if (!globalTargetWeeks.trim()) return undefined;
    const value = Number(globalTargetWeeks);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }, [globalTargetWeeks]);
  const displayRows = useMemo(
    () => applySupplierTargetWeeks(
      applyDiContainerRecommendations(rows),
      parsedSupplierTargetWeeks,
      undefined,
      parsedGlobalTargetWeeks
    ),
    [parsedGlobalTargetWeeks, parsedSupplierTargetWeeks, rows]
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
    () => filterRecommendations(displayRows, { supplier, brandManager, search, suggestedOnly, replenishmentPolicy: replenishmentPolicyFilter }),
    [displayRows, supplier, brandManager, search, suggestedOnly, replenishmentPolicyFilter]
  );
  const metrics = useMemo(() => buildMetrics(visibleRecommendations), [visibleRecommendations]);
  const supplierGroups = useMemo(
    () => sortSupplierGroups(buildSupplierGroups(visibleRecommendations), supplierSort),
    [supplierSort, visibleRecommendations]
  );
  const allSupplierGroups = useMemo(() => buildSupplierGroups(displayRows), [displayRows]);
  const dataUpdatedAt = formatSourceUpdatedAt(vinosmithLastSyncAt || reportRun.completed_at);
  const sourceBacked = reportRun.run_type === "quickbooks_sync" && reportRun.diagnostics?.ordering_source === "quickbooks_vinosmith_stem";
  const dataLabel = dataUpdatedAt ? `Vinosmith Available ${dataUpdatedAt}` : `Ordering data ${reportRun.report_date || "Latest"}`;
  const dataTitle = vinosmithLastSyncAt
    ? `Vinosmith Get Available inventory fetched ${dataUpdatedAt}.`
    : reportRun.report_date
      ? `${sourceBacked ? "Source-backed ordering date" : "Legacy fallback report date"} ${reportRun.report_date}${dataUpdatedAt ? `, completed ${dataUpdatedAt}` : ""}`
      : undefined;
  const qbUpdatedAt = formatSourceUpdatedAt(quickBooksLastSyncAt);
  const qbDataLabel = qbUpdatedAt ? `QB Updated ${qbUpdatedAt}` : null;
  const qbDataTitle = qbUpdatedAt
    ? `Last complete QuickBooks Items, purchase orders, invoices, and credits refresh finished ${qbUpdatedAt}.`
    : undefined;

  function selectView(view: ActiveView) {
    if (view === DEFAULT_VIEW) {
      window.location.assign("/");
      return;
    }
    setActiveView(view);
    setSupplierHubAddWineSupplier(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("addWineSupplier");
    if (view === DEFAULT_VIEW) {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", view);
    }
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function openSupplierAddWine(supplierName: string) {
    setActiveView("supplier-hub");
    setSupplierHubAddWineSupplier(supplierName);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "supplier-hub");
    url.searchParams.set("addWineSupplier", supplierName);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function patchRow(id: string, patch: Partial<Recommendation>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function saveReplenishmentPolicy(
    row: Recommendation,
    policy: ReplenishmentPolicy,
    recommendationsSuppressed: boolean
  ) {
    const itemCode = row.product_code?.trim() || row.planning_sku?.trim();
    if (!itemCode) throw new Error("This wine does not have an item number to update.");

    const response = await fetch("/api/products/workspace/markers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemCode,
        replenishmentPolicy: policy,
        recommendationsSuppressed,
        suppressionReason: recommendationsSuppressed ? MANUAL_RECOMMENDATION_PAUSE_REASON : null,
        suppressedUntil: null,
        note: "Manual Order Summary replenishment update"
      })
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      throw new Error(body?.error || "Could not save the replenishment policy.");
    }

    setRows((current) => current.map((candidate) => {
      const sameItem = candidate.id === row.id;
      if (!sameItem) return candidate;
      return {
        ...candidate,
        is_btg: false,
        is_core: policy === "Core",
        replenishment_policy: policy,
        recommendations_suppressed: recommendationsSuppressed
      };
    }));
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

  function trackCatalogWorkbenchSave(save: Promise<void>) {
    catalogWorkbenchSavesRef.current.add(save);
    save.then(
      () => catalogWorkbenchSavesRef.current.delete(save),
      () => catalogWorkbenchSavesRef.current.delete(save)
    );
    return save;
  }

  async function flushCatalogWorkbenchSaves() {
    while (catalogWorkbenchSavesRef.current.size > 0) {
      await Promise.all(Array.from(catalogWorkbenchSavesRef.current));
    }
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

  function restoreInactiveWine(listId: string) {
    setPendingMessage("Re-adding inactive item to the workbench...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        const result = await restoreInactiveQuickBooksItemToWorkbench({ listId, reportRunId: reportRun.id });
        setPendingMessage(`Added to workbench: ${result.displayName}`);
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not re-add the inactive item.");
        setPendingMessage("");
      }
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

    if (row.supplier_catalog_wine_id) {
      setPendingMessage("Saving catalog workbench row...");
      startTransition(async () => {
        const save = updateSupplierCatalogWorkbenchItems({
          updates: [
            {
              id: row.supplier_catalog_workbench_item_id,
              reportRunId: row.report_run_id || reportRun.id,
              supplierCatalogWineId: row.supplier_catalog_wine_id as string,
              recommendationStatus: status,
              approvedQty: qty,
              recommendedQty: Math.max(0, Math.round(asNumber(row.recommended_qty_rounded))),
              orderPath: row.order_path === "di" ? "di" : "stateside"
            }
          ]
        });
        trackCatalogWorkbenchSave(save);
        try {
          await save;
          setPendingMessage("Catalog workbench row saved");
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Could not save catalog workbench row.");
          setPendingMessage("");
        }
      });
      return;
    }

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
    approvedRows
      .filter((row) => !row.supplier_catalog_wine_id)
      .forEach((row) => queueApprovalSave(row.id, "rejected", 0));

    const manualRows = approvedRows.filter((row) => row.supplier_catalog_wine_id);
    if (manualRows.length > 0) {
      setPendingMessage("Clearing catalog workbench approvals...");
      startTransition(async () => {
        const save = updateSupplierCatalogWorkbenchItems({
          updates: manualRows.map((row) => ({
            id: row.supplier_catalog_workbench_item_id,
            reportRunId: row.report_run_id || reportRun.id,
            supplierCatalogWineId: row.supplier_catalog_wine_id as string,
            recommendationStatus: "rejected",
            approvedQty: 0,
            recommendedQty: Math.max(0, Math.round(asNumber(row.recommended_qty_rounded))),
            orderPath: row.order_path === "di" ? "di" : "stateside"
          }))
        });
        trackCatalogWorkbenchSave(save);
        try {
          await save;
          setPendingMessage("Catalog workbench approvals cleared");
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Could not clear catalog workbench approvals.");
          setPendingMessage("");
        }
      });
    }
  }

  function clearAllApprovals() {
    const approvedRows = rows.filter(
      (row) => row.recommendation_status === "approved" || row.recommendation_status === "edited"
    );
    if (approvedRows.length === 0) return;

    setPendingMessage("Clearing all approved orders...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await flushApprovalQueue();
        await flushCatalogWorkbenchSaves();
        const result = await clearAllOrderApprovals({ reportRunId: reportRun.id });
        setRows((current) =>
          current.map((row) =>
            row.recommendation_status === "approved" || row.recommendation_status === "edited"
              ? { ...row, recommendation_status: "rejected", approved_qty: 0 }
              : row
          )
        );
        setPendingMessage(
          `Cleared ${result.cleared.toLocaleString()} approved order line${result.cleared === 1 ? "" : "s"}.`
        );
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not clear all approved orders.");
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
    if (row.supplier_catalog_wine_id) {
      patchRow(row.id, { order_path: orderPath });
      setPendingMessage("Saving catalog order path...");
      setErrorMessage("");

      startTransition(async () => {
        const save = updateSupplierCatalogWorkbenchItems({
          updates: [
            {
              id: row.supplier_catalog_workbench_item_id,
              reportRunId: row.report_run_id || reportRun.id,
              supplierCatalogWineId: row.supplier_catalog_wine_id as string,
              recommendationStatus: row.recommendation_status || "rejected",
              approvedQty: asNumber(row.approved_qty),
              recommendedQty: Math.max(0, Math.round(asNumber(row.recommended_qty_rounded))),
              orderPath
            }
          ]
        });
        trackCatalogWorkbenchSave(save);
        try {
          await save;
          setPendingMessage("Catalog order path saved");
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Could not save catalog order path.");
          setPendingMessage("");
        }
      });
      return;
    }

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
    setShowPoDraftProgress(true);

    startTransition(async () => {
      try {
        await flushApprovalQueue();
        await flushCatalogWorkbenchSaves();
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
          drafts?: PurchaseOrderDraftWithLines[];
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
        setDraftRows(result.drafts || []);
        selectView("po-drafts");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not create PO drafts.");
        setPendingMessage("");
      } finally {
        setShowPoDraftProgress(false);
      }
    });
  }

  function refreshReports() {
    setPendingMessage("Building ordering data from QuickBooks, Vinosmith Available, and Stem...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        await flushApprovalQueue();
        const result = await refreshOrderingData();
        if (!result.ok) {
          setErrorMessage(result.error);
          setPendingMessage("");
          return;
        }
        setPendingMessage(result.reused
          ? `Ordering data for ${result.reportDate} is already current (${result.rowCount.toLocaleString()} rows).`
          : `Ordering data refreshed for ${result.reportDate} (${result.rowCount.toLocaleString()} rows). Buyer work was carried forward safely.`);
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not refresh ordering data.");
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

  function cancelDrafts(draftIds: string[]) {
    const ids = Array.from(new Set(draftIds.filter(Boolean)));
    if (ids.length === 0) return;
    setPendingMessage(`Cancelling ${ids.length.toLocaleString()} PO draft${ids.length === 1 ? "" : "s"}...`);
    setErrorMessage("");
    const previousDrafts = draftRows;
    const selected = new Set(ids);
    setDraftRows((current) => current.map((draft) => selected.has(draft.id) ? { ...draft, status: "cancelled", updated_at: new Date().toISOString() } : draft));

    startTransition(async () => {
      try {
        const result = await cancelPurchaseOrderDrafts({ ids });
        setPendingMessage(`${result.cancelled.toLocaleString()} active PO draft${result.cancelled === 1 ? "" : "s"} cancelled.`);
        router.refresh();
      } catch (error) {
        setDraftRows(previousDrafts);
        setErrorMessage(error instanceof Error ? error.message : "Could not cancel PO drafts.");
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

  function saveSuppliers(updatedSuppliers: SupplierLogistics[]) {
    setPendingMessage(`Saving ${updatedSuppliers.length.toLocaleString()} supplier logistics change(s)...`);
    setErrorMessage("");

    startTransition(async () => {
      try {
        const result = await saveSupplierLogisticsBatch({
          suppliers: updatedSuppliers.map((row) => ({
            id: row.id,
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
          }))
        });
        setPendingMessage(`Supplier logistics saved (${result.saved.toLocaleString()} change(s)).`);
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
        if (input.existingCatalogWineId) {
          setRows((currentRows) =>
            replaceSupplierCatalogWineInWorkbench(currentRows, result.saved, reportRun.id)
          );
        }
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not save supplier wine.");
        setPendingMessage("");
      }
    });
  }

  function deleteCatalogWine(input: Parameters<typeof deletePendingSupplierCatalogWine>[0]) {
    setPendingMessage("Deleting pending product...");
    setErrorMessage("");

    startTransition(async () => {
      try {
        const result = await deletePendingSupplierCatalogWine(input);
        setRows((currentRows) => removeSupplierCatalogWineFromWorkbench(currentRows, input.id));
        setPendingMessage(`Deleted pending product: ${result.displayName}`);
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not delete pending product.");
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
        canViewSettings={canViewSettings}
        dataLabel={dataLabel}
        dataHref={canViewSettings ? "/settings/data-sync" : undefined}
        dataTitle={dataTitle}
        qbDataLabel={qbDataLabel}
        qbDataTitle={qbDataTitle}
        isPending={isPending}
        onCreateDrafts={activeView === "order-review" ? createDrafts : undefined}
        onRefreshReports={activeView === "order-review" ? refreshReports : undefined}
        onSelectView={selectView}
      />

      <StatusMessages errorMessage={errorMessage || orderingDataWarning || ""} pendingMessage={isPending ? pendingMessage || "Working..." : pendingMessage} />
      {showPoDraftProgress ? (
        <div className="processing-modal" role="status" aria-live="assertive">
          <div className="processing-modal-panel">
            <div className="processing-spinner" aria-hidden="true" />
            <div>
              <strong>Create PO Drafts</strong>
              <span>{pendingMessage || "Building supplier PO drafts..."}</span>
            </div>
          </div>
        </div>
      ) : null}

      {activeView === "product-workspace" ? (
        <ProductWorkspaceView canManageMarkers={canViewSettings} previewRows={displayRows} />
      ) : null}

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
          replenishmentPolicyFilter={replenishmentPolicyFilter}
          setReplenishmentPolicyFilter={setReplenishmentPolicyFilter}
          suggestedOnly={suggestedOnly}
          supplier={supplier}
          supplierGroups={supplierGroups}
          supplierSort={supplierSort}
          supplierOptions={supplierOptions}
          supplierCatalogWines={supplierCatalogWines}
          supplierTargetWeeks={supplierTargetWeeks}
          globalTargetWeeks={globalTargetWeeks}
          visibleCount={visibleRecommendations.length}
          hasApprovedOrders={rows.some(
            (row) => row.recommendation_status === "approved" || row.recommendation_status === "edited"
          )}
          onSaveApproval={saveApproval}
          onClearAllApprovals={clearAllApprovals}
          onClearSupplierApprovals={clearSupplierApprovals}
          onSaveOrderPath={saveOrderPath}
          onSaveWorkingQty={saveWorkingQty}
          onSetWorkingQty={setWorkingQty}
          onSetSupplierTargetWeeks={setSupplierTargetWeeksValue}
          onSetGlobalTargetWeeks={setGlobalTargetWeeks}
          onRestoreInactiveWine={restoreInactiveWine}
          onSaveCatalogWine={saveCatalogWine}
          onDeleteCatalogWine={deleteCatalogWine}
          onAddWine={openSupplierAddWine}
          onSaveReplenishmentPolicy={saveReplenishmentPolicy}
          canManageMarkers={canViewSettings}
          isPending={isPending}
        />
      ) : null}

      {activeView === "supplier-hub" ? (
        <SupplierHubView
          addWineSupplierName={supplierHubAddWineSupplier}
          suppliers={suppliers}
          supplierCatalogWines={supplierCatalogWines}
          wineRequests={wineRequests}
          priceChangeEvents={priceChangeEvents}
          quickBooksSupplierMatches={quickBooksSupplierMatches}
          isPending={isPending}
          onCreateWineRequest={createWineRequest}
          onDeleteCatalogWine={deleteCatalogWine}
          onSaveCatalogWine={saveCatalogWine}
          onSaveSuppliers={saveSuppliers}
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
          onCancelDrafts={cancelDrafts}
          onDeleteLine={removeDraftLine}
          onStatusChange={changeDraftStatus}
        />
      ) : null}
    </main>
  );
}
