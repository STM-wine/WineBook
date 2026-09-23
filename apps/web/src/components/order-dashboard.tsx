"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  cancelPurchaseOrderDrafts,
  createSupplierWineRequest,
  deletePendingSupplierCatalogWine,
  deletePurchaseOrderLine,
  refreshOrderingData,
  restoreInactiveQuickBooksItemToWorkbench,
  saveSupplierCatalogWine,
  saveSupplierLogisticsBatch,
  updateSupplierWineRequestApproval,
  updatePurchaseOrderDraftStatus,
  updateRecommendationApprovals
} from "@/app/actions";
import type {
  ApprovalCommitment,
  ApprovalConflict,
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
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { applyDiContainerRecommendations } from "@/lib/di-planning";
import {
  MANUAL_RECOMMENDATION_PAUSE_REASON,
  type ReplenishmentPolicy,
  type ReplenishmentPolicyFilter
} from "@/lib/replenishment-policy";
import {
  applySupplierTargetWeeks,
  applyApprovalCommitments,
  approvalProcessingPatch,
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
  approvalCommitments: ApprovalCommitment[];
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

type ApprovalQueueItem = {
  rowId: string;
  sourceType: "recommendation" | "catalog_workbench";
  id: string | null;
  reportRunId: string;
  supplierCatalogWineId?: string;
  recommendationStatus: string;
  approvedQty: number;
  expectedLockVersion: number;
  recommendedQty?: number;
  orderPath?: "stateside" | "di";
};

function approvalConflictMessage(conflicts: ApprovalConflict[]) {
  const first = conflicts[0];
  if (!first) return "Another buyer changed an approval. Your unsaved value is still shown; edit it again to retry.";
  if (first.reason === "approval_set_changed") {
    return "The approved set changed while PO drafts were being prepared. Nothing was created. Review the new approvals and retry.";
  }
  const editor = first.updatedByName || "another buyer";
  const when = first.updatedAt ? ` at ${new Date(first.updatedAt).toLocaleString()}` : "";
  const more = conflicts.length > 1 ? ` (${conflicts.length.toLocaleString()} conflicts total)` : "";
  return `This row was changed by ${editor}${when}${more}. Your unsaved value is still shown; edit it again to retry.`;
}

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
  approvalCommitments,
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
      applyApprovalCommitments(
        applySupplierTdmAssignments(
          enrichRecommendationsWithSupplierCatalogPrograms(
            mergeSupplierCatalogRows(recommendations, supplierCatalogWines, reportRun.id),
            supplierCatalogWines
          ),
          suppliers
        ),
        approvalCommitments
      ),
    [approvalCommitments, recommendations, reportRun.id, supplierCatalogWines, suppliers]
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
  const realtimeSupabase = useMemo(() => createBrowserClient(), []);
  const approvalQueueRef = useRef(new Map<string, ApprovalQueueItem>());
  const approvalInFlightKeysRef = useRef(new Set<string>());
  const approvalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvalFlushRef = useRef<Promise<void> | null>(null);
  const realtimeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRows((current) => combinedRecommendations.map((incoming) => {
      const queueKey = incoming.supplier_catalog_wine_id
        ? `catalog:${incoming.supplier_catalog_wine_id}`
        : `recommendation:${incoming.id}`;
      if (!approvalQueueRef.current.has(queueKey) && !approvalInFlightKeysRef.current.has(queueKey)) return incoming;
      const local = current.find((row) => row.id === incoming.id || (
        incoming.supplier_catalog_wine_id && row.supplier_catalog_wine_id === incoming.supplier_catalog_wine_id
      ));
      if (!local) return incoming;
      const preserved = {
        ...incoming,
        recommendation_status: local.recommendation_status,
        approved_qty: local.approved_qty,
        order_path: local.order_path
      };
      return {
        ...preserved,
        ...approvalProcessingPatch(preserved, preserved.recommendation_status, preserved.approved_qty)
      };
    }));
  }, [combinedRecommendations]);

  useEffect(() => {
    setDraftRows(poDrafts);
  }, [poDrafts]);

  useEffect(() => {
    function scheduleDraftRefresh() {
      if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = setTimeout(() => router.refresh(), 250);
    }

    const channel = realtimeSupabase
      .channel(`ordering-run:${reportRun.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "reorder_recommendations", filter: `report_run_id=eq.${reportRun.id}` },
        (payload) => {
          const incoming = payload.new as Partial<Recommendation> & { id: string };
          const key = `recommendation:${incoming.id}`;
          if (approvalQueueRef.current.has(key) || approvalInFlightKeysRef.current.has(key)) return;
          setRows((current) => current.map((row) => {
            if (row.id !== incoming.id) return row;
            const updated = { ...row, ...incoming };
            return {
              ...updated,
              ...approvalProcessingPatch(updated, updated.recommendation_status, updated.approved_qty)
            };
          }));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "supplier_catalog_workbench_items", filter: `report_run_id=eq.${reportRun.id}` },
        (payload) => {
          const incoming = payload.new as {
            id?: string;
            supplier_catalog_wine_id?: string;
            recommendation_status?: string;
            approved_qty?: number;
            recommended_qty?: number;
            order_path?: string;
            lock_version?: number;
            updated_at?: string;
            updated_by?: string;
          };
          if (!incoming.supplier_catalog_wine_id) return;
          const key = `catalog:${incoming.supplier_catalog_wine_id}`;
          if (approvalQueueRef.current.has(key) || approvalInFlightKeysRef.current.has(key)) return;
          setRows((current) => current.map((row) => {
            if (row.supplier_catalog_wine_id !== incoming.supplier_catalog_wine_id) return row;
            const updated: Recommendation = {
                ...row,
                supplier_catalog_workbench_item_id: incoming.id || row.supplier_catalog_workbench_item_id,
                recommendation_status: incoming.recommendation_status ?? row.recommendation_status,
                approved_qty: incoming.approved_qty ?? row.approved_qty,
                recommended_qty_rounded: incoming.recommended_qty ?? row.recommended_qty_rounded,
                order_path: incoming.order_path ?? row.order_path,
                lock_version: incoming.lock_version ?? row.lock_version,
                updated_at: incoming.updated_at ?? row.updated_at,
                updated_by: incoming.updated_by ?? row.updated_by
              };
            return {
              ...updated,
              ...approvalProcessingPatch(updated, updated.recommendation_status, updated.approved_qty)
            };
          }));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_order_drafts", filter: `report_run_id=eq.${reportRun.id}` },
        scheduleDraftRefresh
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_order_lines" }, scheduleDraftRefresh)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "purchase_order_export_events", filter: `report_run_id=eq.${reportRun.id}` },
        scheduleDraftRefresh
      )
      .subscribe();

    return () => {
      if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
      void realtimeSupabase.removeChannel(channel);
    };
  }, [realtimeSupabase, reportRun.id, router]);

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
      if (approvalQueueRef.current.size === 0) return;
    }

    approvalFlushRef.current = (async () => {
      while (approvalQueueRef.current.size > 0) {
        const queued = Array.from(approvalQueueRef.current.entries());
        approvalQueueRef.current.clear();
        const updates = queued.map(([, value]) => ({
          sourceType: value.sourceType,
          id: value.id,
          reportRunId: value.reportRunId,
          supplierCatalogWineId: value.supplierCatalogWineId,
          recommendationStatus: value.recommendationStatus,
          approvedQty: value.approvedQty,
          expectedLockVersion: value.expectedLockVersion,
          recommendedQty: value.recommendedQty,
          orderPath: value.orderPath
        }));
        queued.forEach(([key]) => approvalInFlightKeysRef.current.add(key));
        const result = await updateRecommendationApprovals({ updates }).finally(() => {
          queued.forEach(([key]) => approvalInFlightKeysRef.current.delete(key));
        });
        if (!result.ok) {
          for (const conflict of result.conflicts) {
            setRows((current) => current.map((row) => {
              const sameRow = conflict.sourceType === "recommendation"
                ? row.id === conflict.id || row.id === conflict.sourceId
                : row.supplier_catalog_workbench_item_id === conflict.id || row.supplier_catalog_workbench_item_id === conflict.sourceId;
              if (!sameRow) return row;
              return {
                ...row,
                lock_version: conflict.currentLockVersion ?? row.lock_version,
                updated_at: conflict.updatedAt ?? row.updated_at,
                updated_by: conflict.updatedBy ?? row.updated_by
              };
            }));
          }
          throw new Error(approvalConflictMessage(result.conflicts));
        }

        for (const saved of result.saved) {
          const submitted = queued.find(([, value]) =>
            saved.sourceType === "recommendation"
              ? value.id === saved.id
              : value.id === saved.id || value.supplierCatalogWineId === saved.supplierCatalogWineId
          );
          setRows((current) => current.map((row) => {
            const sameRow = saved.sourceType === "recommendation"
              ? row.id === saved.id
              : row.supplier_catalog_workbench_item_id === saved.id || row.supplier_catalog_wine_id === saved.supplierCatalogWineId;
            if (!sameRow) return row;
            return {
              ...row,
              supplier_catalog_workbench_item_id: saved.sourceType === "catalog_workbench" ? saved.id : row.supplier_catalog_workbench_item_id,
              lock_version: saved.lockVersion,
              updated_at: saved.updatedAt,
              updated_by: saved.updatedBy
            };
          }));

          if (submitted) {
            const [queueKey] = submitted;
            const newer = approvalQueueRef.current.get(queueKey);
            if (newer && newer.expectedLockVersion === submitted[1].expectedLockVersion) {
              approvalQueueRef.current.set(queueKey, {
                ...newer,
                id: saved.id,
                expectedLockVersion: saved.lockVersion
              });
            }
          }
        }
      }
    })()
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Could not save approvals.");
        throw error;
      })
      .finally(() => {
        approvalFlushRef.current = null;
      });

    await approvalFlushRef.current;
  }

  function queueApprovalSave(
    row: Recommendation,
    recommendationStatus: string,
    approvedQty: number,
    orderPath = row.order_path === "di" ? "di" as const : "stateside" as const
  ) {
    const sourceType = row.supplier_catalog_wine_id ? "catalog_workbench" as const : "recommendation" as const;
    const queueKey = sourceType === "recommendation" ? `recommendation:${row.id}` : `catalog:${row.supplier_catalog_wine_id}`;
    const existing = approvalQueueRef.current.get(queueKey);
    approvalQueueRef.current.set(queueKey, {
      rowId: row.id,
      sourceType,
      id: sourceType === "recommendation" ? row.id : row.supplier_catalog_workbench_item_id || null,
      reportRunId: row.report_run_id || reportRun.id,
      supplierCatalogWineId: row.supplier_catalog_wine_id || undefined,
      recommendationStatus,
      approvedQty,
      expectedLockVersion: existing?.expectedLockVersion ?? Math.max(0, Math.round(asNumber(row.lock_version))),
      recommendedQty: sourceType === "catalog_workbench"
        ? Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)))
        : undefined,
      orderPath
    });
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
      approved_qty: qty,
      ...approvalProcessingPatch(row, status, qty)
    });
    setPendingMessage("");
    setErrorMessage("");

    queueApprovalSave(row, status, qty);
  }

  function setWorkingQty(row: Recommendation, qty: number) {
    const approvedQty = Math.max(0, Math.round(qty));
    patchRow(row.id, {
      approved_qty: approvedQty,
      ...approvalProcessingPatch(row, row.recommendation_status, approvedQty)
    });
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
    const approvedQty = isApprovedRow
      ? Math.max(0, Math.round(asNumber(nextDisplayRow?.recommended_qty_rounded)))
      : Math.max(0, Math.round(asNumber(row.approved_qty)));
    const recommendationStatus = isApprovedRow ? "approved" : row.recommendation_status || "rejected";

    patchRow(row.id, {
      order_path: orderPath,
      approved_qty: approvedQty,
      recommendation_status: recommendationStatus,
      ...approvalProcessingPatch(row, recommendationStatus, approvedQty)
    });
    setPendingMessage("");
    setErrorMessage("");
    queueApprovalSave(row, recommendationStatus, approvedQty, orderPath);
  }

  function createDrafts() {
    setPendingMessage("Creating PO drafts...");
    setErrorMessage("");
    setShowPoDraftProgress(true);

    startTransition(async () => {
      try {
        await flushApprovalQueue();
        const response = await fetch("/api/po-drafts/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportRunId: reportRun.id, idempotencyKey: crypto.randomUUID() })
        });
        const result = (await response.json()) as {
          created?: string[];
          updated?: string[];
          skipped?: string[];
          errors?: string[];
          drafts?: PurchaseOrderDraftWithLines[];
          conflicts?: ApprovalConflict[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(result.conflicts?.length ? approvalConflictMessage(result.conflicts) : result.error || "Could not create PO drafts.");
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
          onSaveApproval={saveApproval}
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
