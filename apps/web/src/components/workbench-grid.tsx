"use client";

import { useMemo } from "react";
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

const integerFormatter = (params: ValueFormatterParams<WorkbenchRow, number>) => formatInteger(asNumber(params.value));
const decimalFormatter = (params: ValueFormatterParams<WorkbenchRow, number>) => formatDecimal(asNumber(params.value));
const currencyFormatter = (params: ValueFormatterParams<WorkbenchRow, number>) => formatCurrency(asNumber(params.value));
const wineRenderer = (params: ICellRendererParams<WorkbenchRow>) => (
  <span className="wine-cell-value">{params.valueFormatted ?? params.value ?? ""}</span>
);
const centeredRenderer = (params: ICellRendererParams<WorkbenchRow>) => (
  <span className="grid-center-value">{params.valueFormatted ?? params.value ?? ""}</span>
);
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
  onSetWorkingQty,
  onSaveWorkingQty
}: WorkbenchGridProps) {
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
        width: 92,
        headerTooltip: "Supplier-level velocity rank using 12-month sales when available, otherwise 90/60/30-day sales.",
        cellClass: "center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        headerClass: "center-header",
        valueFormatter: integerFormatter
      },
      {
        headerName: "TDM",
        field: "brand_manager",
        width: 135,
        cellClass: "center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        headerClass: "center-header"
      },
      {
        headerName: "True Available",
        field: "true_available",
        width: 135,
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
        width: 115,
        headerTooltip: "From RB6 On Order. Bottles already ordered but not yet received.",
        headerClass: "number-header",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: integerFormatter
      },
      {
        headerName: "30d Sales",
        field: "last_30_day_sales",
        width: 115,
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
              width: 115,
              headerTooltip: "Trailing 60-day bottle sales anchored to the latest RADs sales date.",
              headerClass: "number-header",
              cellStyle: CENTER_CELL_STYLE,
              cellRenderer: centeredRenderer,
              valueFormatter: integerFormatter
            },
            {
              headerName: "90d Sales",
              field: "last_90_day_sales" as const,
              width: 115,
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
        width: 150,
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
              width: 170,
              headerTooltip: "Same upcoming 60-day calendar window last year.",
              headerClass: "number-header",
              cellStyle: CENTER_CELL_STYLE,
              cellRenderer: centeredRenderer,
              valueFormatter: integerFormatter
            },
            {
              headerName: "LY Next 90d Forecast",
              field: "next_90_day_forecast" as const,
              width: 170,
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
        width: 135,
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
        headerName: "Weeks w/ On Order",
        field: "weeks_on_hand_with_on_order",
        width: 150,
        headerTooltip: "Formula: (True Available + On Order) / Weekly Velocity.",
        headerClass: "number-header",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: decimalFormatter
      },
      {
        headerName: "Weeks w/ Recommended",
        field: "working_weeks",
        width: 170,
        editable: true,
        headerTooltip: "Formula: (True Available + On Order + Recommended Qty) / Weekly Velocity. Editing this recalculates Recommended Qty.",
        headerClass: "number-header",
        cellClass: "editable-cell center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueParser: (params) => Math.max(0, Number(params.newValue) || 0),
        valueFormatter: decimalFormatter
      },
      {
        headerName: "Recommended Qty",
        field: "working_qty",
        width: 145,
        editable: true,
        headerTooltip: "Suggested bottles needed to reach target coverage after available inventory and open orders.",
        headerClass: "number-header",
        cellClass: "editable-cell center-cell",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueParser: (params) => Math.max(0, Math.round(Number(params.newValue) || 0)),
        valueFormatter: integerFormatter
      },
      {
        headerName: "Approval",
        field: "approved",
        width: 105,
        editable: true,
        headerClass: "center-header",
        cellRenderer: "agCheckboxCellRenderer",
        cellEditor: "agCheckboxCellEditor",
        cellClass: "editable-cell center-cell",
        cellStyle: CENTER_CELL_STYLE
      },
      {
        headerName: "Est. Cost",
        field: "estimated_cost",
        width: 125,
        headerTooltip: "Formula: Recommended Qty x bottle cost, including available landed-cost data where present.",
        headerClass: "number-header",
        cellStyle: CENTER_CELL_STYLE,
        cellRenderer: centeredRenderer,
        valueFormatter: currencyFormatter
      }
    ];
      return columns;
    },
    [showForecast, showHistory]
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
      onSetWorkingQty(row, qty);
      onSaveWorkingQty(row, qty);
      return;
    }

    if (event.colDef.field === "working_weeks") {
      const qty = qtyFromWeeks(row, Math.max(0, Number(event.newValue) || 0));
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

  return (
    <div className="workbench-grid ag-theme-quartz" style={{ height: gridHeight }}>
      <AgGridReact
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={(params) => params.data.id}
        getRowHeight={(params) => rowHeightForWineName(params.data?.wine_display ?? "")}
        onCellValueChanged={onCellValueChanged}
        headerHeight={64}
        singleClickEdit
        stopEditingWhenCellsLoseFocus
        suppressDragLeaveHidesColumns
        animateRows={false}
      />
    </div>
  );
}
