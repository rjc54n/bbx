import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { loadGroupFavourites } from "@/lib/favourites/server";
import { isFavourited, targetForRecord, type FavouriteState } from "@/lib/favourites/target";
import { cellarTrackerCatalogueQuery } from "@/lib/cellar/cellartrackerMatching";
import {
  loadCellarTrackerPanels,
  type CellarTrackerEvidenceRow,
  type CellarTrackerGroupPanel,
} from "@/lib/matching/cellartrackerPanels";
import { MATCH_SOURCES, type MatchSource } from "@/lib/matching/adapters";
import { MatchGroupList, type MatchGroupView } from "@/components/matching/MatchGroupList";
import { Pagination } from "@/components/nav/Pagination";
import { MatchRunControl } from "@/components/releaseOffers/MatchRunControl";
import { CellarTrackerMatchRunControl } from "@/app/(protected)/cellartracker/matches/MatchRunControl";
import { type MatchRunProgress } from "@/app/(protected)/release-prices/matches/actions";
import { type CellarTrackerMatchProgress } from "@/app/(protected)/cellartracker/matches/actions";

export const dynamic = "force-dynamic";

const MATCH_PATH = "/matches";
const PAGE_SIZE = 50;

const STATES = ["needs-review", "with-suggestions", "linked", "no-suitable-match", "all"] as const;
type StateFilter = (typeof STATES)[number];

const SOURCE_FILTERS = ["all", ...MATCH_SOURCES] as const;
type SourceFilter = (typeof SOURCE_FILTERS)[number];

const SOURCE_LABEL: Record<SourceFilter, string> = {
  all: "All sources",
  release_offer: "Release offers",
  cellartracker: "CellarTracker",
};

const STATE_LABEL: Record<StateFilter, string> = {
  "needs-review": "Needs review",
  "with-suggestions": "With suggestions",
  linked: "Linked",
  "no-suitable-match": "No suitable match",
  all: "All groups",
};

// The common projection of public.wine_match_review_view (spec §3.2). Source
// -specific columns (offer dates, producer/region) are fetched per source below.
type ReviewRow = {
  source: MatchSource;
  match_group_key: string;
  wine_ref: string | null;
  parent_sku: string | null;
  match_method: string | null;
  source_wine: string;
  source_vintage: number | null;
  source_row_count: number;
  unresolved_row_count: number;
  linked_row_count: number;
  suppressed_row_count: number;
  is_bbx_eligible: boolean;
  suggestion_count: number;
  top_match_score: number | null;
  suggestions_observed_at: string | null;
  last_run_status: string | null;
  last_error_at: string | null;
};

type SuggestionRow = {
  match_group_key: string;
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

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function escapeLike(value: string): string {
  return value.replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function hasReleaseInfo(record: ReleaseRecordRow): boolean {
  return Boolean(
    record.source_price_text?.trim() || record.tasting_notes?.trim()
    || record.description?.trim() || record.source_product_url?.trim() || record.source_product_id?.trim(),
  );
}

// State predicates on the union view. `needs-review` is
// `unresolved_row_count > 0 OR last_run_status = 'failed'` (spec §3.5); the
// others are single-column comparisons.
const NEEDS_REVIEW_OR = "unresolved_row_count.gt.0,last_run_status.eq.failed";

function applyStateFilter<T extends {
  or(filters: string): T;
  gt(column: string, value: number): T;
  eq(column: string, value: number): T;
}>(query: T, state: StateFilter): T {
  if (state === "needs-review") return query.or(NEEDS_REVIEW_OR);
  if (state === "with-suggestions") return query.or(NEEDS_REVIEW_OR).gt("suggestion_count", 0);
  if (state === "linked") return query.gt("linked_row_count", 0).eq("unresolved_row_count", 0);
  if (state === "no-suitable-match") return query.gt("suppressed_row_count", 0).eq("unresolved_row_count", 0);
  return query;
}

function runProgress(row: Record<string, unknown> | null): (MatchRunProgress & CellarTrackerMatchProgress) | null {
  if (!row || typeof row.id !== "string") return null;
  return {
    runId: row.id,
    status: String(row.status),
    total: Number(row.total_group_count),
    processed: Number(row.processed_group_count),
    remaining: Number(row.remaining_group_count),
    errors: Number(row.error_group_count),
    suppliedLinks: Number(row.supplied_id_link_count ?? 0),
    localExactLinks: Number(row.local_exact_link_count ?? 0),
    algoliaExactLinks: Number(row.algolia_exact_link_count ?? 0),
  };
}

function releaseSubtitle(
  group: ReviewRow,
  dates: { earliest: string | null; latest: string | null } | undefined,
): string {
  const vintage = group.source_vintage ?? "Vintage unavailable";
  const records = `${group.source_row_count.toLocaleString()} source record${group.source_row_count === 1 ? "" : "s"}`;
  const span = dates?.earliest && dates.latest
    ? ` · offers ${dates.earliest.slice(0, 10)} to ${dates.latest.slice(0, 10)}`
    : "";
  return `${vintage} · ${records}${span}`;
}

function cellarSubtitle(
  group: ReviewRow,
  detail: { producer: string | null; region: string | null } | undefined,
): string {
  const vintage = group.source_vintage ?? "Vintage unavailable";
  const producer = detail?.producer ?? "Producer unavailable";
  const region = detail?.region ?? "Region unavailable";
  const records = `${group.source_row_count.toLocaleString()} source record${group.source_row_count === 1 ? "" : "s"}`;
  return `${vintage} · ${producer} · ${region} · ${records}`;
}

function mergeFavourites(states: FavouriteState[]): FavouriteState {
  return {
    parentSkus: new Set(states.flatMap((state) => [...state.parentSkus])),
    pendingKeys: new Set(states.flatMap((state) => [...state.pendingKeys])),
  };
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sourceParam = firstParam(params.source);
  const sourceFilter: SourceFilter = sourceParam === "release_offer" || sourceParam === "cellartracker"
    ? sourceParam
    : "all";
  const stateParam = firstParam(params.state);
  const state: StateFilter = STATES.includes(stateParam as StateFilter) ? (stateParam as StateFilter) : "needs-review";
  const search = firstParam(params.q)?.trim().slice(0, 200) ?? "";
  const page = Math.max(1, Number(firstParam(params.page) ?? "1") || 1);

  const owner = await requireOwner();
  const { supabase } = owner;

  // --- Wave 1: the union list, the exact-count summary, and the run banners ---

  let rowsQuery = supabase.from("wine_match_review_view").select("*", { count: "exact" })
    // Ordering (spec §3.5): failed runs first (last_error_at is only set when a
    // run failed), then most-suggested / best-scored, then the identity.
    .order("last_error_at", { ascending: false, nullsFirst: false })
    .order("suggestion_count", { ascending: false })
    .order("top_match_score", { ascending: false, nullsFirst: false })
    .order("source", { ascending: true })
    .order("match_group_key", { ascending: true });
  if (sourceFilter !== "all") rowsQuery = rowsQuery.eq("source", sourceFilter);
  rowsQuery = applyStateFilter(rowsQuery, state);
  if (search) rowsQuery = rowsQuery.ilike("source_wine", `%${escapeLike(search)}%`);
  const from = (page - 1) * PAGE_SIZE;

  const wantRelease = sourceFilter !== "cellartracker";
  const wantCellar = sourceFilter !== "release_offer";

  const [rowsResult, summaryResult, releaseRunResult, cellarRunResult] = await Promise.all([
    rowsQuery.range(from, from + PAGE_SIZE - 1),
    supabase.rpc("wine_match_queue_summary", sourceFilter === "all" ? {} : { p_source: sourceFilter }),
    wantRelease
      ? supabase.from("release_offer_match_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    wantCellar
      ? supabase.from("cellartracker_match_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (rowsResult.error) throw new Error(`Match groups could not be loaded: ${rowsResult.error.message}`);
  if (summaryResult.error) throw new Error(`Queue summary could not be loaded: ${summaryResult.error.message}`);

  const groups = (rowsResult.data ?? []) as ReviewRow[];
  const summary = summaryResult.data?.[0] ?? {
    needs_review: 0, with_suggestions: 0, linked: 0, no_suitable_match: 0, all_groups: 0,
  };

  const releaseGroups = groups.filter((group) => group.source === "release_offer");
  const cellarGroups = groups.filter((group) => group.source === "cellartracker");
  const releaseKeys = releaseGroups.map((group) => group.match_group_key);
  const cellarKeys = cellarGroups.map((group) => group.match_group_key);

  // --- Wave 2: per-source detail for the visible page only (spec §3.4) --------
  //
  // Each fetch is scoped to the visible keys and throws its own cause; the panel
  // and favourite loaders already return final shapes.

  async function rows<T>(keys: string[], run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
    if (keys.length === 0) return [];
    const { data, error } = await run();
    if (error) throw new Error(`${what} could not be loaded: ${error.message}`);
    return (data ?? []) as T[];
  }

  const [
    releaseDetailRows, releaseRecordRows, releaseSuggestionRows,
    cellarDetailRows, cellarPanels, cellarSuggestionRows,
    releaseFav, cellarFav,
  ] = await Promise.all([
    rows<{ match_group_key: string; earliest_offer_date: string | null; latest_offer_date: string | null }>(
      releaseKeys,
      () => supabase.from("release_offer_match_review_view").select("match_group_key,earliest_offer_date,latest_offer_date").in("match_group_key", releaseKeys),
      "Release offer dates",
    ),
    rows<ReleaseRecordRow>(
      releaseKeys,
      () => supabase.from("release_offer_review_view")
        .select("import_id,source_row_number,offer_date,source_price_text,source_product_url,source_product_id,tasting_notes,description,match_group_key")
        .in("match_group_key", releaseKeys).order("offer_date", { ascending: false }),
      "Release info",
    ),
    rows<SuggestionRow>(
      releaseKeys,
      () => supabase.from("release_offer_match_suggestion_view")
        .select("match_group_key,parent_sku,rank,name,producer,region,stock_origin,purchase_mode,typo_count,is_biddable,match_score")
        .in("match_group_key", releaseKeys).order("match_group_key").order("rank"),
      "Release offer suggestions",
    ),
    rows<{ match_group_key: string; source_producer: string | null; source_region: string | null }>(
      cellarKeys,
      () => supabase.from("cellartracker_match_review_view").select("match_group_key,source_producer,source_region").in("match_group_key", cellarKeys),
      "CellarTracker producer and region",
    ),
    loadCellarTrackerPanels(async (keys) => {
      const { data, error } = await supabase.from("current_cellartracker_records")
        .select("match_group_key,quantity_home,quantity_bbr,total_quantity,accepted_at,producer,region")
        .in("match_group_key", [...keys]);
      if (error) throw new Error(`CellarTracker holdings could not be loaded: ${error.message}`);
      return (data ?? []) as CellarTrackerEvidenceRow[];
    }, cellarKeys),
    rows<SuggestionRow>(
      cellarKeys,
      () => supabase.from("cellartracker_match_suggestion_view")
        .select("match_group_key,parent_sku,rank,name,producer,region,stock_origin,purchase_mode,typo_count,is_biddable,match_score")
        .in("match_group_key", cellarKeys).order("match_group_key").order("rank"),
      "CellarTracker suggestions",
    ),
    releaseGroups.length === 0
      ? Promise.resolve<FavouriteState>({ parentSkus: new Set<string>(), pendingKeys: new Set<string>() })
      : loadGroupFavourites(owner, "release_offer", releaseGroups),
    cellarGroups.length === 0
      ? Promise.resolve<FavouriteState>({ parentSkus: new Set<string>(), pendingKeys: new Set<string>() })
      : loadGroupFavourites(owner, "cellartracker", cellarGroups),
  ]);

  const favourites = mergeFavourites([releaseFav, cellarFav]);

  const releaseDates = new Map(releaseDetailRows.map((row) => [row.match_group_key, {
    earliest: row.earliest_offer_date, latest: row.latest_offer_date,
  }]));
  const cellarDetailByKey = new Map(cellarDetailRows.map((row) => [row.match_group_key, {
    producer: row.source_producer, region: row.source_region,
  }]));

  const recordsByGroup = new Map<string, ReleaseRecordRow[]>();
  for (const record of releaseRecordRows) {
    const values = recordsByGroup.get(record.match_group_key) ?? [];
    values.push(record);
    recordsByGroup.set(record.match_group_key, values);
  }

  const suggestionsByGroup = new Map<string, SuggestionRow[]>();
  for (const suggestion of [...releaseSuggestionRows, ...cellarSuggestionRows]) {
    const values = suggestionsByGroup.get(suggestion.match_group_key) ?? [];
    values.push(suggestion);
    suggestionsByGroup.set(suggestion.match_group_key, values);
  }

  const groupViews: MatchGroupView[] = groups.map((group) => {
    const target = targetForRecord(
      group.source, group.parent_sku ? "linked" : null, group.parent_sku, group.match_group_key,
    );
    const candidates = (suggestionsByGroup.get(group.match_group_key) ?? []).map((candidate) => ({
      parent_sku: candidate.parent_sku,
      rank: candidate.rank,
      name: candidate.name,
      producer: candidate.producer,
      region: candidate.region,
      stock_origin: candidate.stock_origin,
      purchase_mode: candidate.purchase_mode,
      typo_count: candidate.typo_count,
      is_bbx_eligible: candidate.is_biddable,
      match_score: candidate.match_score,
    }));

    let panel: MatchGroupView["panel"];
    let subtitle: string;
    let catalogueSearchQuery: string;
    if (group.source === "release_offer") {
      subtitle = releaseSubtitle(group, releaseDates.get(group.match_group_key));
      catalogueSearchQuery = group.source_wine;
      panel = {
        kind: "release_offer",
        records: (recordsByGroup.get(group.match_group_key) ?? []).filter(hasReleaseInfo).map((record) => ({
          import_id: record.import_id,
          source_row_number: record.source_row_number,
          offer_date: record.offer_date,
          source_price_text: record.source_price_text,
          source_product_url: record.source_product_url,
          tasting_notes: record.tasting_notes,
          description: record.description,
        })),
      };
    } else {
      const detail = cellarDetailByKey.get(group.match_group_key);
      const holding: CellarTrackerGroupPanel | undefined = cellarPanels.get(group.match_group_key);
      subtitle = cellarSubtitle(group, detail);
      catalogueSearchQuery = cellarTrackerCatalogueQuery(group.source_wine, detail?.producer ?? holding?.producer ?? null);
      panel = {
        kind: "cellartracker",
        producer: holding?.producer ?? detail?.producer ?? null,
        region: holding?.region ?? detail?.region ?? null,
        quantityHome: holding?.quantityHome ?? 0,
        quantityBbr: holding?.quantityBbr ?? 0,
        totalQuantity: holding?.totalQuantity ?? 0,
        acceptedAt: holding?.acceptedAt ?? null,
      };
    }

    return {
      source: group.source,
      match_group_key: group.match_group_key,
      source_wine: group.source_wine,
      source_vintage: group.source_vintage,
      subtitle,
      source_row_count: group.source_row_count,
      unresolved_row_count: group.unresolved_row_count,
      linked_row_count: group.linked_row_count,
      suppressed_row_count: group.suppressed_row_count,
      parent_sku: group.parent_sku,
      match_method: group.match_method,
      is_bbx_eligible: group.is_bbx_eligible,
      candidates,
      catalogueSearchQuery,
      panel,
      favouriteTarget: target,
      isFavourite: target ? isFavourited(favourites, target) : false,
    };
  });

  const totalForState = rowsResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalForState / PAGE_SIZE));

  const returnParams = new URLSearchParams();
  returnParams.set("source", sourceFilter);
  returnParams.set("state", state);
  if (search) returnParams.set("q", search);
  returnParams.set("page", String(page));
  const returnPath = `${MATCH_PATH}?${returnParams.toString()}`;

  const stateChips: Array<[StateFilter, number]> = [
    ["needs-review", Number(summary.needs_review)],
    ["with-suggestions", Number(summary.with_suggestions)],
    ["linked", Number(summary.linked)],
    ["no-suitable-match", Number(summary.no_suitable_match)],
    ["all", Number(summary.all_groups)],
  ];

  function sourceHref(next: SourceFilter): string {
    const query = new URLSearchParams({ source: next, state });
    return `${MATCH_PATH}?${query.toString()}`;
  }
  function stateHref(next: StateFilter): string {
    const query = new URLSearchParams({ source: sourceFilter, state: next });
    return `${MATCH_PATH}?${query.toString()}`;
  }

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Matching</p>
          <h1 className="mt-1 text-2xl font-semibold">Link source wines to BBR Parent IDs</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">Release offers and CellarTracker holdings in one queue. Catalogue identity is independent of current BBX eligibility.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/release-prices" className="rounded border border-accent px-3 py-2 text-sm text-accent">Accepted offers</Link>
          <Link href="/cellartracker" className="rounded border border-accent px-3 py-2 text-sm text-accent">My CellarTracker</Link>
        </div>
      </header>

      {(params.action_error || params.changed) && <p role={params.action_error ? "alert" : "status"} className="rounded border border-border bg-background p-3 text-sm">{params.action_error ? "The match decision could not be saved." : "The match decision was saved."}</p>}

      <div className="flex flex-wrap gap-2">
        {SOURCE_FILTERS.map((value) => <Link key={value} href={sourceHref(value)} aria-current={sourceFilter === value ? "true" : undefined} className={`rounded-full border px-3 py-1.5 text-sm ${sourceFilter === value ? "border-accent bg-accent text-accent-ink" : "border-border bg-background text-ink-muted hover:text-ink"}`}>{SOURCE_LABEL[value]}</Link>)}
      </div>

      {wantRelease && <MatchRunControl latest={runProgress(releaseRunResult.data as Record<string, unknown> | null)} />}
      {wantCellar && <CellarTrackerMatchRunControl latest={runProgress(cellarRunResult.data as Record<string, unknown> | null)} />}

      <section className="grid gap-3 sm:grid-cols-5">
        {stateChips.map(([value, count]) => <Link key={value} href={stateHref(value)} className={`rounded-lg border p-4 ${state === value ? "border-accent bg-background" : "border-border bg-background"}`}><p className="text-xs uppercase text-ink-muted">{STATE_LABEL[value]}</p><p className="mt-1 text-xl font-semibold">{count.toLocaleString()}</p></Link>)}
      </section>

      <section className="rounded-lg border border-border bg-background">
        <form className="flex flex-wrap gap-2 border-b border-border p-4">
          <input type="hidden" name="source" value={sourceFilter} />
          <input type="hidden" name="state" value={state} />
          <input type="search" name="q" defaultValue={search} placeholder="Search source wine" className="min-w-64 flex-1 rounded border border-border px-3 py-2 text-sm" />
          <button className="rounded border border-accent px-3 py-2 text-sm text-accent">Search</button>
          {search && <Link href={stateHref(state)} className="rounded border border-border px-3 py-2 text-sm">Clear</Link>}
        </form>
        <MatchGroupList groups={groupViews} state={state} returnPath={returnPath} />
        <Pagination
          page={page}
          totalPages={totalPages}
          totalCount={totalForState}
          label="groups"
          basePath={MATCH_PATH}
          query={search ? { source: sourceFilter, state, q: search } : { source: sourceFilter, state }}
        />
      </section>
    </div>
  </main>;
}
