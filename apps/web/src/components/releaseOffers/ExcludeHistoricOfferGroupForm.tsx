"use client";

import { excludeHistoricOfferGroup } from "@/app/(protected)/release-prices/matches/actions";

export function ExcludeHistoricOfferGroupForm({
  matchGroupKey,
  recordCount,
  returnPath,
}: {
  matchGroupKey: string;
  recordCount: number;
  returnPath: string;
}) {
  const action = excludeHistoricOfferGroup.bind(null, matchGroupKey, returnPath);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm(`Exclude ${recordCount} historic offer record${recordCount === 1 ? "" : "s"}? They stop supplying release prices, and a later file repeating them is filtered out, until you restore them.`)) {
      event.preventDefault();
    }
  }}>
    <button className="rounded border border-accent px-2 py-1.5 text-xs text-accent">Exclude {recordCount} record{recordCount === 1 ? "" : "s"}</button>
  </form>;
}
