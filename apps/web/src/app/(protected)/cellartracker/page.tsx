import { requireOwner } from "@/lib/auth/owner";
import { loadFavourites } from "@/lib/favourites/server";
import {
  CellarTrackerRecordsBrowser,
  type CellarTrackerMarketRow,
} from "@/components/cellartracker/CellarTrackerRecordsBrowser";
import {
  buildCellarTrackerRecordsSearchFilter,
  cellarTrackerRecordsPageForCount,
  cellarTrackerRecordsRange,
  parseCellarTrackerRecordsQuery,
} from "@/lib/cellartracker/recordsBrowser";

export const dynamic = "force-dynamic";

export default async function CellarTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawQuery = await searchParams;
  const query = parseCellarTrackerRecordsQuery(rawQuery);
  const owner = await requireOwner();
  const { supabase } = owner;

  async function loadPage(page: number) {
    // The snapshot is small, so an exact count is cheap here (unlike the release
    // offers view). Tiebreakers after source_wine keep pages stable.
    let request = supabase.from("current_cellartracker_records").select("*", { count: "exact" });
    if (query.search) request = request.or(buildCellarTrackerRecordsSearchFilter(query.search));
    const { from, to } = cellarTrackerRecordsRange(page);
    return request
      .order("source_wine", { ascending: true })
      .order("import_id", { ascending: true })
      .order("source_row_number", { ascending: true })
      .range(from, to);
  }

  let page = query.page;
  let { data, count, error } = await loadPage(page);
  // A page past the final row returns a PostgREST 416. Clamp to the last page
  // the count allows and retry; fall back to page 1 if the count is unusable.
  if (error && page > 1) {
    const clamped = cellarTrackerRecordsPageForCount(page, count ?? 0);
    page = clamped < page ? clamped : 1;
    ({ data, count, error } = await loadPage(page));
  }
  if (error) throw new Error(`CellarTracker records could not be loaded: ${error.message}`);
  const rows = (data ?? []) as CellarTrackerMarketRow[];

  const [
    { parentSkus, pending },
    { count: excludedCount },
    { count: cellarRecords },
    { data: statsRows, error: statsError },
  ] = await Promise.all([
    loadFavourites(owner, "cellartracker"),
    supabase.from("cellartracker_excluded_record_view").select("*", { count: "exact", head: true }),
    // Whole-snapshot totals for the header, independent of search and page.
    supabase.from("current_cellartracker_records").select("*", { count: "exact", head: true }),
    supabase.from("current_cellartracker_records").select("quantity_home,quantity_bbr"),
  ]);
  if (statsError) throw new Error("CellarTracker snapshot totals could not be loaded.");
  const cellarBottles = ((statsRows ?? []) as { quantity_home: number; quantity_bbr: number }[])
    .reduce((total, row) => total + row.quantity_home + row.quantity_bbr, 0);

  return <CellarTrackerRecordsBrowser
    rows={rows}
    page={page}
    search={query.search}
    totalRows={count ?? 0}
    cellarRecords={cellarRecords ?? 0}
    cellarBottles={cellarBottles}
    favouriteParentSkus={parentSkus}
    pendingFavourites={pending}
    excludedCount={excludedCount ?? 0}
    justExcluded={rawQuery.excluded === "1"}
  />;
}
