import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type OwnerContext = {
  userId: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
};

/**
 * The authoritative owner check, and the only one that runs against the
 * database. Wrapped in React `cache` so the protected layout and the page it
 * renders share a single `app_owners` read instead of issuing one each -- the
 * cache is per-request, so this is deduplication, not a security cache.
 *
 * The request proxy deliberately does not repeat this lookup (see proxy.ts): it
 * makes an optimistic claims-only routing decision, and this check plus RLS
 * remain the decision that actually gates data.
 */
export const getOwnerContext = cache(async (): Promise<OwnerContext | null> => {
  const supabase = await createServerSupabaseClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== "string") return null;

  const { data: owner, error: ownerError } = await supabase
    .from("app_owners")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (ownerError) {
    throw new Error("The owner allowlist could not be checked.");
  }
  if (!owner) return null;

  return { userId, supabase };
});

export async function requireOwner(): Promise<OwnerContext> {
  const context = await getOwnerContext();
  // `denied=1` also tells the proxy not to bounce this request straight back to
  // the app. Without it, a signed-in non-owner would loop: the proxy sees valid
  // claims at /login and redirects to /, which redirects back here.
  if (!context) redirect("/login?denied=1");
  return context;
}
