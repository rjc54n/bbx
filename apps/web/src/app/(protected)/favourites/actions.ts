"use server";

import { refresh } from "next/cache";
import { getOwnerContext } from "@/lib/auth/owner";
import { isValidFavouriteTarget, type FavouriteTarget } from "@/lib/favourites/target";

const UNIQUE_VIOLATION = "23505";

/**
 * The one entry point for every star in the app. It deliberately takes a
 * target rather than a Parent ID: a record with no link yet has no Parent ID to
 * give, and the database promotes the pending row when the link lands.
 *
 * refresh() rather than revalidatePath() because the star is clicked from many
 * routes -- the release-prices table, the CellarTracker table, both record
 * pages, the match-review screens, the catalogue browser -- and hard-coding one
 * path would leave every other caller stale.
 */
export async function setFavourite(
  target: FavouriteTarget,
  favourite: boolean,
): Promise<{ error?: string }> {
  if (!isValidFavouriteTarget(target)) return { error: "The favourite target is invalid." };

  const context = await getOwnerContext();
  if (!context) return { error: "Your owner session has expired. Sign in again." };

  const { error } = await (target.kind === "wine"
    ? favourite
      ? context.supabase
        .from("wine_favourites")
        .insert({ user_id: context.userId, parent_sku: target.parentSku })
      : context.supabase
        .from("wine_favourites")
        .delete()
        .eq("user_id", context.userId)
        .eq("parent_sku", target.parentSku)
    : favourite
      ? context.supabase
        .from("pending_favourites")
        .insert({
          user_id: context.userId,
          source: target.source,
          match_group_key: target.matchGroupKey,
        })
      : context.supabase
        .from("pending_favourites")
        .delete()
        .eq("user_id", context.userId)
        .eq("source", target.source)
        .eq("match_group_key", target.matchGroupKey));

  // Starring something already starred is the same end state, not a failure:
  // two rows for the same wine both carry a star, so a double click on the
  // second one races the first.
  if (error && !(favourite && error.code === UNIQUE_VIOLATION)) {
    return { error: "The favourite could not be saved." };
  }

  refresh();
  return {};
}
