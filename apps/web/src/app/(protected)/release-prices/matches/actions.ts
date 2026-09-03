"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnerContext } from "@/lib/auth/owner";
import { searchHistoricOfferGroups } from "@/lib/releaseOffers/algoliaServer";
import type { HistoricOfferMatchGroup } from "@/lib/releaseOffers/algoliaMatching";

// Group mutations, the catalogue search and the optimistic list action now live
// in the source-parameterised @/lib/matching/actions. What stays here is
// release-offer-only: the match-run pipeline (its Algolia search and result
// RPCs differ from CellarTracker's) and the per-record exclude/restore the
// offer-record and excluded-records pages use.

// The matching queue now lives at the unified /matches route (Slice 3); the old
// path is a 308 redirect, so revalidating it would do nothing.
const MATCH_PATH = "/matches";
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
  /**
   * Groups this batch processed without an exact-validation pass, because
   * Algolia failed to answer their validation pages. Their suggestions were
   * saved; only the auto-link evidence is missing. A soft count, not an error:
   * the run keeps going.
   */
  validationSkipped?: number;
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

  let validationSkipped = 0;
  try {
    // Only a first-pass failure loses this batch: searchHistoricOfferGroups
    // degrades a failed validation pass to provisional suggestions rather than
    // throwing, so the candidates it did find are still worth recording.
    const results = await searchHistoricOfferGroups(groups);
    validationSkipped = results.filter((result) => result.validationError).length;
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
  return { ...await loadProgress(context, runId), validationSkipped };
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
