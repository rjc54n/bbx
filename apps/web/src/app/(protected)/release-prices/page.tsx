import { AcceptedOfferBrowser, type AcceptedOfferRow } from "@/components/releaseOffers/AcceptedOfferBrowser";
import { requireOwner } from "@/lib/auth/owner";
import { loadFavourites } from "@/lib/favourites/server";
import {
  acceptedOfferPageForCount,
  acceptedOfferRange,
  buildAcceptedOfferSearchFilter,
  parseAcceptedOfferQuery,
} from "@/lib/releaseOffers/reviewBrowser";

export const dynamic = "force-dynamic";

export default async function ReleasePricesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawQuery = await searchParams;
  const query = parseAcceptedOfferQuery(rawQuery);
  const owner = await requireOwner();
  const { supabase } = owner;

  async function loadPage(page: number) {
    // "estimated" reads the planner's row estimate instead of full-scanning the
    // aggregate release_offer_review_view, which would time out as accepted
    // offers accumulate. The header total is therefore approximate.
    let request = supabase.from("release_offer_review_view").select("*", { count: "estimated" });
    if (query.search) request = request.or(buildAcceptedOfferSearchFilter(query.search));
    const { from, to } = acceptedOfferRange(page);
    return request
      .order("offer_date", { ascending: false })
      .order("source_row_number", { ascending: true })
      .order("import_id", { ascending: true })
      .range(from, to);
  }

  let page = query.page;
  let { data, count, error } = await loadPage(page);
  // A page past the final row returns a PostgREST 416 (error, no data). React to
  // that by clamping to the last page the estimate allows and retrying; if the
  // estimate is unusable, fall back to page 1, which can never be out of range.
  if (error && page > 1) {
    const clamped = acceptedOfferPageForCount(page, count ?? 0);
    page = clamped < page ? clamped : 1;
    ({ data, count, error } = await loadPage(page));
  }
  if (error) throw new Error(`Accepted release-offer records could not be loaded: ${error.message}`);
  const rows = (data ?? []) as AcceptedOfferRow[];
  const [{ parentSkus, pending }, { count: excludedCount }] = await Promise.all([
    loadFavourites(owner, "release_offer"),
    supabase.from("release_offer_excluded_record_view").select("*", { count: "exact", head: true }),
  ]);

  return <AcceptedOfferBrowser
    rows={rows}
    page={page}
    search={query.search}
    totalRows={count ?? 0}
    favouriteParentSkus={parentSkus}
    pendingFavourites={pending}
    excludedCount={excludedCount ?? 0}
    justExcluded={rawQuery.excluded === "1"}
  />;
}
