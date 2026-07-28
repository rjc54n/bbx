import { AcceptedOfferBrowser, type AcceptedOfferRow } from "@/components/releaseOffers/AcceptedOfferBrowser";
import { requireOwner } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

export default async function ReleasePricesPage() {
  const { supabase, userId } = await requireOwner();
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
  const { data: favouriteRows, error: favouriteError } = await supabase
    .from("release_price_favourites")
    .select("parent_sku")
    .eq("user_id", userId);
  if (favouriteError) throw new Error("Release-price favourites could not be loaded.");

  return <AcceptedOfferBrowser
    rows={rows}
    favouriteParentSkus={(favouriteRows ?? []).map((row) => row.parent_sku)}
  />;
}
