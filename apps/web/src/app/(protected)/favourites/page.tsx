import { FavouritesBrowser } from "@/components/favourites/FavouritesBrowser";
import { requireOwner } from "@/lib/auth/owner";
import { mergeFavouriteReferences, type FavouriteWineRow, type PendingFavouriteRow } from "@/lib/favourites/browser";
import { timeProtectedQuery } from "@/lib/observability/routeTiming";

export const dynamic = "force-dynamic";

export default async function FavouritesPage() {
  const { supabase, userId } = await requireOwner();

  // Both views are already owner-scoped by RLS on the underlying tables; the
  // explicit user_id filter keeps the intent visible at the call site.
  const [wines, pending] = await timeProtectedQuery("/favourites", "favourites_views", () => Promise.all([
    supabase.from("favourite_wine_view")
      .select("parent_sku,favourited_at,wine_name,vintage,producer,country,region,subregion,colour,product_url,in_tracked_catalogue,format_count,listed_format_count,lowest_ask_per_bottle_p,highest_bid_per_bottle_p,cellartracker_bottles_home,cellartracker_bottles_bbr,cellartracker_paid_per_bottle_p,cellartracker_record_count,bbr_cellar_bottles,bbr_cellar_holding_count,release_offer_record_count")
      .eq("user_id", userId),
    supabase.from("pending_favourite_view").select("*").eq("user_id", userId)
      .order("favourited_at", { ascending: false }),
  ]));
  if (wines.error) {
    throw new Error(`Favourited wines could not be loaded: ${wines.error.message} (${wines.error.code})`);
  }
  if (pending.error) {
    throw new Error(`Pending favourites could not be loaded: ${pending.error.message} (${pending.error.code})`);
  }

  // The views expose every column as nullable because they are views; the rows
  // are only useful with a key, so anything without one is dropped rather than
  // rendered as a row that cannot be starred or opened.
  const baseWineRows = (wines.data ?? [])
    .filter((row): row is typeof row & { parent_sku: string } => Boolean(row.parent_sku)) as Omit<FavouriteWineRow,
      "reference_price_per_bottle_p" | "reference_source_kind" | "reference_date" | "reference_needs_review" | "ask_vs_reference_pct">[];
  const parentSkus = baseWineRows.map((row) => row.parent_sku);
  const [market, references] = parentSkus.length > 0
    ? await timeProtectedQuery("/favourites", "favourites_reference", () => Promise.all([
      supabase.from("catalogue_mv")
        .select("parent_sku,case_size,bottle_volume_ml,ask,highest_bid_p,is_listed")
        .in("parent_sku", parentSkus).eq("bottle_volume_ml", 750).gt("case_size", 0),
      supabase.from("resolved_reference_price_view")
        .select("parent_sku,price_per_75cl_p,source_kind,reference_date,needs_review")
        .in("parent_sku", parentSkus),
    ]))
    : [{ data: [], error: null }, { data: [], error: null }];
  if (market.error) throw new Error(`Favourites market prices could not be loaded: ${market.error.message}`);
  if (references.error) throw new Error(`Favourites references could not be loaded: ${references.error.message}`);
  const wineRows = mergeFavouriteReferences(baseWineRows, market.data ?? [], references.data ?? []);
  const pendingRows = (pending.data ?? [])
    .filter((row): row is typeof row & { source: string; match_group_key: string } =>
      Boolean(row.source) && Boolean(row.match_group_key)) as PendingFavouriteRow[];

  return <main className="flex min-h-0 flex-1 flex-col">
    <FavouritesBrowser wines={wineRows} pending={pendingRows} />
  </main>;
}
