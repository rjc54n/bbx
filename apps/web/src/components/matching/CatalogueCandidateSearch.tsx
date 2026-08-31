"use client";

import { useActionState } from "react";
import {
  confirmMatchCandidate,
  searchMatchCatalogue,
  type MatchCatalogueSearchState,
} from "@/lib/matching/actions";
import type { MatchSource } from "@/lib/matching/adapters";

const initialState: MatchCatalogueSearchState = { results: [] };

export function CatalogueCandidateSearch({
  source,
  matchGroupKey,
  defaultQuery,
  sourceVintage,
  returnPath,
}: {
  source: MatchSource;
  matchGroupKey: string;
  defaultQuery: string;
  sourceVintage: number | null;
  returnPath: string;
}) {
  const [state, action, pending] = useActionState(searchMatchCatalogue, initialState);
  return <details className="mt-3">
    <summary className="cursor-pointer text-xs text-accent">Search the wider BBR catalogue</summary>
    <form action={action} className="mt-2 flex flex-wrap gap-2">
      <input type="search" name="query" defaultValue={defaultQuery} className="min-w-64 flex-1 rounded border border-border px-2 py-1.5 text-sm" />
      <input type="hidden" name="vintage" value={sourceVintage ?? ""} />
      <button disabled={pending} className="rounded border border-accent px-3 py-1.5 text-xs text-accent disabled:opacity-60">{pending ? "Searching…" : "Search"}</button>
    </form>
    {state.error && <p role="alert" className="mt-2 text-xs text-accent">{state.error}</p>}
    {state.results.length > 0 && <ul className="mt-2 divide-y divide-border rounded border border-border">
      {state.results.map((candidate) => <li key={candidate.parent_sku} className="flex items-start justify-between gap-3 p-2 text-xs">
        <div><p className="font-medium">{candidate.name}</p><p className="text-ink-muted">Parent {candidate.parent_sku} · {candidate.producer ?? "Producer unavailable"} · {candidate.region ?? "Region unavailable"} · {candidate.stock_origin ?? "Stock origin unavailable"}</p></div>
        <form action={confirmMatchCandidate.bind(null, source, matchGroupKey, candidate.parent_sku, returnPath)}><button className="rounded border border-accent px-2 py-1 text-accent">Confirm</button></form>
      </li>)}
    </ul>}
  </details>;
}
