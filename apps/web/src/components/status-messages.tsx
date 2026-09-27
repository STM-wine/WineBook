import { WineLoadingProgress } from "./wine-loading-progress";

export function StatusMessages({ errorMessage, pendingMessage, isPending }: { errorMessage: string; pendingMessage: string; isPending?: boolean }) {
  if (!errorMessage && !pendingMessage) return null;

  return (
    <section className="status-strip" aria-live="polite">
      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
      {isPending ? <WineLoadingProgress inline message={pendingMessage || "Saving changes"} /> : pendingMessage ? <div className="save-state">{pendingMessage}</div> : null}
    </section>
  );
}
