"use client";

import { deleteCellarTrackerRecord } from "./actions";

export function DeleteCellarTrackerRecordForm({
  importId,
  sourceRowNumber,
}: {
  importId: string;
  sourceRowNumber: number;
}) {
  const action = deleteCellarTrackerRecord.bind(null, importId, sourceRowNumber);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm("Permanently delete this CellarTracker record? This cannot be undone.")) {
      event.preventDefault();
    }
  }}>
    <button className="rounded border border-red-700 px-3 py-1.5 text-sm text-red-800">Delete record</button>
  </form>;
}
