"use client";

import Link from "next/link";
import { useOptimistic, useState } from "react";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { CatalogueCandidateSearch } from "@/components/matching/CatalogueCandidateSearch";
import { ExcludeMatchGroupForm } from "@/components/matching/ExcludeMatchGroupForm";
import { runMatchGroupMutation, type MatchGroupMutation } from "@/lib/matching/actions";
import type { MatchSource } from "@/lib/matching/adapters";
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
  is_bbx_eligible: boolean;
  match_score: number | null;
};

export type ReleaseOfferPanel = {
  kind: "release_offer";
  records: Array<{
    import_id: string;
    source_row_number: number;
    offer_date: string | null;
    source_price_text: string | null;
    source_product_url: string | null;
    tasting_notes: string | null;
    description: string | null;
  }>;
};

export type CellarTrackerPanel = {
  kind: "cellartracker";
  producer: string | null;
  region: string | null;
  quantityHome: number;
  quantityBbr: number;
  totalQuantity: number;
  acceptedAt: string | null;
};

export type MatchGroupPanel = ReleaseOfferPanel | CellarTrackerPanel;

export type MatchGroupView = {
  source: MatchSource;
  match_group_key: string;
  source_wine: string;
  source_vintage: number | null;
  /** Pre-rendered by the page: the source-specific one-liner under the title. */
  subtitle: string;
  source_row_count: number;
  unresolved_row_count: number;
  linked_row_count: number;
  suppressed_row_count: number;
  parent_sku: string | null;
  match_method: string | null;
  is_bbx_eligible: boolean;
  /** The source name and the rank-1 candidate disagree on a second-wine marker. */
  second_wine_conflict: boolean;
  /** 'full' | 'full_with_typos' | 'partial' | 'low' | 'none' (triage spec §4.2). */
  coverage_tier: string;
  token_coverage: number | null;
  candidates: MatchCandidate[];
  /** Default text for the "search the wider catalogue" box. */
  catalogueSearchQuery: string;
  panel: MatchGroupPanel;
  favouriteTarget: FavouriteTarget | null;
  isFavourite: boolean;
};

const TIER_LABEL: Record<string, string> = {
  full: "Full token cover",
  full_with_typos: "Full token cover, with typos",
  partial: "Partial token cover",
  low: "Low token cover",
};

function coverageNote(group: MatchGroupView): string | null {
  const label = TIER_LABEL[group.coverage_tier];
  if (!label) return null;
  return typeof group.token_coverage === "number"
    ? `${label} · ${Math.round(group.token_coverage * 100)}%`
    : label;
}

function displayMethod(value: string | null) {
  const labels: Record<string, string> = {
    supplied_id: "Supplied ID",
    local_exact: "Local exact",
    algolia_exact: "Algolia exact",
    algolia_confirmed: "Algolia confirmed",
    manual: "Manual",
    suppressed: "No suitable match",
  };
  return value ? labels[value] ?? value.replaceAll("_", " ") : "Mixed methods";
}

function ReleaseOfferPanelView({ panel }: { panel: ReleaseOfferPanel }) {
  if (panel.records.length === 0) return null;
  return <details className="mt-3 rounded border border-border bg-accent-soft/30 p-3 text-xs">
    <summary className="cursor-pointer font-medium text-ink">Release info</summary>
    <div className="mt-2 space-y-3">
      {panel.records.map((record) => <div key={`${record.import_id}-${record.source_row_number}`} className="space-y-1">
        {panel.records.length > 1 && <p className="text-ink-muted">Offer {record.offer_date ?? "date unknown"}</p>}
        {record.source_price_text && <p><span className="text-ink-muted">Price: </span>{record.source_price_text}</p>}
        {record.tasting_notes && <p className="whitespace-pre-wrap text-ink">{record.tasting_notes}</p>}
        {record.description && <p className="whitespace-pre-wrap text-ink-muted">{record.description}</p>}
        <p className="flex flex-wrap gap-3">
          {record.source_product_url && <a href={record.source_product_url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">Source page ↗</a>}
          <Link href={`/release-prices/offers/${record.import_id}/${record.source_row_number}`} className="text-accent underline-offset-2 hover:underline">Open record</Link>
        </p>
      </div>)}
    </div>
  </details>;
}

function CellarTrackerPanelView({ panel }: { panel: CellarTrackerPanel }) {
  return <details className="mt-3 rounded border border-border bg-accent-soft/30 p-3 text-xs">
    <summary className="cursor-pointer font-medium text-ink">Holding</summary>
    <div className="mt-2 space-y-1">
      <p><span className="text-ink-muted">Producer: </span>{panel.producer ?? "unavailable"}</p>
      <p><span className="text-ink-muted">Region: </span>{panel.region ?? "unavailable"}</p>
      <p><span className="text-ink-muted">Bottles: </span>{panel.totalQuantity.toLocaleString()} total · {panel.quantityHome.toLocaleString()} home · {panel.quantityBbr.toLocaleString()} BBR-held</p>
      {panel.acceptedAt && <p className="text-ink-muted">From the snapshot accepted {panel.acceptedAt.slice(0, 10)}</p>}
    </div>
  </details>;
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
  async function submit(mutation: MatchGroupMutation) {
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
          <div className="min-w-0 flex-1"><h2 className="font-semibold">{group.source_wine}</h2><p className="mt-1 text-xs text-ink-muted">{group.subtitle}</p></div>
          {group.favouriteTarget && <FavouriteStar target={group.favouriteTarget} favourite={group.isFavourite} label={group.source_wine} />}
          <div className="text-right text-xs"><p>{group.unresolved_row_count} unresolved · {group.linked_row_count} linked · {group.suppressed_row_count} suppressed</p>{group.parent_sku && <p className="mt-1 font-medium">Parent {group.parent_sku} · {displayMethod(group.match_method)}</p>}{group.parent_sku && <p className="text-ink-muted">{group.is_bbx_eligible ? "Currently in the BBX-eligible catalogue" : "Found in BBR catalogue, not currently BBX-eligible"}</p>}{group.unresolved_row_count > 0 && coverageNote(group) && <p className="mt-1 text-ink-muted">{coverageNote(group)}</p>}</div>
        </div>
        {/* The one hazard that survives into the high-coverage tiers: the source
            and the top candidate disagree about a second wine. Confirming links
            a second wine to a grand vin's Parent ID or the reverse, and
            release_price_anchor_view anchors on the earliest offer, so a single
            wrong confirm poisons that wine's anchor from then on. */}
        {group.second_wine_conflict && group.unresolved_row_count > 0 && <p role="alert" className="mt-3 rounded border border-accent bg-accent-soft/50 p-3 text-xs">
          <strong className="font-medium">Second-wine mismatch.</strong> The source name and the top candidate disagree on a second-wine marker — Les Forts, Pavillon, Carruades, Clos du Marquis and the like. One of them is the grand vin and the other is not. Check the candidate by name before confirming; a wrong link here corrupts that wine&rsquo;s release-price anchor. If nothing in the list is the right wine, record it as no suitable match.
        </p>}
        {group.panel.kind === "release_offer"
          ? <ReleaseOfferPanelView panel={group.panel} />
          : <CellarTrackerPanelView panel={group.panel} />}
        {group.unresolved_row_count > 0 && group.candidates.length > 0 && <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {group.candidates.map((candidate) => <div key={candidate.parent_sku} className="flex items-start justify-between gap-3 rounded border border-border p-3 text-xs"><div><p className="font-medium">#{candidate.rank} {candidate.name}</p><p className="mt-1 text-ink-muted">Parent {candidate.parent_sku} · {candidate.producer ?? "Producer unavailable"} · {candidate.region ?? "Region unavailable"}</p><p className="text-ink-muted">{candidate.stock_origin ?? "Stock origin unavailable"} · {candidate.purchase_mode ?? "Purchase mode unavailable"} · {candidate.is_bbx_eligible ? "BBX-eligible" : "not currently BBX-eligible"}{candidate.typo_count !== null ? ` · ${candidate.typo_count} typo${candidate.typo_count === 1 ? "" : "s"}` : ""}{typeof candidate.match_score === "number" ? ` · ${Math.round(candidate.match_score * 100)}% name match` : ""}</p></div><form action={() => submit({ source: group.source, op: "confirm", matchGroupKey: group.match_group_key, parentSku: candidate.parent_sku })}><SubmitButton pendingLabel="Confirming…" className="rounded border border-accent px-2 py-1 text-accent">Confirm group</SubmitButton></form></div>)}
        </div>}
        {group.unresolved_row_count > 0 && <div className="mt-3 flex flex-wrap items-start gap-3">
          <form action={(formData) => submit({ source: group.source, op: "manual", matchGroupKey: group.match_group_key, parentSku: String(formData.get("parent_sku") ?? "").trim() })} className="flex gap-2"><input name="parent_sku" inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Parent ID" className="w-40 rounded border border-border px-2 py-1.5 text-xs" required /><SubmitButton pendingLabel="Linking…" className="rounded border border-border px-2 py-1.5 text-xs">Link manually</SubmitButton></form>
        </div>}
        {group.linked_row_count > 0 && <div className="mt-3 flex flex-wrap gap-2"><form action={(formData) => submit({ source: group.source, op: "edit", matchGroupKey: group.match_group_key, parentSku: String(formData.get("parent_sku") ?? "").trim() })} className="flex gap-2"><input name="parent_sku" inputMode="numeric" pattern="[0-9]{5,30}" defaultValue={group.parent_sku ?? ""} className="w-40 rounded border border-border px-2 py-1.5 text-xs" required /><SubmitButton pendingLabel="Saving…" className="rounded border border-border px-2 py-1.5 text-xs">Edit linked Parent ID</SubmitButton></form><form action={() => submit({ source: group.source, op: "unlink", matchGroupKey: group.match_group_key })}><SubmitButton pendingLabel="Unlinking…" className="rounded border border-accent px-2 py-1.5 text-xs text-accent">Unlink and retry later</SubmitButton></form></div>}
        {group.suppressed_row_count > 0 && <form action={() => submit({ source: group.source, op: "restore", matchGroupKey: group.match_group_key })} className="mt-3"><SubmitButton pendingLabel="Restoring…" className="rounded border border-border px-2 py-1.5 text-xs">Restore to unmatched</SubmitButton></form>}
        {group.unresolved_row_count > 0 && <CatalogueCandidateSearch source={group.source} matchGroupKey={group.match_group_key} defaultQuery={group.catalogueSearchQuery} sourceVintage={group.source_vintage} returnPath={returnPath} />}
        {/* The two "cannot link" decisions, grouped and separated from the linking
            actions above, with Exclude styled as the heavier one (spec §3.8). */}
        <div className="mt-3 border-t border-border pt-3">
          {group.unresolved_row_count > 0 && <p className="text-xs text-ink-muted"><strong className="font-medium text-ink">No suitable match:</strong> the wine is genuine but you cannot link it right now; it leaves this queue and stays in the corpus. <strong className="font-medium text-ink">Exclude:</strong> the source row itself is wrong; it is removed everywhere.</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {group.unresolved_row_count > 0 && <form action={() => submit({ source: group.source, op: "suppress", matchGroupKey: group.match_group_key })}><SubmitButton pendingLabel="Saving…" className="rounded border border-border px-2 py-1.5 text-xs">No suitable match</SubmitButton></form>}
            <ExcludeMatchGroupForm source={group.source} matchGroupKey={group.match_group_key} recordCount={group.source_row_count} returnPath={returnPath} />
          </div>
        </div>
      </article>)}
    </div>
  </>;
}
