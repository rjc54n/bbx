"use client";

import { useEffect, useState } from "react";
import { formatCoveragePct, formatDate } from "@/lib/format";
import { fetchLatestCompletedScan, type ScanHealthRow } from "@/lib/query/scanHealth";

// Latest completed scan_health_view run -- the honesty banner Phase D asks
// for: when the data is from, how complete pricing coverage was, and an
// explicit reminder that prices/next-offer are scan-time estimates, not a
// live feed.
export function DataHonestyHeader() {
  const [scan, setScan] = useState<ScanHealthRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchLatestCompletedScan()
      .then((row) => {
        if (!cancelled) setScan(row);
      })
      .catch(() => {
        if (!cancelled) setScan(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-border bg-accent-soft px-4 py-1.5 text-xs text-ink-muted">
      {loading ? (
        <span>Loading scan status…</span>
      ) : !scan ? (
        <span>No completed scan on record.</span>
      ) : (
        <>
          <span>
            Last scan: <strong className="font-semibold text-ink">{formatDate(scan.finished_at ?? scan.started_at)}</strong>
          </span>
          <span>
            Pricing coverage:{" "}
            <strong className="font-semibold text-ink">
              {formatCoveragePct(scan.rest_skus_priced, scan.rest_skus_expected)}
            </strong>
          </span>
          <span>
            Discovery:{" "}
            <strong className="font-semibold text-ink">{scan.algolia_complete ? "Complete" : "Incomplete"}</strong>
          </span>
        </>
      )}
      <span className="italic">Prices and next-offer values are scan-time estimates, not a live feed.</span>
    </div>
  );
}
