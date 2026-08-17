"use client";

type WineLoadingProgressProps = {
  detail?: string;
  message: string;
};

export function WineLoadingProgress({ detail, message }: WineLoadingProgressProps) {
  return (
    <div className="wine-loading-progress" role="status" aria-live="polite">
      <div className="wine-loader-copy">
        <strong>{message}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      <span className="wine-loader-bar">
        <span />
      </span>
    </div>
  );
}
