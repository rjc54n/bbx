// The source adapter for the shared matching surface (Part A, Slice 2).
//
// The release-offer and CellarTracker matching queues share a grouping grain,
// a state model and the same six group operations, but each calls its own set
// of RPCs and revalidates its own routes. This module is the one place that
// difference is written down: a closed `source` allowlist mapped to a typed
// record of literal RPC names and paths. Nothing here interpolates a source
// string into an RPC name.

import type { Database } from "@/lib/database.types";

type RpcName = keyof Database["public"]["Functions"];

export const MATCH_SOURCES = ["release_offer", "cellartracker"] as const;
export type MatchSource = (typeof MATCH_SOURCES)[number];

export function isMatchSource(value: string): value is MatchSource {
  return (MATCH_SOURCES as readonly string[]).includes(value);
}

// `manual` links through the same RPC as `confirm` (with p_method = 'manual'),
// so it is not a key in the RPC map.
export type MatchGroupOp = "confirm" | "manual" | "edit" | "suppress" | "unlink" | "restore" | "exclude";
type MatchGroupRpcKey = Exclude<MatchGroupOp, "manual">;

export type MatchAdapter = {
  /** Section label used in headers and the queue-summary chips. */
  label: string;
  /**
   * The unified matching route (also the primary revalidation path). Shared by
   * both sources since Slice 3; the per-source view is a `?source=` filter on it.
   */
  matchPath: string;
  /** The unified route pre-filtered to this source, for header / favourites links. */
  sourceMatchHref: string;
  /** The source's non-matching route, revalidated alongside every mutation. */
  siblingPath: string;
  /**
   * A per-record detail route this source's return-path is allowed to point
   * back to, beyond its own matchPath. Release offers have one; CellarTracker
   * does not.
   */
  detailPathPattern: RegExp | null;
  /** Literal RPC names, never built from the source string. */
  groupRpc: Record<MatchGroupRpcKey, RpcName>;
  /** The confirm-dialog copy for excluding a whole group's records. */
  excludePrompt: (recordCount: number) => string;
};

export const MATCH_ADAPTERS: Record<MatchSource, MatchAdapter> = {
  release_offer: {
    label: "Release offers",
    matchPath: "/matches",
    sourceMatchHref: "/matches?source=release_offer",
    siblingPath: "/release-prices",
    detailPathPattern: /^\/release-prices\/offers\/[0-9a-f-]{36}\/\d+(?:\?.*)?$/i,
    groupRpc: {
      confirm: "confirm_release_offer_match_group",
      edit: "edit_release_offer_match_group",
      suppress: "suppress_release_offer_match_group",
      unlink: "unlink_release_offer_match_group",
      restore: "restore_release_offer_match_group",
      exclude: "exclude_release_offer_match_group",
    },
    excludePrompt: (recordCount) =>
      `Exclude ${recordCount} historic offer record${recordCount === 1 ? "" : "s"}? They stop supplying release prices, and a later file repeating them is filtered out, until you restore them.`,
  },
  cellartracker: {
    label: "CellarTracker",
    matchPath: "/matches",
    sourceMatchHref: "/matches?source=cellartracker",
    siblingPath: "/cellartracker",
    detailPathPattern: null,
    groupRpc: {
      confirm: "confirm_cellartracker_match_group",
      edit: "edit_cellartracker_match_group",
      suppress: "suppress_cellartracker_match_group",
      unlink: "unlink_cellartracker_match_group",
      restore: "restore_cellartracker_match_group",
      exclude: "exclude_cellartracker_match_group",
    },
    excludePrompt: (recordCount) =>
      `Exclude ${recordCount} CellarTracker record${recordCount === 1 ? "" : "s"}? They are hidden everywhere and left out of future snapshots until you restore them.`,
  },
};

/**
 * Resolve an adapter from an untrusted source string. Throws on anything not
 * in the allowlist — the server actions catch this and refuse the mutation.
 */
export function resolveMatchAdapter(source: string): MatchAdapter {
  if (!isMatchSource(source)) throw new Error(`Unknown match source: ${source}`);
  return MATCH_ADAPTERS[source];
}

export function matchGroupRpc(source: MatchSource, op: MatchGroupOp): RpcName {
  return MATCH_ADAPTERS[source].groupRpc[op === "manual" ? "confirm" : op];
}

/**
 * Keep a return path pointing somewhere this source owns: its own matching
 * route (with any query string) or, for release offers, an offer-record page.
 * Anything else falls back to the matching route.
 */
export function safeMatchReturnPath(source: MatchSource, value: string): string {
  const adapter = MATCH_ADAPTERS[source];
  if (value === adapter.matchPath || value.startsWith(`${adapter.matchPath}?`)) return value;
  if (adapter.detailPathPattern?.test(value)) return value;
  return adapter.matchPath;
}
