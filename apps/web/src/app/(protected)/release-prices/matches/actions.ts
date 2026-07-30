"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnerContext } from "@/lib/auth/owner";
import { searchBbrCatalogue, searchHistoricOfferGroups } from "@/lib/releaseOffers/algoliaServer";
import type { HistoricOfferMatchGroup } from "@/lib/releaseOffers/algoliaMatching";

const MATCH_PATH = "/release-prices/matches";
const MATCH_BATCH_SIZE = 25;

export type MatchRunProgress = {
  runId: string;
  status: string;
  total: number;
  processed: number;
  remaining: number;
  errors: number;
  suppliedLinks: number;
  localExactLinks: number;
  algoliaExactLinks: number;
  message?: string;
};

type MatchRunRow = {
  id: string;
  status: string;
  total_group_count: number;
  processed_group_count: number;
  remaining_group_count: number;
  error_group_count: number;
  supplied_id_link_count: number;
  local_exact_link_count: number;
  algolia_exact_link_count: number;
};

function safeReturnPath(value: string) {
  if (value === MATCH_PATH || value.startsWith(`${MATCH_PATH}?`)) return value;
  if (/^\/release-prices\/offers\/[0-9a-f-]{36}\/\d+(?:\?.*)?$/i.test(value)) return value;
  return MATCH_PATH;
}

async function loadProgress(
  context: NonNullable<Awaited<ReturnType<typeof getOwnerContext>>>,
  runId: string,
): Promise<MatchRunProgress> {
  const { data, error } = await context.supabase.from("release_offer_match_runs")
    .select("id, status, total_group_count, processed_group_count, remaining_group_count, error_group_count, supplied_id_link_count, local_exact_link_count, algolia_exact_link_count")
    .eq("id", runId).single();
  if (error || !data) throw new Error("The match run could not be loaded.");
  const row = data as MatchRunRow;
  return {
    runId: row.id,
    status: row.status,
    total: row.total_group_count,
    processed: row.processed_group_count,
    remaining: row.remaining_group_count,
    errors: row.error_group_count,
    suppliedLinks: row.supplied_id_link_count,
    localExactLinks: row.local_exact_link_count,
    algoliaExactLinks: row.algolia_exact_link_count,
  };
}

export async function beginHistoricOfferMatchRun(): Promise<MatchRunProgress> {
  const context = await getOwnerContext();
  if (!context) throw new Error("Your owner session has expired.");
  const { data, error } = await context.supabase.rpc("begin_release_offer_match_run");
  if (error) throw new Error("The historic-offer match run could not be started.");
  const result = data as { run_id?: string } | null;
  if (!result?.run_id) throw new Error("The match backend returned an incomplete result.");
  revalidatePath(MATCH_PATH);
  return loadProgress(context, result.run_id);
}

export async function processHistoricOfferMatchBatch(runId: string): Promise<MatchRunProgress> {
  const context = await getOwnerContext();
  if (!context) throw new Error("Your owner session has expired.");
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("The match run reference is invalid.");

  const { data, error } = await context.supabase.from("release_offer_match_run_groups")
    .select("match_group_key, source_match_key, source_vintage, source_wine")
    .eq("run_id", runId).eq("status", "pending")
    .order("match_group_key").limit(MATCH_BATCH_SIZE);
  if (error) throw new Error("The next match batch could not be loaded.");
  const groups = (data ?? []) as HistoricOfferMatchGroup[];
  if (groups.length === 0) return loadProgress(context, runId);

  try {
    const results = await searchHistoricOfferGroups(groups);
    await Promise.all(results.map(async (result) => {
      if (result.error) {
        const { error: recordError } = await context.supabase.rpc("record_release_offer_algolia_error", {
          p_run_id: runId,
          p_match_group_key: result.group.match_group_key,
          p_error_message: result.error,
        });
        if (recordError) throw recordError;
        return;
      }
      const { error: recordError } = await context.supabase.rpc("record_release_offer_algolia_result", {
        p_run_id: runId,
        p_match_group_key: result.group.match_group_key,
        p_candidates: result.candidates,
        p_exact_parent_skus: result.exactParentSkus,
        p_exhaustive: result.exhaustive,
        p_observed_at: result.observedAt,
      });
      if (recordError) throw recordError;
    }));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Algolia matching failed.";
    await Promise.all(groups.map((group) => context.supabase.rpc("record_release_offer_algolia_error", {
      p_run_id: runId,
      p_match_group_key: group.match_group_key,
      p_error_message: message,
    })));
    revalidatePath(MATCH_PATH);
    return { ...await loadProgress(context, runId), message };
  }

  revalidatePath(MATCH_PATH);
  return loadProgress(context, runId);
}

async function mutateGroup(
  rpc: "confirm_release_offer_match_group" | "suppress_release_offer_match_group" | "unlink_release_offer_match_group" | "restore_release_offer_match_group" | "edit_release_offer_match_group" | "exclude_release_offer_match_group",
  args: Record<string, string>,
  returnPath: string,
): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc(rpc, args as never);
  revalidatePath(MATCH_PATH);
  revalidatePath("/release-prices");
  redirect(`${safeReturnPath(returnPath)}${returnPath.includes("?") ? "&" : "?"}${error ? "action_error" : "changed"}=1`);
}

export async function confirmHistoricOfferCandidate(
  matchGroupKey: string,
  parentSku: string,
  returnPath: string,
): Promise<never> {
  return mutateGroup("confirm_release_offer_match_group", {
    p_match_group_key: matchGroupKey,
    p_parent_sku: parentSku,
    p_method: "algolia_confirmed",
  }, returnPath);
}

export async function confirmManualHistoricOfferMatch(
  matchGroupKey: string,
  returnPath: string,
  formData: FormData,
): Promise<never> {
  const parentSku = String(formData.get("parent_sku") ?? "").trim();
  if (!/^\d{5,30}$/.test(parentSku)) redirect(`${safeReturnPath(returnPath)}?action_error=1`);
  return mutateGroup("confirm_release_offer_match_group", {
    p_match_group_key: matchGroupKey,
    p_parent_sku: parentSku,
    p_method: "manual",
  }, returnPath);
}

export async function suppressHistoricOfferGroup(matchGroupKey: string, returnPath: string): Promise<never> {
  return mutateGroup("suppress_release_offer_match_group", { p_match_group_key: matchGroupKey }, returnPath);
}

export async function unlinkHistoricOfferGroup(matchGroupKey: string, returnPath: string): Promise<never> {
  return mutateGroup("unlink_release_offer_match_group", { p_match_group_key: matchGroupKey }, returnPath);
}

export async function restoreHistoricOfferGroup(matchGroupKey: string, returnPath: string): Promise<never> {
  return mutateGroup("restore_release_offer_match_group", { p_match_group_key: matchGroupKey }, returnPath);
}

export async function excludeHistoricOfferGroup(matchGroupKey: string, returnPath: string): Promise<never> {
  return mutateGroup("exclude_release_offer_match_group", { p_match_group_key: matchGroupKey }, returnPath);
}

export async function excludeHistoricOfferRecord(importId: string, sourceRowNumber: number): Promise<never> {
  if (!/^[0-9a-f-]{36}$/i.test(importId) || !Number.isSafeInteger(sourceRowNumber) || sourceRowNumber <= 0) {
    redirect("/release-prices");
  }
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("exclude_release_offer_record", {
    p_import_id: importId,
    p_source_row_number: sourceRowNumber,
  });
  revalidatePath(MATCH_PATH);
  revalidatePath("/release-prices");
  revalidatePath("/release-prices/excluded");
  redirect(error ? `/release-prices/offers/${importId}/${sourceRowNumber}?exclude_error=1` : "/release-prices?excluded=1");
}

export async function restoreHistoricOfferRecord(contentFingerprint: string): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("restore_release_offer_record", {
    p_content_fingerprint: contentFingerprint,
  });
  revalidatePath(MATCH_PATH);
  revalidatePath("/release-prices");
  revalidatePath("/release-prices/excluded");
  redirect(`/release-prices/excluded?${error ? "restore_error" : "restored"}=1`);
}

export async function editHistoricOfferGroup(
  matchGroupKey: string,
  returnPath: string,
  formData: FormData,
): Promise<never> {
  const parentSku = String(formData.get("parent_sku") ?? "").trim();
  if (!/^\d{5,30}$/.test(parentSku)) redirect(`${safeReturnPath(returnPath)}?action_error=1`);
  return mutateGroup("edit_release_offer_match_group", {
    p_match_group_key: matchGroupKey,
    p_parent_sku: parentSku,
  }, returnPath);
}

export type CatalogueSearchState = {
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

export async function searchHistoricOfferCatalogue(
  _previous: CatalogueSearchState,
  formData: FormData,
): Promise<CatalogueSearchState> {
  const context = await getOwnerContext();
  if (!context) return { results: [], error: "Your owner session has expired." };
  const query = String(formData.get("query") ?? "").trim();
  const vintageText = String(formData.get("vintage") ?? "").trim();
  const vintage = /^\d{4}$/.test(vintageText) ? Number(vintageText) : null;
  if (query.length < 3 || query.length > 300) {
    return { results: [], error: "Enter at least three characters." };
  }
  try {
    return { results: await searchBbrCatalogue(query, vintage) };
  } catch {
    return { results: [], error: "The BBR catalogue search could not be completed." };
  }
}
