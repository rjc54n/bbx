"use client";

import { deleteHistoricOfferGroup } from "@/app/(protected)/release-prices/matches/actions";

export function DeleteHistoricOfferGroupForm({
  matchGroupKey,
  recordCount,
  returnPath,
}: {
  matchGroupKey: string;
  recordCount: number;
  returnPath: string;
}) {
  const action = deleteHistoricOfferGroup.bind(null, matchGroupKey, returnPath);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm(`Permanently delete ${recordCount} historic offer record${recordCount === 1 ? "" : "s"}? This cannot be undone.`)) {
      event.preventDefault();
    }
  }}>
    <button className="rounded border border-red-700 px-2 py-1.5 text-xs text-red-800">Delete {recordCount} record{recordCount === 1 ? "" : "s"}</button>
  </form>;
}
