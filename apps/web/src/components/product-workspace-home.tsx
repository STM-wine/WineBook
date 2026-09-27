"use client";

import { AppTopbar } from "./app-topbar";
import { ProductWorkspaceView } from "./product-workspace-view";

export function ProductWorkspaceHome({ canViewSettings, canManageMarkers }: { canViewSettings?: boolean; canManageMarkers: boolean }) {
  return (
    <main className="app-shell">
      <AppTopbar activeView="product-workspace" canViewSettings={canViewSettings} />
      <ProductWorkspaceView canManageMarkers={canManageMarkers} />
    </main>
  );
}
