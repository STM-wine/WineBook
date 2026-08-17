"use client";

type WineLoadingProgressProps = {
  detail?: string;
  message: string;
  onStop?: () => void;
};

export function WineLoadingProgress({ detail, message, onStop }: WineLoadingProgressProps) {
  return (
    <div className="wine-loading-progress" role="status" aria-live="polite">
      <div className="wine-loader-copy">
        <strong>{message}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      {onStop ? (
        <button className="wine-loader-stop" onClick={onStop} type="button">
          Stop loading
        </button>
      ) : null}
      <span className="wine-loader-bar">
        <span />
      </span>
    </div>
  );
}
