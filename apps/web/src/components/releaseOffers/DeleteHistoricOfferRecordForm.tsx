"use client";

import { deleteHistoricOfferRecord } from "@/app/(protected)/release-prices/matches/actions";

export function DeleteHistoricOfferRecordForm({
  importId,
  sourceRowNumber,
}: {
  importId: string;
  sourceRowNumber: number;
}) {
  const action = deleteHistoricOfferRecord.bind(null, importId, sourceRowNumber);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm("Permanently delete this release-offer record and its parsed price fragments? This cannot be undone.")) {
      event.preventDefault();
    }
  }}>
    <button className="rounded border border-red-700 px-3 py-1.5 text-sm text-red-800">Delete record</button>
  </form>;
}
