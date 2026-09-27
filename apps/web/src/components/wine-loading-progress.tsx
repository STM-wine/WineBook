"use client";

import { useEffect, useState } from "react";

type WineLoadingProgressProps = {
  detail?: string;
  message: string;
  onStop?: () => void;
  inline?: boolean;
};

export function WineLoadingProgress({ detail, message, onStop, inline = false }: WineLoadingProgressProps) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    performance.mark("winebook:loading-feedback");
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className={`wine-loading-progress${inline ? " wine-loading-inline" : ""}`} role="status" aria-live="polite">
      <div className="wine-loader-copy">
        <strong>{message}</strong>
        {detail ? <span>{detail}</span> : null}
        {elapsed >= 3 ? <small aria-hidden="true">{elapsed}s elapsed</small> : null}
      </div>
      {onStop ? (
        <button className="wine-loader-stop" onClick={onStop} type="button">
          Stop waiting
        </button>
      ) : null}
      {onStop ? <small>Stops this browser’s wait. Server work may continue.</small> : null}
      <span className="wine-loader-bar" aria-hidden="true">
        <span />
      </span>
    </div>
  );
}
