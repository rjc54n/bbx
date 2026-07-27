import { AcceptedOfferBrowser, type AcceptedOfferRow } from "@/components/releaseOffers/AcceptedOfferBrowser";
import { requireOwner } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

export default async function ReleasePricesPage() {
  const { supabase } = await requireOwner();
  const { data, error } = await supabase.from("release_offer_review_view").select("*").order("offer_date", { ascending: false }).order("source_row_number", { ascending: true }).limit(10_000);
  if (error) throw new Error("Accepted release-offer records could not be loaded.");
  return <AcceptedOfferBrowser rows={(data ?? []) as AcceptedOfferRow[]} />;
}
