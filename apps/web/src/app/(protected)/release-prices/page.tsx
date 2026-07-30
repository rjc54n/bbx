import { AcceptedOfferBrowser, type AcceptedOfferRow } from "@/components/releaseOffers/AcceptedOfferBrowser";
import { requireOwner } from "@/lib/auth/owner";
import { loadFavourites } from "@/lib/favourites/server";

export const dynamic = "force-dynamic";

export default async function ReleasePricesPage() {
  const owner = await requireOwner();
  const { supabase } = owner;
  const rows: AcceptedOfferRow[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("release_offer_review_view").select("*")
      .order("offer_date", { ascending: false }).order("source_row_number", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("Accepted release-offer records could not be loaded.");
    const page = (data ?? []) as AcceptedOfferRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const { parentSkus, pending } = await loadFavourites(owner, "release_offer");

  return <AcceptedOfferBrowser
    rows={rows}
    favouriteParentSkus={parentSkus}
    pendingFavourites={pending}
  />;
}
