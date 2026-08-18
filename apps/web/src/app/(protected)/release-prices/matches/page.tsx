import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { loadGroupFavourites } from "@/lib/favourites/server";
import { isFavourited, targetForRecord } from "@/lib/favourites/target";
import { MatchRunControl } from "@/components/releaseOffers/MatchRunControl";
import { MatchGroupList, type MatchGroupView } from "@/components/releaseOffers/MatchGroupList";
import { type MatchRunProgress } from "./actions";

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

  // Estimated (planner) counts, not exact: these four tallies are a work-queue
  // gauge, not an audit, and an exact count re-scans the view on every reload
  // after a mutation — the bulk of the post-confirm pause. The paginated rows
  // query below keeps count: "exact" so its page total stays precise.
  const countFor = async (filter: StateFilter) => {
    let query = supabase.from("release_offer_match_review_view").select("*", { count: "estimated", head: true });
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

  // Assemble the serialisable view the client list renders. targetForRecord and
  // isFavourited are pure, so the star is resolved here and passed down as data.
  const groupViews: MatchGroupView[] = groups.map((group) => {
    const target = targetForRecord("release_offer", group.parent_sku ? "linked" : null, group.parent_sku, group.match_group_key);
    return {
      match_group_key: group.match_group_key,
      source_wine: group.source_wine,
      source_vintage: group.source_vintage,
      earliest_offer_date: group.earliest_offer_date,
      latest_offer_date: group.latest_offer_date,
      source_row_count: group.source_row_count,
      unresolved_row_count: group.unresolved_row_count,
      linked_row_count: group.linked_row_count,
      suppressed_row_count: group.suppressed_row_count,
      parent_sku: group.parent_sku,
      match_method: group.match_method,
      is_biddable: group.is_biddable,
      candidates: (byGroup.get(group.match_group_key) ?? []).map((candidate) => ({
        parent_sku: candidate.parent_sku,
        rank: candidate.rank,
        name: candidate.name,
        producer: candidate.producer,
        region: candidate.region,
        stock_origin: candidate.stock_origin,
        purchase_mode: candidate.purchase_mode,
        typo_count: candidate.typo_count,
        is_biddable: candidate.is_biddable,
        match_score: candidate.match_score,
      })),
      records: (recordsByGroup.get(group.match_group_key) ?? []).filter(hasReleaseInfo).map((record) => ({
        import_id: record.import_id,
        source_row_number: record.source_row_number,
        offer_date: record.offer_date,
        source_price_text: record.source_price_text,
        source_product_url: record.source_product_url,
        tasting_notes: record.tasting_notes,
        description: record.description,
      })),
      favouriteTarget: target,
      isFavourite: target ? isFavourited(favourites, target) : false,
    };
  });

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
        <MatchGroupList groups={groupViews} state={state} returnPath={returnPath} />
        <nav className="flex items-center justify-between border-t border-border p-4 text-sm"><span>Page {page} of {totalPages}</span><div className="flex gap-2">{page > 1 && <Link href={`${MATCH_PATH}?state=${state}&page=${page - 1}${search ? `&q=${encodeURIComponent(search)}` : ""}`} className="rounded border border-border px-3 py-1.5">Previous</Link>}{page < totalPages && <Link href={`${MATCH_PATH}?state=${state}&page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ""}`} className="rounded border border-border px-3 py-1.5">Next</Link>}</div></nav>
      </section>
    </div>
  </main>;
}

const MATCH_PATH = "/release-prices/matches";
