import "server-only";

import type { OwnerContext } from "@/lib/auth/owner";
import {
  buildFavouriteState,
  type FavouriteSource,
  type FavouriteState,
  type FavouriteTarget,
} from "./target";

/**
 * Favourite state for one page of match-review groups. Scoped to the visible
 * keys rather than loading every favourite, because the match screens are a
 * paginated work queue that can run to thousands of groups.
 */
export async function loadGroupFavourites(
  { supabase, userId }: OwnerContext,
  source: FavouriteSource,
  groups: readonly { match_group_key: string; parent_sku: string | null }[],
): Promise<FavouriteState> {
  const groupKeys = groups.map((group) => group.match_group_key);
  const parentSkus = [...new Set(
    groups.map((group) => group.parent_sku).filter((value): value is string => Boolean(value)),
  )];

  const [pending, wines] = await Promise.all([
    groupKeys.length === 0
      ? { data: [], error: null }
      : supabase.from("pending_favourites").select("source, match_group_key")
        .eq("user_id", userId).eq("source", source).in("match_group_key", groupKeys),
    parentSkus.length === 0
      ? { data: [], error: null }
      : supabase.from("wine_favourites").select("parent_sku")
        .eq("user_id", userId).in("parent_sku", parentSkus),
  ]);
  if (pending.error) throw new Error("Pending favourites could not be loaded.");
  if (wines.error) throw new Error("Wine favourites could not be loaded.");

  return buildFavouriteState(
    (wines.data ?? []).map((row) => row.parent_sku),
    pending.data ?? [],
  );
}

/**
 * Whether one target is favourited. Record pages show a single wine, so they
 * ask about that one rather than loading the whole favourite set the way the
 * table surfaces do.
 */
export async function isTargetFavourited(
  { supabase, userId }: OwnerContext,
  target: FavouriteTarget,
): Promise<boolean> {
  if (target.kind === "wine") {
    const { data, error } = await supabase
      .from("wine_favourites")
      .select("parent_sku")
      .eq("user_id", userId)
      .eq("parent_sku", target.parentSku)
      .maybeSingle();
    if (error) throw new Error("Wine favourites could not be loaded.");
    return Boolean(data);
  }

  const { data, error } = await supabase
    .from("pending_favourites")
    .select("match_group_key")
    .eq("user_id", userId)
    .eq("source", target.source)
    .eq("match_group_key", target.matchGroupKey)
    .maybeSingle();
  if (error) throw new Error("Pending favourites could not be loaded.");
  return Boolean(data);
}
