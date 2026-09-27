"use client";
import { useEffect } from "react";

// Opt-in local diagnostics only. No business data or network telemetry is collected.
export function WineBookPerformanceObserver() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PERFORMANCE_DIAGNOSTICS !== "true") return;
    const samples: Array<{ name: string; startTime: number; duration: number }> = [];
    (window as unknown as { winebookPerformance: typeof samples }).winebookPerformance = samples;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "mark" && !entry.name.startsWith("winebook:")) continue;
        samples.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration });
      }
      samples.splice(0, Math.max(0, samples.length - 500));
    });
    observer.observe({ entryTypes: ["mark", "measure", "longtask", "navigation"] });
    const start = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("a,button,select")) performance.mark("winebook:action-start");
    };
    document.addEventListener("click", start, true);
    return () => { observer.disconnect(); document.removeEventListener("click", start, true); };
  }, []);
  return null;
}
