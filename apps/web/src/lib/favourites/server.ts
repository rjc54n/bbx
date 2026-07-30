import "server-only";

import type { OwnerContext } from "@/lib/auth/owner";
import {
  buildFavouriteState,
  type FavouriteSource,
  type FavouriteState,
  type FavouriteTarget,
} from "./target";

type PendingRow = { source: string; match_group_key: string };

/**
 * Postgres says why -- a missing relation, a policy denial, a stale schema
 * cache -- and a bare "could not be loaded" throws that away. The cause is
 * worth more than the tidy sentence when a migration has not been pushed.
 */
function fail(what: string, error: { message: string; code?: string }): never {
  throw new Error(`${what} could not be loaded: ${error.message}${error.code ? ` (${error.code})` : ""}`);
}

/**
 * Every favourite the owner holds, for the table surfaces that resolve per row.
 * Pass a source to include its pending favourites; omit it for surfaces that
 * only ever show linked wines, like the catalogue browser and the BBR cellar.
 */
export async function loadFavourites(
  { supabase, userId }: OwnerContext,
  source?: FavouriteSource,
): Promise<{ parentSkus: string[]; pending: PendingRow[] }> {
  const [wines, pending] = await Promise.all([
    supabase.from("wine_favourites").select("parent_sku").eq("user_id", userId),
    source
      ? supabase.from("pending_favourites").select("source, match_group_key")
        .eq("user_id", userId).eq("source", source)
      : Promise.resolve({ data: [] as PendingRow[], error: null }),
  ]);
  if (wines.error) fail("Wine favourites", wines.error);
  if (pending.error) fail("Pending favourites", pending.error);

  return {
    parentSkus: (wines.data ?? []).map((row) => row.parent_sku),
    pending: pending.data ?? [],
  };
}

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
  if (pending.error) fail("Pending favourites", pending.error);
  if (wines.error) fail("Wine favourites", wines.error);

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
    if (error) fail("Wine favourites", error);
    return Boolean(data);
  }

  const { data, error } = await supabase
    .from("pending_favourites")
    .select("match_group_key")
    .eq("user_id", userId)
    .eq("source", target.source)
    .eq("match_group_key", target.matchGroupKey)
    .maybeSingle();
  if (error) fail("Pending favourites", error);
  return Boolean(data);
}
