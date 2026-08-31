"use server";

import { revalidatePath } from "next/cache";
import { getOwnerContext } from "@/lib/auth/owner";
import { rankCellarTrackerCandidates, type CellarTrackerMatchGroup } from "@/lib/cellar/cellartrackerMatching";
import { searchCellarTrackerGroups } from "@/lib/releaseOffers/algoliaServer";

// Group mutations and the catalogue search now live in the source-parameterised
// @/lib/matching/actions. What stays here is the CellarTracker match-run
// pipeline: its Algolia ranking and result RPC differ from release offers'.

// The matching queue now lives at the unified /matches route (Slice 3); the old
// path is a 308 redirect, so revalidating it would do nothing.
const MATCH_PATH = "/matches";
const MATCH_BATCH_SIZE = 20;

export type CellarTrackerMatchProgress = {
  runId: string;
  status: string;
  total: number;
  processed: number;
  remaining: number;
  errors: number;
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
  local_exact_link_count: number;
  algolia_exact_link_count: number;
};

async function loadProgress(
  context: NonNullable<Awaited<ReturnType<typeof getOwnerContext>>>,
  runId: string,
): Promise<CellarTrackerMatchProgress> {
  const { data, error } = await context.supabase.from("cellartracker_match_runs")
    .select("id,status,total_group_count,processed_group_count,remaining_group_count,error_group_count,local_exact_link_count,algolia_exact_link_count")
    .eq("id", runId).single();
  if (error || !data) throw new Error("The CellarTracker match run could not be loaded.");
  const row = data as MatchRunRow;
  return {
    runId: row.id,
    status: row.status,
    total: row.total_group_count,
    processed: row.processed_group_count,
    remaining: row.remaining_group_count,
    errors: row.error_group_count,
    localExactLinks: row.local_exact_link_count,
    algoliaExactLinks: row.algolia_exact_link_count,
  };
}

export async function beginCellarTrackerMatchRun(): Promise<CellarTrackerMatchProgress> {
  const context = await getOwnerContext();
  if (!context) throw new Error("Your owner session has expired.");
  const { data, error } = await context.supabase.rpc("begin_cellartracker_match_run");
  if (error) throw new Error("The CellarTracker match run could not be started.");
  const result = data as { run_id?: string } | null;
  if (!result?.run_id) throw new Error("The match backend returned an incomplete result.");
  revalidatePath(MATCH_PATH);
  return loadProgress(context, result.run_id);
}

export async function processCellarTrackerMatchBatch(runId: string): Promise<CellarTrackerMatchProgress> {
  const context = await getOwnerContext();
  if (!context) throw new Error("Your owner session has expired.");
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("The match run reference is invalid.");

  const { data, error } = await context.supabase.from("cellartracker_match_run_groups")
    .select("match_group_key,source_wine,source_producer,source_vintage")
    .eq("run_id", runId).eq("status", "pending")
    .order("match_group_key").limit(MATCH_BATCH_SIZE);
  if (error) throw new Error("The next CellarTracker match batch could not be loaded.");
  const groups = (data ?? []).map((row) => ({
    match_group_key: row.match_group_key,
    source_wine: row.source_wine,
    source_producer: row.source_producer,
    source_vintage: row.source_vintage,
  })) satisfies CellarTrackerMatchGroup[];
  if (groups.length === 0) return loadProgress(context, runId);

  try {
    const results = await searchCellarTrackerGroups(groups);
    await Promise.all(results.map(async (result) => {
      if (result.error) {
        const { error: recordError } = await context.supabase.rpc("record_cellartracker_algolia_error", {
          p_run_id: runId,
          p_match_group_key: result.group.match_group_key,
          p_error_message: result.error,
        });
        if (recordError) throw recordError;
        return;
      }
      const ranking = rankCellarTrackerCandidates(result.group, result.hits);
      const { error: recordError } = await context.supabase.rpc("record_cellartracker_algolia_result", {
        p_run_id: runId,
        p_match_group_key: result.group.match_group_key,
        p_candidates: ranking.candidates,
        // The type generator models every function argument as non-null, but
        // this one takes NULL to mean "no candidate was good enough to link".
        p_auto_link_parent_sku: ranking.autoLinkParentSku as string,
        p_observed_at: result.observedAt,
      });
      if (recordError) throw recordError;
    }));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Algolia matching failed.";
    await Promise.all(groups.map((group) => context.supabase.rpc("record_cellartracker_algolia_error", {
      p_run_id: runId,
      p_match_group_key: group.match_group_key,
      p_error_message: message,
    })));
    revalidatePath(MATCH_PATH);
    return { ...await loadProgress(context, runId), message };
  }

  revalidatePath(MATCH_PATH);
  revalidatePath("/cellartracker");
  return loadProgress(context, runId);
}
