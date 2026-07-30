"use client";

import { excludeCellarTrackerGroup } from "./actions";

export function ExcludeCellarTrackerGroupForm({
  matchGroupKey,
  recordCount,
  returnPath,
}: {
  matchGroupKey: string;
  recordCount: number;
  returnPath: string;
}) {
  const action = excludeCellarTrackerGroup.bind(null, matchGroupKey, returnPath);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm(`Exclude ${recordCount} CellarTracker record${recordCount === 1 ? "" : "s"}? They are hidden everywhere and left out of future snapshots until you restore them.`)) {
      event.preventDefault();
    }
  }}>
    <button className="rounded border border-accent px-2 py-1.5 text-xs text-accent">Exclude {recordCount} record{recordCount === 1 ? "" : "s"}</button>
  </form>;
}
