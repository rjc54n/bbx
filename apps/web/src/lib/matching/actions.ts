"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnerContext } from "@/lib/auth/owner";
import { searchBbrCatalogue } from "@/lib/releaseOffers/algoliaServer";
import {
  MATCH_ADAPTERS,
  isMatchSource,
  matchGroupRpc,
  safeMatchReturnPath,
  type MatchSource,
} from "@/lib/matching/adapters";

const PARENT_SKU = /^\d{5,30}$/;

type SimpleGroupOp = "suppress" | "unlink" | "restore" | "exclude";
type GroupOp = "confirm" | "manual" | "edit" | SimpleGroupOp;

function groupArgs(op: GroupOp, matchGroupKey: string, parentSku?: string): Record<string, string> {
  const args: Record<string, string> = { p_match_group_key: matchGroupKey };
  if (op === "confirm" || op === "manual") {
    args.p_parent_sku = parentSku ?? "";
    args.p_method = op === "confirm" ? "algolia_confirmed" : "manual";
  }
  if (op === "edit") args.p_parent_sku = parentSku ?? "";
  return args;
}

/**
 * Run one group RPC for a source and revalidate its routes. Assumes `source`
 * is already allowlisted and any Parent ID already validated by the caller.
 */
async function callGroupRpc(
  context: NonNullable<Awaited<ReturnType<typeof getOwnerContext>>>,
  source: MatchSource,
  op: GroupOp,
  matchGroupKey: string,
  parentSku?: string,
): Promise<boolean> {
  const { error } = await context.supabase.rpc(
    matchGroupRpc(source, op),
    groupArgs(op, matchGroupKey, parentSku) as never,
  );
  const adapter = MATCH_ADAPTERS[source];
  revalidatePath(adapter.matchPath);
  revalidatePath(adapter.siblingPath);
  return !error;
}

// --- Optimistic list mutation (non-redirecting) ----------------------------
//
// The queue list removes a card the instant its action fires, then rebases on
// the background revalidation. This returns a result rather than redirect()ing
// so the client can surface a failure and let the card reappear.

export type MatchGroupMutation =
  | { source: string; op: "confirm" | "manual" | "edit"; matchGroupKey: string; parentSku: string }
  | { source: string; op: SimpleGroupOp; matchGroupKey: string };

export async function runMatchGroupMutation(
  mutation: MatchGroupMutation,
): Promise<{ ok: boolean; error?: string }> {
  if (!isMatchSource(mutation.source)) return { ok: false, error: "Unknown match source." };
  if (
    (mutation.op === "confirm" || mutation.op === "manual" || mutation.op === "edit")
    && !PARENT_SKU.test(mutation.parentSku)
  ) {
    return { ok: false, error: "Enter a valid Parent ID (5–30 digits)." };
  }

  const context = await getOwnerContext();
  if (!context) return { ok: false, error: "Your owner session has expired." };

  const parentSku = "parentSku" in mutation ? mutation.parentSku : undefined;
  const ok = await callGroupRpc(context, mutation.source, mutation.op, mutation.matchGroupKey, parentSku);
  return ok ? { ok: true } : { ok: false, error: "The match decision could not be saved." };
}

// --- Redirecting mutations (offer-record page, catalogue search, exclude) ---

async function redirectAfter(source: MatchSource, returnPath: string, ok: boolean): Promise<never> {
  const target = safeMatchReturnPath(source, returnPath);
  redirect(`${target}${target.includes("?") ? "&" : "?"}${ok ? "changed" : "action_error"}=1`);
}

export async function mutateMatchGroup(
  source: MatchSource,
  op: SimpleGroupOp,
  matchGroupKey: string,
  returnPath: string,
): Promise<never> {
  if (!isMatchSource(source)) redirect("/");
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  return redirectAfter(source, returnPath, await callGroupRpc(context, source, op, matchGroupKey));
}

export async function confirmMatchCandidate(
  source: MatchSource,
  matchGroupKey: string,
  parentSku: string,
  returnPath: string,
): Promise<never> {
  if (!isMatchSource(source)) redirect("/");
  if (!PARENT_SKU.test(parentSku)) redirect(`${safeMatchReturnPath(source, returnPath)}?action_error=1`);
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  return redirectAfter(source, returnPath, await callGroupRpc(context, source, "confirm", matchGroupKey, parentSku));
}

export async function linkMatchGroupManually(
  source: MatchSource,
  matchGroupKey: string,
  returnPath: string,
  formData: FormData,
): Promise<never> {
  if (!isMatchSource(source)) redirect("/");
  const parentSku = String(formData.get("parent_sku") ?? "").trim();
  if (!PARENT_SKU.test(parentSku)) redirect(`${safeMatchReturnPath(source, returnPath)}?action_error=1`);
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  return redirectAfter(source, returnPath, await callGroupRpc(context, source, "manual", matchGroupKey, parentSku));
}

export async function editMatchGroupParent(
  source: MatchSource,
  matchGroupKey: string,
  returnPath: string,
  formData: FormData,
): Promise<never> {
  if (!isMatchSource(source)) redirect("/");
  const parentSku = String(formData.get("parent_sku") ?? "").trim();
  if (!PARENT_SKU.test(parentSku)) redirect(`${safeMatchReturnPath(source, returnPath)}?action_error=1`);
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  return redirectAfter(source, returnPath, await callGroupRpc(context, source, "edit", matchGroupKey, parentSku));
}

// --- BBR catalogue search (source-agnostic) --------------------------------

export type MatchCatalogueSearchState = {
  results: Array<{
    parent_sku: string;
    name: string;
    vintage: number | null;
    producer: string | null;
    region: string | null;
    stock_origin: string | null;
    purchase_mode: string | null;
  }>;
  error?: string;
};

export async function searchMatchCatalogue(
  _previous: MatchCatalogueSearchState,
  formData: FormData,
): Promise<MatchCatalogueSearchState> {
  const context = await getOwnerContext();
  if (!context) return { results: [], error: "Your owner session has expired." };
  const query = String(formData.get("query") ?? "").trim();
  const vintageText = String(formData.get("vintage") ?? "").trim();
  const vintage = /^\d{4}$/.test(vintageText) ? Number(vintageText) : null;
  if (query.length < 3 || query.length > 300) return { results: [], error: "Enter at least three characters." };
  try {
    return { results: await searchBbrCatalogue(query, vintage) };
  } catch {
    return { results: [], error: "The BBR catalogue search could not be completed." };
  }
}
