"use client";

import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellClassParams,
  type CellValueChangedEvent,
  type ColDef,
  type ICellRendererParams,
  type ValueFormatterParams
} from "ag-grid-community";
import type { Recommendation } from "@/lib/types";
import { diEligibility, isDiOpportunity, orderPath } from "@/lib/di-planning";
import {
  asNumber,
  displayWineName,
  formatCurrency,
  formatDecimal,
  formatInteger,
  rowApprovedEstimate,
  rowRecommendedQty
} from "@/lib/order-data";

ModuleRegistry.registerModules([AllCommunityModule]);

type WorkbenchGridProps = {
  rows: Recommendation[];
  showForecast: boolean;
  showHistory: boolean;
  onSaveApproval: (row: Recommendation, approved: boolean, qtyOverride?: number) => void;
  onSaveOrderPath: (row: Recommendation, orderPath: "stateside" | "di") => void;
  onSetWorkingQty: (row: Recommendation, qty: number) => void;
  onSaveWorkingQty: (row: Recommendation, qty: number) => void;
};

type WorkbenchRow = Recommendation & {
  importer_rank: number;
  wine_display: string;
  working_qty: number;
  working_weeks: number;
  approved: boolean;
  estimated_cost: number;
};

type ManualEditState = Record<string, { qty?: boolean; weeks?: boolean }>;

const integerFormatter = (params: ValueFormatterParams<WorkbenchRow, number>) => formatInteger(asNumber(params.value));
const decimalFormatter = (params: ValueFormatterParams<WorkbenchRow, number>) => formatDecimal(asNumber(params.value));
const currencyFormatter = (params: ValueFormatterParams<WorkbenchRow, number>) => formatCurrency(asNumber(params.value));
const wineRenderer = (params: ICellRendererParams<WorkbenchRow>) => (
  <span className="wine-cell-value">
    <span>{params.valueFormatted ?? params.value ?? ""}</span>
    {params.data && isDiOpportunity(params.data) ? <span className="di-opportunity-badge">DI Opportunity</span> : null}
  </span>
);
const centeredRenderer = (params: ICellRendererParams<WorkbenchRow>) => (
  <span className="grid-center-value">{params.valueFormatted ?? params.value ?? ""}</span>
);
const OrderPathRenderer = (params: ICellRendererParams<WorkbenchRow>) => {
  const row = params.data;
  if (!row) return <span className="grid-center-value">Stateside</span>;
  const eligibility = diEligibility(row);
  const current = orderPath(row);

  if (!eligibility.eligible) {
    return <span className="order-path-static">Stateside</span>;
  }

  return (
    <select
      aria-label="Order path"
      className={current === "di" ? "order-path-select is-di" : "order-path-select"}
      value={current}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => params.context.onSaveOrderPath(row, event.target.value as "stateside" | "di")}
    >
      <option value="stateside">Stateside</option>
      <option value="di">DI</option>
    </select>
  );
};
const rowHeightForWineName = (name: string) => {
  const lines = Math.max(1, Math.ceil(name.length / 42));
  return Math.max(42, Math.min(112, 22 + lines * 18));
};
const roundUpToPack = (qty: number, packSize: number) => {
  const pack = Math.max(1, Math.round(packSize || 1));
  return Math.ceil(Math.max(0, qty) / pack) * pack;
};
const weeksFromQty = (row: Recommendation, qty: number) => {
  const velocity = asNumber(row.weekly_velocity);
  if (velocity <= 0) return 0;
  return (asNumber(row.true_available) + asNumber(row.on_order) + qty) / velocity;
};
const qtyFromWeeks = (row: Recommendation, weeks: number) => {
  const rawQty = weeks * asNumber(row.weekly_velocity) - (asNumber(row.true_available) + asNumber(row.on_order));
  return roundUpToPack(rawQty, asNumber(row.pack_size) || 1);
};
const rankBasis = (row: Recommendation) =>
  asNumber(row.last_365_day_sales) ||
  asNumber(row.last_12_month_sales) ||
  asNumber(row.last_90_day_sales) ||
  asNumber(row.last_60_day_sales) ||
  asNumber(row.last_30_day_sales);
const CENTER_CELL_STYLE = {
  alignItems: "center",
  display: "flex",
  justifyContent: "center",
  textAlign: "center"
};
const LEFT_CELL_STYLE = {
  alignItems: "center",
  display: "flex",
  justifyContent: "flex-start",
  textAlign: "left"
};

export function WorkbenchGrid({
  rows,
  showForecast,
  showHistory,
  onSaveApproval,
  onSaveOrderPath,
  onSetWorkingQty,
  onSaveWorkingQty
}: WorkbenchGridProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [manualEditedCells, setManualEditedCells] = useState<ManualEditState>({});

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const rowData = useMemo<WorkbenchRow[]>(
    () => {
      const sortedRankValues = Array.from(new Set(rows.map(rankBasis))).sort((a, b) => b - a);

      return rows.map((row) => ({
        ...row,
        importer_rank: Math.max(1, sortedRankValues.indexOf(rankBasis(row)) + 1),
        wine_display: displayWineName(row),
        working_qty: rowRecommendedQty(row),
        working_weeks: weeksFromQty(row, rowRecommendedQty(row)),
        approved: row.recommendation_status === "approved" || row.recommendation_status === "edited",
        estimated_cost: rowApprovedEstimate(row)
      }));
    },
    [rows]
  );

  const columnDefs = useMemo<ColDef<WorkbenchRow>[]>(
    () => {
      const columns: ColDef<WorkbenchRow>[] = [
      {
        headerName: "Wine",
        field: "wine_display",
        pinned: "left",
        lockPinned: true,
        width: 360,
        minWidth: 300,
        cellClass: (params: CellClassParams<WorkbenchRow>) =>
          asNumber(params.data?.recommended_qty_rounded) > 0
            ? "wine-cell text-cell has-recommendation"
            : "wine-cell text-cell",
        cellStyle: LEFT_CELL_STYLE,
        cellRenderer: wineRenderer,
        headerClass: "text-header",
        wrapText: true,
        autoHeight: true
      },
      {
        headerName: "Approval",
        field: "approved",
        pinned: "left",
        lockPinned: true,
        width: 92,
        editable: true,
        headerTooltip: "Check to include this wine in the next PO draft. The approved quantity is saved automatically.",
        headerClass: "center-header",
        cellRenderer: "agCheckboxCellRenderer",
        cellEditor: "agCheckboxCellEditor",
        cellClass: "editable-cell center-cell approval-cell",
        cellStyle: CENTER_CELL_STYLE
      },
      {
        headerName: "Order Path",
        field: "order_path",
        pinned: "left",
        lockPinned: true,
        width: 118,
        headerTooltip: "Buyer-controlled procurement path. DI is available only for seeded eligible brands and is never selected automatically.",
        headerClass: "center-header",
        cellClass: "editable-cell center-cell",
        cellRenderer: OrderPathRenderer,
        cellStyle: CENTER_CELL_STYLE
      },
      {
        headerName: "Weeks w/ On Order",
        field: "weeks_on_hand_with_on_order",
        pinned: "left",
        lockPinned: true,
        width: 128,
        headerTooltip: "Formula: (True Available + On Order) / Weekly Velocity.",
        headerClass: "number-header",
        cellClass: "center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: decimalFormatter
      },
      {
        headerName: "Target Weeks",
        field: "working_weeks",
        pinned: "left",
        lockPinned: true,
        width: 138,
        editable: true,
        headerTooltip: "Formula: (True Available + On Order + New PO Qty) / Weekly Velocity. Editing this recalculates New PO Qty.",
        headerClass: "number-header",
        cellClass: (params: CellClassParams<WorkbenchRow>) =>
          manualEditedCells[params.data?.id || ""]?.weeks
            ? "editable-cell center-cell manual-edit-cell"
            : "editable-cell center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueParser: (params) => Math.max(0, Number(params.newValue) || 0),
        valueFormatter: decimalFormatter
      },
      {
        headerName: "New PO Qty",
        field: "working_qty",
        pinned: "left",
        lockPinned: true,
        width: 118,
        editable: true,
        headerTooltip: "Suggested bottles needed to reach target coverage after available inventory and open orders.",
        headerClass: "number-header",
        cellClass: (params: CellClassParams<WorkbenchRow>) =>
          manualEditedCells[params.data?.id || ""]?.qty
            ? "editable-cell center-cell manual-edit-cell"
            : "editable-cell center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueParser: (params) => Math.max(0, Math.round(Number(params.newValue) || 0)),
        valueFormatter: integerFormatter
      },
      {
        headerName: "Cost",
        field: "estimated_cost",
        pinned: "left",
        lockPinned: true,
        width: 112,
        headerTooltip: "Formula: Recommended Qty x bottle cost, including available landed-cost data where present.",
        headerClass: "number-header",
        cellClass: "center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: currencyFormatter
      },
      {
        headerName: "True Available",
        field: "true_available",
        width: 126,
        headerTooltip:
          "Formula: Available Inventory - Unconfirmed Line Item Qty. This estimates bottles actually available for buying decisions.",
        headerClass: "number-header",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: integerFormatter
      },
      {
        headerName: "On Order",
        field: "on_order",
        width: 104,
        headerTooltip: "From RB6 On Order. Bottles already ordered but not yet received.",
        headerClass: "number-header",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: integerFormatter
      },
      {
        headerName: "30d Sales",
        field: "last_30_day_sales",
        width: 108,
        headerTooltip: "Trailing 30-day bottle sales anchored to the latest RADs sales date.",
        headerClass: "number-header",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: integerFormatter
      },
      ...(showHistory
        ? [
            {
              headerName: "60d Sales",
              field: "last_60_day_sales" as const,
              width: 108,
              headerTooltip: "Trailing 60-day bottle sales anchored to the latest RADs sales date.",
              headerClass: "number-header",
              cellStyle: CENTER_CELL_STYLE,
              cellRenderer: centeredRenderer,
              valueFormatter: integerFormatter
            },
            {
              headerName: "90d Sales",
              field: "last_90_day_sales" as const,
              width: 108,
              headerTooltip: "Trailing 90-day bottle sales anchored to the latest RADs sales date.",
              headerClass: "number-header",
              cellStyle: CENTER_CELL_STYLE,
              cellRenderer: centeredRenderer,
              valueFormatter: integerFormatter
            }
          ]
        : []),
      {
        headerName: "Next 30d Forecast",
        field: "next_30_day_forecast",
        width: 138,
        headerTooltip: "Same upcoming 30-day calendar window last year. This is a seasonal reference, not a predictive model.",
        headerClass: "number-header",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: integerFormatter
      },
      ...(showForecast
        ? [
            {
              headerName: "LY Next 60d Forecast",
              field: "next_60_day_forecast" as const,
              width: 150,
              headerTooltip: "Same upcoming 60-day calendar window last year.",
              headerClass: "number-header",
              cellStyle: CENTER_CELL_STYLE,
              cellRenderer: centeredRenderer,
              valueFormatter: integerFormatter
            },
            {
              headerName: "LY Next 90d Forecast",
              field: "next_90_day_forecast" as const,
              width: 150,
              headerTooltip: "Same upcoming 90-day calendar window last year.",
              headerClass: "number-header",
              cellStyle: CENTER_CELL_STYLE,
              cellRenderer: centeredRenderer,
              valueFormatter: integerFormatter
            }
          ]
        : []),
      {
        headerName: "Weekly Velocity",
        field: "weekly_velocity",
        width: 128,
        headerTooltip: "Formula: 30d Sales / 4.345. Converts recent monthly bottle sales into weekly pace.",
        headerClass: "number-header",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: integerFormatter
      },
      {
        headerName: "Velocity Trend",
        valueGetter: (params) =>
          params.data?.velocity_trend_label || `${formatDecimal(asNumber(params.data?.velocity_trend_pct), 0)}%`,
        width: 130,
        headerTooltip: "Formula: ((Last 30d Sales - Prior 30d Sales) / Prior 30d Sales) x 100.",
        headerClass: "number-header",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer
      },
      {
        headerName: "Item #",
        field: "product_code",
        width: 110,
        cellClass: "center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        headerClass: "center-header"
      },
      {
        headerName: "Rank",
        field: "importer_rank",
        width: 82,
        headerTooltip: "Supplier-level velocity rank using 12-month sales when available, otherwise 90/60/30-day sales.",
        cellClass: "center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        headerClass: "center-header",
        valueFormatter: integerFormatter
      }
    ];
      return columns;
    },
    [manualEditedCells, onSaveOrderPath, showForecast, showHistory]
  );

  const defaultColDef = useMemo<ColDef<WorkbenchRow>>(
    () => ({
      resizable: true,
      sortable: true,
      suppressMovable: true,
      cellClass: "center-cell"
    }),
    []
  );

  function onCellValueChanged(event: CellValueChangedEvent<WorkbenchRow>) {
    const row = event.data;
    if (!row) return;

    if (event.colDef.field === "working_qty") {
      const qty = Math.max(0, Math.round(Number(event.newValue) || 0));
      setManualEditedCells((current) => ({
        ...current,
        [row.id]: { ...current[row.id], qty: true }
      }));
      onSetWorkingQty(row, qty);
      onSaveWorkingQty(row, qty);
      return;
    }

    if (event.colDef.field === "working_weeks") {
      const qty = qtyFromWeeks(row, Math.max(0, Number(event.newValue) || 0));
      setManualEditedCells((current) => ({
        ...current,
        [row.id]: { ...current[row.id], weeks: true }
      }));
      onSetWorkingQty(row, qty);
      onSaveWorkingQty(row, qty);
      return;
    }

    if (event.colDef.field === "approved") {
      onSaveApproval(row, Boolean(event.newValue), row.working_qty);
    }
  }

  const totalRowHeight = rowData.reduce((sum, row) => sum + rowHeightForWineName(row.wine_display), 0);
  const gridHeight = Math.min(620, Math.max(240, 96 + totalRowHeight));

  if (!isMounted) {
    return (
      <div className="workbench-grid ag-theme-quartz workbench-grid-loading" style={{ height: gridHeight }}>
        Loading wines...
      </div>
    );
  }

  return (
    <div className="workbench-grid ag-theme-quartz" style={{ height: gridHeight }}>
      <AgGridReact
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        theme="legacy"
        getRowId={(params) => params.data.id}
        getRowHeight={(params) => rowHeightForWineName(params.data?.wine_display ?? "")}
        onCellValueChanged={onCellValueChanged}
        headerHeight={64}
        singleClickEdit
        stopEditingWhenCellsLoseFocus
        suppressClipboardApi
        suppressDragLeaveHidesColumns
        animateRows={false}
        enableBrowserTooltips
        tooltipShowDelay={0}
        context={{ onSaveOrderPath }}
      />
    </div>
  );
}
