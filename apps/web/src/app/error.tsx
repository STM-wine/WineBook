"use client";
import { AppTopbar } from "@/components/app-topbar";
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="app-shell">
    <AppTopbar />
    <section className="panel" role="alert">
      <h1>This workspace could not load</h1>
      <p>Retry this section or use navigation to keep working.</p>
      <button className="button" onClick={reset} type="button">Retry</button>
    </section>
  </main>;
}
