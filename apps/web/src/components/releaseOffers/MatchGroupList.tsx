"use client";

import Link from "next/link";
import { useOptimistic, useState } from "react";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { CatalogueCandidateSearch } from "@/components/releaseOffers/CatalogueCandidateSearch";
import { ExcludeHistoricOfferGroupForm } from "@/components/releaseOffers/ExcludeHistoricOfferGroupForm";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { runMatchGroupMutation, type MatchMutation } from "@/app/(protected)/release-prices/matches/actions";
import type { FavouriteTarget } from "@/lib/favourites/target";

export type MatchCandidate = {
  parent_sku: string;
  rank: number;
  name: string;
  producer: string | null;
  region: string | null;
  stock_origin: string | null;
  purchase_mode: string | null;
  typo_count: number | null;
  is_biddable: boolean;
  match_score: number | null;
};

export type MatchReleaseRecord = {
  import_id: string;
  source_row_number: number;
  offer_date: string | null;
  source_price_text: string | null;
  source_product_url: string | null;
  tasting_notes: string | null;
  description: string | null;
};

export type MatchGroupView = {
  match_group_key: string;
  source_wine: string;
  source_vintage: number | null;
  earliest_offer_date: string;
  latest_offer_date: string;
  source_row_count: number;
  unresolved_row_count: number;
  linked_row_count: number;
  suppressed_row_count: number;
  parent_sku: string | null;
  match_method: string | null;
  is_biddable: boolean;
  candidates: MatchCandidate[];
  records: MatchReleaseRecord[];
  favouriteTarget: FavouriteTarget | null;
  isFavourite: boolean;
};

function displayMethod(value: string | null) {
  const labels: Record<string, string> = {
    supplied_id: "Supplied ID",
    local_exact: "Local exact",
    algolia_exact: "Algolia exact",
    algolia_confirmed: "Algolia confirmed",
    manual: "Manual",
  };
  return value ? labels[value] ?? value.replaceAll("_", " ") : "Mixed methods";
}

export function MatchGroupList({
  groups,
  state,
  returnPath,
}: {
  groups: MatchGroupView[];
  state: string;
  returnPath: string;
}) {
  const [error, setError] = useState<string | null>(null);
  // Optimistically drop a card the instant its action fires; the background
  // revalidation then re-bases this list on fresh server data, so a confirmed
  // group stays gone and a failed one reappears (and we surface the error).
  const [visible, hide] = useOptimistic(
    groups,
    (current: MatchGroupView[], key: string) => current.filter((group) => group.match_group_key !== key),
  );

  // A mutation removes the card from THIS view unless we're on the "all" tab
  // (where every bucket shows) or it's an in-place edit of a linked Parent ID.
  async function submit(mutation: MatchMutation) {
    setError(null);
    if (state !== "all" && mutation.op !== "edit") hide(mutation.matchGroupKey);
    const result = await runMatchGroupMutation(mutation);
    if (!result.ok) setError(result.error ?? "The match decision could not be saved.");
  }

  if (visible.length === 0) {
    return <p className="p-6 text-sm text-ink-muted">No match groups meet this filter.</p>;
  }

  return <>
    {error && <p role="alert" className="border-b border-border bg-background p-3 text-sm text-accent">{error}</p>}
    <div className="divide-y divide-border">
      {visible.map((group) => <article key={group.match_group_key} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1"><h2 className="font-semibold">{group.source_wine}</h2><p className="mt-1 text-xs text-ink-muted">{group.source_vintage ?? "Vintage unavailable"} · {group.source_row_count.toLocaleString()} source records · offers {group.earliest_offer_date} to {group.latest_offer_date}</p></div>
          {group.favouriteTarget && <FavouriteStar target={group.favouriteTarget} favourite={group.isFavourite} label={group.source_wine} />}
          <div className="text-right text-xs"><p>{group.unresolved_row_count} unresolved · {group.linked_row_count} linked · {group.suppressed_row_count} suppressed</p>{group.parent_sku && <p className="mt-1 font-medium">Parent {group.parent_sku} · {displayMethod(group.match_method)}</p>}{group.parent_sku && <p className="text-ink-muted">{group.is_biddable ? "Currently in the BBX-eligible catalogue" : "Found in BBR catalogue, not currently BBX-eligible"}</p>}</div>
        </div>
        {group.records.length > 0 && <details className="mt-3 rounded border border-border bg-accent-soft/30 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-ink">Release info</summary>
          <div className="mt-2 space-y-3">
            {group.records.map((record) => <div key={`${record.import_id}-${record.source_row_number}`} className="space-y-1">
              {group.records.length > 1 && <p className="text-ink-muted">Offer {record.offer_date ?? "date unknown"}</p>}
              {record.source_price_text && <p><span className="text-ink-muted">Price: </span>{record.source_price_text}</p>}
              {record.tasting_notes && <p className="whitespace-pre-wrap text-ink">{record.tasting_notes}</p>}
              {record.description && <p className="whitespace-pre-wrap text-ink-muted">{record.description}</p>}
              <p className="flex flex-wrap gap-3">
                {record.source_product_url && <a href={record.source_product_url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">Source page ↗</a>}
                <Link href={`/release-prices/offers/${record.import_id}/${record.source_row_number}`} className="text-accent underline-offset-2 hover:underline">Open record</Link>
              </p>
            </div>)}
          </div>
        </details>}
        {group.unresolved_row_count > 0 && group.candidates.length > 0 && <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {group.candidates.map((candidate) => <div key={candidate.parent_sku} className="flex items-start justify-between gap-3 rounded border border-border p-3 text-xs"><div><p className="font-medium">#{candidate.rank} {candidate.name}</p><p className="mt-1 text-ink-muted">Parent {candidate.parent_sku} · {candidate.producer ?? "Producer unavailable"} · {candidate.region ?? "Region unavailable"}</p><p className="text-ink-muted">{candidate.stock_origin ?? "Stock origin unavailable"} · {candidate.purchase_mode ?? "Purchase mode unavailable"} · {candidate.is_biddable ? "BBX-eligible" : "not currently BBX-eligible"}{candidate.typo_count !== null ? ` · ${candidate.typo_count} typo${candidate.typo_count === 1 ? "" : "s"}` : ""}{typeof candidate.match_score === "number" ? ` · ${Math.round(candidate.match_score * 100)}% name match` : ""}</p></div><form action={() => submit({ op: "confirm", matchGroupKey: group.match_group_key, parentSku: candidate.parent_sku })}><SubmitButton pendingLabel="Confirming…" className="rounded border border-accent px-2 py-1 text-accent">Confirm group</SubmitButton></form></div>)}
        </div>}
        {group.unresolved_row_count > 0 && <div className="mt-3 flex flex-wrap items-start gap-3">
          <form action={(formData) => submit({ op: "manual", matchGroupKey: group.match_group_key, parentSku: String(formData.get("parent_sku") ?? "").trim() })} className="flex gap-2"><input name="parent_sku" inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Parent ID" className="w-40 rounded border border-border px-2 py-1.5 text-xs" required /><SubmitButton pendingLabel="Linking…" className="rounded border border-border px-2 py-1.5 text-xs">Link manually</SubmitButton></form>
          <form action={() => submit({ op: "suppress", matchGroupKey: group.match_group_key })}><SubmitButton pendingLabel="Suppressing…" className="rounded border border-border px-2 py-1.5 text-xs">Reject and suppress</SubmitButton></form>
        </div>}
        {group.linked_row_count > 0 && <div className="mt-3 flex flex-wrap gap-2"><form action={(formData) => submit({ op: "edit", matchGroupKey: group.match_group_key, parentSku: String(formData.get("parent_sku") ?? "").trim() })} className="flex gap-2"><input name="parent_sku" inputMode="numeric" pattern="[0-9]{5,30}" defaultValue={group.parent_sku ?? ""} className="w-40 rounded border border-border px-2 py-1.5 text-xs" required /><SubmitButton pendingLabel="Saving…" className="rounded border border-border px-2 py-1.5 text-xs">Edit linked Parent ID</SubmitButton></form><form action={() => submit({ op: "unlink", matchGroupKey: group.match_group_key })}><SubmitButton pendingLabel="Unlinking…" className="rounded border border-accent px-2 py-1.5 text-xs text-accent">Unlink and retry later</SubmitButton></form></div>}
        {group.suppressed_row_count > 0 && <form action={() => submit({ op: "restore", matchGroupKey: group.match_group_key })} className="mt-3"><SubmitButton pendingLabel="Restoring…" className="rounded border border-border px-2 py-1.5 text-xs">Restore to unmatched</SubmitButton></form>}
        {group.unresolved_row_count > 0 && <CatalogueCandidateSearch matchGroupKey={group.match_group_key} sourceWine={group.source_wine} sourceVintage={group.source_vintage} returnPath={returnPath} />}
        <div className="mt-3 border-t border-border pt-3"><ExcludeHistoricOfferGroupForm matchGroupKey={group.match_group_key} recordCount={group.source_row_count} returnPath={returnPath} /></div>
      </article>)}
    </div>
  </>;
}
