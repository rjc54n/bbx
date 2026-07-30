"use client";

import { excludeCellarTrackerRecord } from "./actions";

export function ExcludeCellarTrackerRecordForm({
  importId,
  sourceRowNumber,
}: {
  importId: string;
  sourceRowNumber: number;
}) {
  const action = excludeCellarTrackerRecord.bind(null, importId, sourceRowNumber);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm("Exclude this CellarTracker record? It is hidden everywhere and left out of future snapshots until you restore it.")) {
      event.preventDefault();
    }
  }}>
    <button className="rounded border border-accent px-3 py-1.5 text-sm text-accent">Exclude record</button>
  </form>;
}
