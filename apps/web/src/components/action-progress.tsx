import type { ReactNode } from "react";

export function ActionProgress({ children }: { children: ReactNode }) {
  return (
    <span className="button-action-progress">
      <span className="button-action-spinner" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
