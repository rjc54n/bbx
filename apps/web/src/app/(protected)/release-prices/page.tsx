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
    let request = supabase.from("release_offer_review_view").select("*", { count: "exact" });
    if (query.search) request = request.or(buildAcceptedOfferSearchFilter(query.search));
    const { from, to } = acceptedOfferRange(page);
    return request
      .order("offer_date", { ascending: false })
      .order("source_row_number", { ascending: true })
      .order("import_id", { ascending: true })
      .range(from, to);
  }

  let { data, count, error } = await loadPage(query.page);
  if (error) throw new Error(`Accepted release-offer records could not be loaded: ${error.message}`);
  const page = acceptedOfferPageForCount(query.page, count ?? 0);
  if (page !== query.page) {
    ({ data, count, error } = await loadPage(page));
    if (error) throw new Error(`Accepted release-offer records could not be loaded: ${error.message}`);
  }
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
