"use client";

import { useEffect, useState } from "react";
import { formatCoveragePct, formatDate } from "@/lib/format";
import { fetchPublicationHealth, publicationIsOverdue, type PublicationHealth } from "@/lib/query/scanHealth";

export function DataHonestyHeader() {
  const [health, setHealth] = useState<PublicationHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setNow(Date.now());
      fetchPublicationHealth()
        .then((result) => { if (!cancelled) setHealth(result); })
        .catch(() => { if (!cancelled) setHealth(null); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return <PublicationBanner health={health} loading={loading} now={now} />;
}

export function PublicationBanner({ health, loading, now }: {
  health: PublicationHealth | null; loading: boolean; now: number;
}) {
  const scan = health?.publication;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-border bg-accent-soft px-4 py-1.5 text-xs text-ink-muted">
      {loading ? <span>Loading publication status...</span> : !health ? (
        <span role="status">Publication status unavailable.</span>
      ) : <>
        {scan ? <>
          <span>Last published: <strong className="font-semibold text-ink">{formatDate(scan.published_at)}</strong></span>
          <span>Pricing coverage: <strong className="font-semibold text-ink">{formatCoveragePct(scan.rest_skus_priced, scan.rest_skus_expected)}</strong></span>
          <span>Discovery: <strong className="font-semibold text-ink">{scan.algolia_complete ? "Complete" : "Incomplete"}</strong></span>
        </> : <span>No verified publication on record.</span>}
        {scan && publicationIsOverdue(scan.published_at, now) && (
          <span role="alert" className="font-semibold text-red-700">Publication is over 60 hours old.</span>
        )}
        {health.failure && <span role="alert" className="text-red-700">
          Later attempt failed: {formatDate(health.failure.finished_at ?? health.failure.started_at)}.
          {health.failure.source_committed_at ? " Source saved; publication needs recovery." : " Source refresh did not complete."}
        </span>}
      </>}
      <span className="italic">Prices and next-offer values are scan-time estimates, not a live feed.</span>
    </div>
  );
}
