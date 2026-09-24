export type OrderingMarkerPermissionRow = {
  permission: string;
};

export function canManageOrderingMarkers(role: string, permissionRows: OrderingMarkerPermissionRow[]) {
  if (role === "admin" || role === "buyer") return true;
  return permissionRows.some((row) => row.permission === "draft_logic_changes" || row.permission === "manage_supplier_settings");
}
