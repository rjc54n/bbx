"use client";

import { deleteCellarTrackerGroup } from "./actions";

export function DeleteCellarTrackerGroupForm({
  matchGroupKey,
  recordCount,
  returnPath,
}: {
  matchGroupKey: string;
  recordCount: number;
  returnPath: string;
}) {
  const action = deleteCellarTrackerGroup.bind(null, matchGroupKey, returnPath);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm(`Permanently delete ${recordCount} CellarTracker record${recordCount === 1 ? "" : "s"}? This cannot be undone.`)) {
      event.preventDefault();
    }
  }}>
    <button className="rounded border border-red-700 px-2 py-1.5 text-xs text-red-800">Delete {recordCount} record{recordCount === 1 ? "" : "s"}</button>
  </form>;
}
