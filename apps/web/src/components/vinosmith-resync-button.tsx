"use client";

import { useState, useTransition } from "react";
import { refreshVinosmithReports } from "@/app/actions";

type SyncState =
  | { status: "idle"; message: string }
  | { status: "success"; message: string; workflowUrl: string }
  | { status: "error"; message: string };

export function VinosmithResyncButton({ configured }: { configured: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<SyncState>({
    status: configured ? "idle" : "error",
    message: configured
      ? "Queues a fresh Vinosmith ingest workflow."
      : "Set GITHUB_WORKFLOW_DISPATCH_TOKEN in .env.local for local dev and in Render for production."
  });

  function queueRefresh() {
    if (!configured) return;
    setState({ status: "idle", message: "Queueing Vinosmith refresh..." });
    startTransition(async () => {
      const result = await refreshVinosmithReports();
      if (!result.ok) {
        setState({ status: "error", message: result.error });
        return;
      }
      setState({
        status: "success",
        message: `Refresh queued for ${result.reportDate}.`,
        workflowUrl: result.workflowUrl
      });
    });
  }

  return (
    <div className="sync-action-block">
      <button className="button button-small" disabled={isPending || !configured} onClick={queueRefresh} type="button">
        {isPending ? "Queueing..." : "Re-sync Vinosmith"}
      </button>
      <p className={`sync-action-message sync-action-${state.status}`}>
        {state.message}
        {state.status === "success" ? (
          <>
            {" "}
            <a href={state.workflowUrl} rel="noreferrer" target="_blank">
              View workflow
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
