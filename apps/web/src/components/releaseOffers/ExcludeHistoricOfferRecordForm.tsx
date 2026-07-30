"use client";

import { excludeHistoricOfferRecord } from "@/app/(protected)/release-prices/matches/actions";

export function ExcludeHistoricOfferRecordForm({
  importId,
  sourceRowNumber,
}: {
  importId: string;
  sourceRowNumber: number;
}) {
  const action = excludeHistoricOfferRecord.bind(null, importId, sourceRowNumber);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm("Exclude this release-offer record? It stops supplying release prices, and a later file repeating it is filtered out, until you restore it.")) {
      event.preventDefault();
    }
  }}>
    <button className="rounded border border-accent px-3 py-1.5 text-sm text-accent">Exclude record</button>
  </form>;
}
