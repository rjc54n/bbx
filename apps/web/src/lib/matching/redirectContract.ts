// The old-route redirect contract (spec §3.7). `/release-prices/matches` and
// `/cellartracker/matches` are permanent (308) redirects to the unified
// `/matches`. Each old route SETS its own source; an inbound `?source=` on an
// old URL is ignored. State names are remapped, `q` and `page` are carried
// through after the same validation the new page applies, everything else is
// dropped.

import type { MatchSource } from "@/lib/matching/adapters";

type SearchParams = Record<string, string | string[] | undefined>;

// old `state` value -> new `state` value. Anything absent or unrecognised
// lands on `needs-review`, the new default.
const STATE_MAP: Record<string, string> = {
  unresolved: "needs-review",
  candidates: "with-suggestions",
  linked: "linked",
  suppressed: "no-suitable-match",
  all: "all",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Build the `/matches` URL an old matching route redirects to. Pure: the
 * redirect pages pass their `source` and the inbound search params, and the
 * acceptance test drives it on complete URLs.
 */
export function buildMatchesRedirect(source: MatchSource, params: SearchParams): string {
  const out = new URLSearchParams();
  // Order is fixed (source, state, q, page) so the redirect target is stable
  // and the acceptance test can assert on the whole string.
  out.set("source", source);

  const rawState = first(params.state);
  out.set("state", (rawState && STATE_MAP[rawState]) || "needs-review");

  // Same validation as the new page: trim, 200-char cap.
  const q = first(params.q)?.trim().slice(0, 200);
  if (q) out.set("q", q);

  // Carried through only when it is a positive integer; otherwise dropped.
  const page = first(params.page);
  if (page && /^[1-9]\d*$/.test(page)) out.set("page", page);

  return `/matches?${out.toString()}`;
}
