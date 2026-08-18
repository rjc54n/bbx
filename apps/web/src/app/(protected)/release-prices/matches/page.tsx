import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { loadGroupFavourites } from "@/lib/favourites/server";
import { isFavourited, targetForRecord } from "@/lib/favourites/target";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { CatalogueCandidateSearch } from "@/components/releaseOffers/CatalogueCandidateSearch";
import { ExcludeHistoricOfferGroupForm } from "@/components/releaseOffers/ExcludeHistoricOfferGroupForm";
import { MatchRunControl } from "@/components/releaseOffers/MatchRunControl";
import {
  confirmHistoricOfferCandidate,
  confirmManualHistoricOfferMatch,
  editHistoricOfferGroup,
  restoreHistoricOfferGroup,
  suppressHistoricOfferGroup,
  unlinkHistoricOfferGroup,
  type MatchRunProgress,
} from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const states = ["unresolved", "candidates", "linked", "suppressed", "all"] as const;
type StateFilter = typeof states[number];

type MatchGroupRow = {
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
  suggestion_count: number;
  suggestions_observed_at: string | null;
};

type SuggestionRow = {
  match_group_key: string;
  parent_sku: string;
  rank: number;
  name: string;
  vintage: number | null;
  producer: string | null;
  region: string | null;
  stock_origin: string | null;
  purchase_mode: string | null;
  product_url: string | null;
  matched_words: string[];
  typo_count: number | null;
  is_biddable: boolean;
  match_score: number | null;
};

// Per-record release context for the group's expandable "Release info". Sourced
// from release_offer_review_view so it is exclusion-filtered like the counts.
type ReleaseRecordRow = {
  import_id: string;
  source_row_number: number;
  offer_date: string | null;
  source_price_text: string | null;
  source_product_url: string | null;
  source_product_id: string | null;
  tasting_notes: string | null;
  description: string | null;
  match_group_key: string;
};

function hasReleaseInfo(record: ReleaseRecordRow): boolean {
  return Boolean(
    record.source_price_text?.trim() || record.tasting_notes?.trim()
    || record.description?.trim() || record.source_product_url?.trim() || record.source_product_id?.trim(),
  );
}

function applyStateFilter<T extends {
  gt(column: string, value: number): T;
  eq(column: string, value: number): T;
}>(query: T, state: StateFilter): T {
  if (state === "unresolved") return query.gt("unresolved_row_count", 0);
  if (state === "candidates") return query.gt("unresolved_row_count", 0).gt("suggestion_count", 0);
  if (state === "linked") return query.gt("linked_row_count", 0).eq("unresolved_row_count", 0);
  if (state === "suppressed") return query.gt("suppressed_row_count", 0).eq("unresolved_row_count", 0);
  return query;
}

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

function runProgress(row: Record<string, unknown> | null): MatchRunProgress | null {
  if (!row || typeof row.id !== "string") return null;
  return {
    runId: row.id,
    status: String(row.status),
    total: Number(row.total_group_count),
    processed: Number(row.processed_group_count),
    remaining: Number(row.remaining_group_count),
    errors: Number(row.error_group_count),
    suppliedLinks: Number(row.supplied_id_link_count),
    localExactLinks: Number(row.local_exact_link_count),
    algoliaExactLinks: Number(row.algolia_exact_link_count),
  };
}

export default async function HistoricOfferMatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const stateParam = typeof params.state === "string" ? params.state : "unresolved";
  const state: StateFilter = states.includes(stateParam as StateFilter) ? stateParam as StateFilter : "unresolved";
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : "1") || 1);
  const owner = await requireOwner();
  const { supabase } = owner;

  let rowsQuery = supabase.from("release_offer_match_review_view").select("*", { count: "exact" })
    .order("suggestion_count", { ascending: false })
    .order("source_wine", { ascending: true });
  rowsQuery = applyStateFilter(rowsQuery, state);
  if (search) rowsQuery = rowsQuery.ilike("source_wine", `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  const from = (page - 1) * PAGE_SIZE;

  const countFor = async (filter: StateFilter) => {
    let query = supabase.from("release_offer_match_review_view").select("*", { count: "exact", head: true });
    query = applyStateFilter(query, filter);
    const { count } = await query;
    return count ?? 0;
  };

  const [rowsResult, latestRunResult, unresolvedCount, candidateCount, linkedCount, suppressedCount] = await Promise.all([
    rowsQuery.range(from, from + PAGE_SIZE - 1),
    supabase.from("release_offer_match_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    countFor("unresolved"), countFor("candidates"), countFor("linked"), countFor("suppressed"),
  ]);
  if (rowsResult.error) throw new Error("Historic-offer match groups could not be loaded.");
  const groups = (rowsResult.data ?? []) as MatchGroupRow[];
  const groupKeys = groups.map((group) => group.match_group_key);
  const { data: suggestionData, error: suggestionError } = groupKeys.length === 0
    ? { data: [], error: null }
    : await supabase.from("release_offer_match_suggestion_view").select("*")
      .in("match_group_key", groupKeys).order("match_group_key").order("rank");
  if (suggestionError) throw new Error("Historic-offer suggestions could not be loaded.");
  const suggestions = (suggestionData ?? []) as SuggestionRow[];
  // Scoped to the visible page: this is a work queue, not a favourites list.
  const favourites = await loadGroupFavourites(owner, "release_offer", groups);
  const byGroup = new Map<string, SuggestionRow[]>();
  for (const suggestion of suggestions) {
    const values = byGroup.get(suggestion.match_group_key) ?? [];
    values.push(suggestion);
    byGroup.set(suggestion.match_group_key, values);
  }

  // The offer's own context (tasting note, price text, source link) — the signal
  // that disambiguates terse titles like "2012 Tinto". Fetched per visible group.
  const { data: recordData, error: recordError } = groupKeys.length === 0
    ? { data: [], error: null }
    : await supabase.from("release_offer_review_view")
      .select("import_id,source_row_number,offer_date,source_price_text,source_product_url,source_product_id,tasting_notes,description,match_group_key")
      .in("match_group_key", groupKeys).order("offer_date", { ascending: false });
  if (recordError) throw new Error("Historic-offer release info could not be loaded.");
  const recordsByGroup = new Map<string, ReleaseRecordRow[]>();
  for (const record of (recordData ?? []) as ReleaseRecordRow[]) {
    const values = recordsByGroup.get(record.match_group_key) ?? [];
    values.push(record);
    recordsByGroup.set(record.match_group_key, values);
  }

  const totalForState = rowsResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalForState / PAGE_SIZE));
  const currentParams = new URLSearchParams();
  currentParams.set("state", state);
  if (search) currentParams.set("q", search);
  currentParams.set("page", String(page));
  const returnPath = `${MATCH_PATH}?${currentParams.toString()}`;

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-accent">Release offers</p><h1 className="mt-1 text-2xl font-semibold">Match historic offers</h1><p className="mt-1 max-w-3xl text-sm text-ink-muted">Link accepted evidence to BBR Parent IDs. Catalogue identity is independent of current BBX eligibility.</p></div>
        <Link href="/release-prices" className="rounded border border-accent px-3 py-2 text-sm text-accent">Accepted offers</Link>
      </header>
      {(params.action_error || params.changed) && <p role={params.action_error ? "alert" : "status"} className="rounded border border-border bg-background p-3 text-sm">{params.action_error ? "The match decision could not be saved." : "The match decision was saved."}</p>}
      <MatchRunControl latest={runProgress(latestRunResult.data as Record<string, unknown> | null)} />
      <section className="grid gap-3 sm:grid-cols-4">
        {[["Unresolved groups", unresolvedCount, "unresolved"], ["With suggestions", candidateCount, "candidates"], ["Linked groups", linkedCount, "linked"], ["Suppressed groups", suppressedCount, "suppressed"]].map(([label, count, filter]) => <Link key={String(filter)} href={`${MATCH_PATH}?state=${filter}`} className={`rounded-lg border p-4 ${state === filter ? "border-accent bg-background" : "border-border bg-background"}`}><p className="text-xs uppercase text-ink-muted">{label}</p><p className="mt-1 text-xl font-semibold">{Number(count).toLocaleString()}</p></Link>)}
      </section>
      <section className="rounded-lg border border-border bg-background">
        <form className="flex flex-wrap gap-2 border-b border-border p-4">
          <input type="hidden" name="state" value={state} />
          <input type="search" name="q" defaultValue={search} placeholder="Search source wine" className="min-w-64 flex-1 rounded border border-border px-3 py-2 text-sm" />
          <button className="rounded border border-accent px-3 py-2 text-sm text-accent">Search</button>
          {search && <Link href={`${MATCH_PATH}?state=${state}`} className="rounded border border-border px-3 py-2 text-sm">Clear</Link>}
        </form>
        <div className="divide-y divide-border">
          {groups.map((group) => {
            const candidates = byGroup.get(group.match_group_key) ?? [];
            const records = (recordsByGroup.get(group.match_group_key) ?? []).filter(hasReleaseInfo);
            return <article key={group.match_group_key} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1"><h2 className="font-semibold">{group.source_wine}</h2><p className="mt-1 text-xs text-ink-muted">{group.source_vintage ?? "Vintage unavailable"} · {group.source_row_count.toLocaleString()} source records · offers {group.earliest_offer_date} to {group.latest_offer_date}</p></div>
                {(() => {
                  const target = targetForRecord("release_offer", group.parent_sku ? "linked" : null, group.parent_sku, group.match_group_key);
                  return target && <FavouriteStar target={target} favourite={isFavourited(favourites, target)} label={group.source_wine} />;
                })()}
                <div className="text-right text-xs"><p>{group.unresolved_row_count} unresolved · {group.linked_row_count} linked · {group.suppressed_row_count} suppressed</p>{group.parent_sku && <p className="mt-1 font-medium">Parent {group.parent_sku} · {displayMethod(group.match_method)}</p>}{group.parent_sku && <p className="text-ink-muted">{group.is_biddable ? "Currently in the BBX-eligible catalogue" : "Found in BBR catalogue, not currently BBX-eligible"}</p>}</div>
              </div>
              {records.length > 0 && <details className="mt-3 rounded border border-border bg-accent-soft/30 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-ink">Release info</summary>
                <div className="mt-2 space-y-3">
                  {records.map((record) => <div key={`${record.import_id}-${record.source_row_number}`} className="space-y-1">
                    {records.length > 1 && <p className="text-ink-muted">Offer {record.offer_date ?? "date unknown"}</p>}
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
              {group.unresolved_row_count > 0 && candidates.length > 0 && <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {candidates.map((candidate) => <div key={candidate.parent_sku} className="flex items-start justify-between gap-3 rounded border border-border p-3 text-xs"><div><p className="font-medium">#{candidate.rank} {candidate.name}</p><p className="mt-1 text-ink-muted">Parent {candidate.parent_sku} · {candidate.producer ?? "Producer unavailable"} · {candidate.region ?? "Region unavailable"}</p><p className="text-ink-muted">{candidate.stock_origin ?? "Stock origin unavailable"} · {candidate.purchase_mode ?? "Purchase mode unavailable"} · {candidate.is_biddable ? "BBX-eligible" : "not currently BBX-eligible"}{candidate.typo_count !== null ? ` · ${candidate.typo_count} typo${candidate.typo_count === 1 ? "" : "s"}` : ""}{typeof candidate.match_score === "number" ? ` · ${Math.round(candidate.match_score * 100)}% name match` : ""}</p></div><form action={confirmHistoricOfferCandidate.bind(null, group.match_group_key, candidate.parent_sku, returnPath)}><button className="rounded border border-accent px-2 py-1 text-accent">Confirm group</button></form></div>)}
              </div>}
              {group.unresolved_row_count > 0 && <div className="mt-3 flex flex-wrap items-start gap-3">
                <form action={confirmManualHistoricOfferMatch.bind(null, group.match_group_key, returnPath)} className="flex gap-2"><input name="parent_sku" inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Parent ID" className="w-40 rounded border border-border px-2 py-1.5 text-xs" required /><button className="rounded border border-border px-2 py-1.5 text-xs">Link manually</button></form>
                <form action={suppressHistoricOfferGroup.bind(null, group.match_group_key, returnPath)}><button className="rounded border border-border px-2 py-1.5 text-xs">Reject and suppress</button></form>
              </div>}
              {group.linked_row_count > 0 && <div className="mt-3 flex flex-wrap gap-2"><form action={editHistoricOfferGroup.bind(null, group.match_group_key, returnPath)} className="flex gap-2"><input name="parent_sku" inputMode="numeric" pattern="[0-9]{5,30}" defaultValue={group.parent_sku ?? ""} className="w-40 rounded border border-border px-2 py-1.5 text-xs" required /><button className="rounded border border-border px-2 py-1.5 text-xs">Edit linked Parent ID</button></form><form action={unlinkHistoricOfferGroup.bind(null, group.match_group_key, returnPath)}><button className="rounded border border-accent px-2 py-1.5 text-xs text-accent">Unlink and retry later</button></form></div>}
              {group.suppressed_row_count > 0 && <form action={restoreHistoricOfferGroup.bind(null, group.match_group_key, returnPath)} className="mt-3"><button className="rounded border border-border px-2 py-1.5 text-xs">Restore to unmatched</button></form>}
              {group.unresolved_row_count > 0 && <CatalogueCandidateSearch matchGroupKey={group.match_group_key} sourceWine={group.source_wine} sourceVintage={group.source_vintage} returnPath={returnPath} />}
              <div className="mt-3 border-t border-border pt-3"><ExcludeHistoricOfferGroupForm matchGroupKey={group.match_group_key} recordCount={group.source_row_count} returnPath={returnPath} /></div>
            </article>;
          })}
          {groups.length === 0 && <p className="p-6 text-sm text-ink-muted">No match groups meet this filter.</p>}
        </div>
        <nav className="flex items-center justify-between border-t border-border p-4 text-sm"><span>Page {page} of {totalPages}</span><div className="flex gap-2">{page > 1 && <Link href={`${MATCH_PATH}?state=${state}&page=${page - 1}${search ? `&q=${encodeURIComponent(search)}` : ""}`} className="rounded border border-border px-3 py-1.5">Previous</Link>}{page < totalPages && <Link href={`${MATCH_PATH}?state=${state}&page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ""}`} className="rounded border border-border px-3 py-1.5">Next</Link>}</div></nav>
      </section>
    </div>
  </main>;
}

const MATCH_PATH = "/release-prices/matches";
