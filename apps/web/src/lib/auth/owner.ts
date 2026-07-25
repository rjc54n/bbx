import "server-only";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type OwnerContext = {
  userId: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
};

export async function getOwnerContext(): Promise<OwnerContext | null> {
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
}

export async function requireOwner(): Promise<OwnerContext> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  return context;
}
