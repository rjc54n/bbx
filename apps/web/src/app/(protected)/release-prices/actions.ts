"use server";

import { revalidatePath } from "next/cache";
import { getOwnerContext } from "@/lib/auth/owner";

const RELEASE_PRICES_PATH = "/release-prices";

export async function setReleasePriceFavourite(parentSku: string, favourite: boolean): Promise<{ error?: string }> {
  if (!/^\d{5,30}$/.test(parentSku)) return { error: "The Parent SKU is invalid." };

  const context = await getOwnerContext();
  if (!context) return { error: "Your owner session has expired. Sign in again." };

  const query = favourite
    ? context.supabase.from("release_price_favourites").insert({ user_id: context.userId, parent_sku: parentSku })
    : context.supabase.from("release_price_favourites").delete()
      .eq("user_id", context.userId)
      .eq("parent_sku", parentSku);
  const { error } = await query;

  if (error && !(favourite && error.code === "23505")) {
    return { error: "The favourite could not be saved." };
  }
  revalidatePath(RELEASE_PRICES_PATH);
  return {};
}
