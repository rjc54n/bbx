"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnerContext } from "@/lib/auth/owner";
import { cellarTrackerCatalogueQuery } from "@/lib/cellar/cellartrackerMatching";
import { searchBbrCatalogue, searchHistoricOfferGroups } from "@/lib/releaseOffers/algoliaServer";
import type { HistoricOfferMatchGroup } from "@/lib/releaseOffers/algoliaMatching";

const MATCH_PATH = "/cellartracker/matches";
const MATCH_BATCH_SIZE = 25;

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

function safeReturnPath(value: string) {
  return value === MATCH_PATH || value.startsWith(`${MATCH_PATH}?`) ? value : MATCH_PATH;
}

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
    .select("match_group_key,source_match_key,source_vintage,source_wine,source_producer")
    .eq("run_id", runId).eq("status", "pending")
    .order("match_group_key").limit(MATCH_BATCH_SIZE);
  if (error) throw new Error("The next CellarTracker match batch could not be loaded.");
  const groups = (data ?? []).map((row) => ({
    match_group_key: row.match_group_key,
    source_match_key: row.source_match_key,
    source_vintage: row.source_vintage,
    source_wine: row.source_wine,
    catalogue_query: cellarTrackerCatalogueQuery(row.source_wine, row.source_producer),
  })) satisfies HistoricOfferMatchGroup[];
  if (groups.length === 0) return loadProgress(context, runId);

  try {
    const results = await searchHistoricOfferGroups(groups);
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
      const { error: recordError } = await context.supabase.rpc("record_cellartracker_algolia_result", {
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

type GroupRpc =
  | "confirm_cellartracker_match_group"
  | "suppress_cellartracker_match_group"
  | "unlink_cellartracker_match_group"
  | "restore_cellartracker_match_group"
  | "edit_cellartracker_match_group"
  | "delete_cellartracker_match_group";

async function mutateGroup(rpc: GroupRpc, args: Record<string, string>, returnPath: string): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc(rpc, args as never);
  revalidatePath(MATCH_PATH);
  revalidatePath("/cellartracker");
  const target = safeReturnPath(returnPath);
  redirect(`${target}${target.includes("?") ? "&" : "?"}${error ? "action_error" : "changed"}=1`);
}

export async function confirmCellarTrackerCandidate(matchGroupKey: string, parentSku: string, returnPath: string): Promise<never> {
  return mutateGroup("confirm_cellartracker_match_group", {
    p_match_group_key: matchGroupKey,
    p_parent_sku: parentSku,
    p_method: "algolia_confirmed",
  }, returnPath);
}

export async function confirmManualCellarTrackerMatch(matchGroupKey: string, returnPath: string, formData: FormData): Promise<never> {
  const parentSku = String(formData.get("parent_sku") ?? "").trim();
  if (!/^\d{5,30}$/.test(parentSku)) redirect(`${safeReturnPath(returnPath)}?action_error=1`);
  return mutateGroup("confirm_cellartracker_match_group", {
    p_match_group_key: matchGroupKey,
    p_parent_sku: parentSku,
    p_method: "manual",
  }, returnPath);
}

export async function suppressCellarTrackerGroup(matchGroupKey: string, returnPath: string): Promise<never> {
  return mutateGroup("suppress_cellartracker_match_group", { p_match_group_key: matchGroupKey }, returnPath);
}

export async function unlinkCellarTrackerGroup(matchGroupKey: string, returnPath: string): Promise<never> {
  return mutateGroup("unlink_cellartracker_match_group", { p_match_group_key: matchGroupKey }, returnPath);
}

export async function restoreCellarTrackerGroup(matchGroupKey: string, returnPath: string): Promise<never> {
  return mutateGroup("restore_cellartracker_match_group", { p_match_group_key: matchGroupKey }, returnPath);
}

export async function deleteCellarTrackerGroup(matchGroupKey: string, returnPath: string): Promise<never> {
  return mutateGroup("delete_cellartracker_match_group", { p_match_group_key: matchGroupKey }, returnPath);
}

export async function editCellarTrackerGroup(matchGroupKey: string, returnPath: string, formData: FormData): Promise<never> {
  const parentSku = String(formData.get("parent_sku") ?? "").trim();
  if (!/^\d{5,30}$/.test(parentSku)) redirect(`${safeReturnPath(returnPath)}?action_error=1`);
  return mutateGroup("edit_cellartracker_match_group", {
    p_match_group_key: matchGroupKey,
    p_parent_sku: parentSku,
  }, returnPath);
}

export type CellarTrackerCatalogueSearchState = {
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

export async function searchCellarTrackerCatalogue(
  _previous: CellarTrackerCatalogueSearchState,
  formData: FormData,
): Promise<CellarTrackerCatalogueSearchState> {
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
