import { FavouritesBrowser } from "@/components/favourites/FavouritesBrowser";
import { requireOwner } from "@/lib/auth/owner";
import type { FavouriteWineRow, PendingFavouriteRow } from "@/lib/favourites/browser";
import { timeProtectedQuery } from "@/lib/observability/routeTiming";

export const dynamic = "force-dynamic";

export default async function FavouritesPage() {
  const { supabase, userId } = await requireOwner();

  // Both views are already owner-scoped by RLS on the underlying tables; the
  // explicit user_id filter keeps the intent visible at the call site.
  const [wines, pending] = await timeProtectedQuery("/favourites", "favourites_views", () => Promise.all([
    supabase.from("favourite_wine_view").select("*").eq("user_id", userId),
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
  const wineRows = (wines.data ?? [])
    .filter((row): row is typeof row & { parent_sku: string } => Boolean(row.parent_sku)) as FavouriteWineRow[];
  const pendingRows = (pending.data ?? [])
    .filter((row): row is typeof row & { source: string; match_group_key: string } =>
      Boolean(row.source) && Boolean(row.match_group_key)) as PendingFavouriteRow[];

  return <main className="flex min-h-0 flex-1 flex-col">
    <FavouritesBrowser wines={wineRows} pending={pendingRows} />
  </main>;
}
