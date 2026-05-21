export function StatusMessages({ errorMessage, pendingMessage }: { errorMessage: string; pendingMessage: string }) {
  if (!errorMessage && !pendingMessage) return null;

  return (
    <section className="status-strip" aria-live="polite">
      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
      {pendingMessage ? <div className="save-state">{pendingMessage}</div> : null}
    </section>
  );
}
