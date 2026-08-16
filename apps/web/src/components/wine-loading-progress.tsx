"use client";

type WineLoadingProgressProps = {
  detail?: string;
  message: string;
};

export function WineLoadingProgress({ detail, message }: WineLoadingProgressProps) {
  return (
    <div className="wine-loading-progress" role="status" aria-live="polite">
      <div className="wine-loader-art" aria-hidden="true">
        <div className="wine-loader-bottle">
          <span className="wine-loader-bottle-neck" />
          <span className="wine-loader-bottle-body" />
        </div>
        <span className="wine-loader-pour" />
        <div className="wine-loader-glass">
          <span className="wine-loader-glass-stem" />
          <span className="wine-loader-glass-base" />
          <span className="wine-loader-fill">
            <span />
          </span>
        </div>
      </div>
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
