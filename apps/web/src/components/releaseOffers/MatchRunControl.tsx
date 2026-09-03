"use client";

import { useState, useTransition } from "react";
import {
  beginHistoricOfferMatchRun,
  processHistoricOfferMatchBatch,
  type MatchRunProgress,
} from "@/app/(protected)/release-prices/matches/actions";

export function MatchRunControl({ latest }: { latest: MatchRunProgress | null }) {
  const [progress, setProgress] = useState(latest);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setMessage(null);
      try {
        let current = await beginHistoricOfferMatchRun();
        setProgress(current);
        let skipped = 0;
        while (current.remaining > 0) {
          current = await processHistoricOfferMatchBatch(current.runId);
          skipped += current.validationSkipped ?? 0;
          setProgress(current);
          if (current.message) {
            setMessage(current.message);
            return;
          }
        }
        // Groups that lost their validation pass are processed, not failed, so
        // "Retry unmatched" will not pick them up — say so rather than let the
        // missing auto-links look like a matching decision.
        const provisional = skipped > 0
          ? ` Exact-match validation was skipped for ${skipped.toLocaleString()} group${skipped === 1 ? "" : "s"}, so their suggestions are provisional and were not auto-linked.`
          : "";
        setMessage((current.errors > 0
          ? `${current.errors.toLocaleString()} groups failed. Retry unmatched to resume them.`
          : "The unmatched catalogue search is complete.") + provisional);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Matching stopped unexpectedly.");
      }
    });
  }

  const completed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return <div className="rounded-lg border border-border bg-background p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold">Catalogue matching</h2>
        <p className="mt-1 text-sm text-ink-muted">Runs supplied-ID and exact local matching, then searches BBR&apos;s full prod_product catalogue.</p>
      </div>
      <button type="button" onClick={run} disabled={pending} className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Matching…" : progress?.status === "partial" ? "Retry failed groups" : "Retry unmatched"}
      </button>
    </div>
    {progress && <div className="mt-4 space-y-2">
      <div className="h-2 overflow-hidden rounded bg-accent-soft"><div className="h-full bg-accent" style={{ width: `${percentage}%` }} /></div>
      <p className="text-xs text-ink-muted">{completed.toLocaleString()} of {total.toLocaleString()} groups processed · {progress.remaining.toLocaleString()} remaining · {progress.errors.toLocaleString()} errors</p>
      <p className="text-xs text-ink-muted">This run linked {progress.suppliedLinks.toLocaleString()} supplied IDs, {progress.localExactLinks.toLocaleString()} local exact rows and {progress.algoliaExactLinks.toLocaleString()} Algolia exact rows.</p>
    </div>}
    {message && <p role="status" className="mt-3 text-sm text-ink-muted">{message}</p>}
  </div>;
}
