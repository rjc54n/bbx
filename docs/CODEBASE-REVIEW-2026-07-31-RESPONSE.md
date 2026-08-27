# Response to the 31 July 2026 codebase review

This checks every item in
[CODEBASE-REVIEW-2026-07-31.md](CODEBASE-REVIEW-2026-07-31.md) against the
code as it stands on 27 August 2026 — nearly a month, and a substantial
amount of unrelated feature work (owner release anchors, facet caches, the
catalogue materialised read model), later. The original review is left
unedited as a historical record; this is the status check it never got.

**Result: 2 of 14 recommendations were acted on. 12 are still open**,
including one (#4) that was carried forward, unfixed, into a migration
written this week.

## Fixed

- **#9 — PR checks for Python and web.** `.github/workflows/ci.yml` (added 20
  August 2026) runs both on every pull request and on push to `main`.
- **#14 — Google Fonts build dependency.** `apps/web/src/app/layout.tsx` now
  self-hosts fonts via the bundled `geist` package instead of
  `next/font/google`; the production build no longer depends on reaching
  Google's font CDN.

## Still open

**#1 — CellarTracker `9999` drink-window value.** Still stored and displayed
as a literal year. `apps/web/src/app/(protected)/wine/parent/[parentSku]/page.tsx:383`
renders `drink ${begin_consume}–${end_consume}` with no guard, so a record
with `BeginConsume=9999`/`EndConsume=9999` — the common case, per the
original review's source sample — shows `drink 9999–9999`. The favourite
wine card no longer carries a drink window at all, so the original finding's
specific surface has moved, but the underlying defect is the same and now
visible on the wine detail page instead.

**#2 — Orphaned CellarTracker storage objects.** Still open.
`processCellarTrackerUpload` in
`apps/web/src/app/(protected)/cellar/imports/cellartracker/actions.ts` only
removes the uploaded object from the `cellar-imports` bucket on the
duplicate-import path. If the staging RPC fails for any other reason, the
already-uploaded object is left behind with no import record pointing to it.

**#3 — Upload form exception handling.** Partially open, and now
consolidated in one place instead of three: `ImportUploadForm.tsx` is now
shared across BBR, release-offer and CellarTracker imports (addressing the
duplication complaint), but `createTarget(...)` and `processUpload(...)` are
still called with no `try`/`catch` around them, unlike the upload step just
above them which is wrapped. An unexpected throw from either — not the
`{error}` return path, an actual exception — leaves `phase` stuck at
`"uploading"` or `"processing"`, and in the `processUpload` case leaves the
polling `setInterval` running with nothing to ever clear it. This is now a
single fix instead of three, at least.

**#4 — `favourite_wine_view` release-offer count excludes nothing.** Still
open, and now inside a migration written this week
(`supabase/migrations/20260827120000_catalogue_materialised_read_model.sql`).
The view's `offers` `LEFT JOIN LATERAL` counts every `release_offer_product_resolutions`
row with `status = 'linked'` for the favourite's `parent_sku`, with no check
against `public.release_offer_record_exclusions`. `release_offer_review_view`
and `release_offer_evidence_view` both exclude on `content_fingerprint`; this
count doesn't. A favourite can still show a `Release` provenance chip backed
entirely by an excluded record. This week's rewrite touched this view for
performance and preserved its exact existing behaviour by design — which
means it faithfully carried the bug forward rather than introducing it. This
is the cheapest item on this list to fix: the same exclusion subquery already
exists twice elsewhere in the same migration file.

**#5 — No integer bounds on CellarTracker numeric fields.** Still open.
`cellartrackerParser.ts`'s `int()` helper validates `^\d+$` and calls
`Number(v)` with no upper-bound check — an oversized numeric string in the
source CSV would still pass parsing and hit whatever the database column's
own limit is, aborting the whole import RPC rather than marking one row
invalid.

**#6 — Inconsistent `source_row_number` convention.** Still open and
unchanged. `cellartrackerParser.ts` computes `index + 1` (first data row =
1); `bbrParser.ts` (`index + 2`) and `releaseOffers/parser.ts` both use the
CSV-line convention (first data row = 2, accounting for the header). These
are persistent record identifiers, per the original finding, so the
divergence is still live in stored data, not just naming.

**#7 — Missing parser tests.** Still open for the parser itself.
`cellartrackerMatching.test.ts` exists and covers matching, but no test
exercises `parseCellarTrackerCsv` directly, and none was found for the
upload action's failure-cleanup paths (consistent with #2 still being open).

**#8 — Read-layer security test doesn't enumerate all views.**
Still open. `read_layer_security.test.sql`'s `results_eq` check still names
exactly the same nine original scanner views (`scan_health_view`,
`product_detail_view`, `price_history_view`, `candidate_view`,
`catalogue_view`, `facet_ranges_view`, `recent_price_change_view`,
`facet_values_view`, `format_options_view`). CellarTracker, release-offer and
favourites views have their own grants checked individually in their own
feature test files (e.g. `bbr_cellar_import.test.sql`), which is real
coverage but not what was asked for: a completeness guarantee that a
newly-added view can't silently ship without any security check at all,
because nothing enumerates the full set.

**#10 — Duplicated matching orchestration.** Still open, and diverged
further rather than converging: `cellartrackerMatching.ts` and
`releaseOffers/algoliaMatching.ts` remain two independent implementations of
the same progress/candidate-search/batching shape, not a shared core with
source-specific adapters.

**#11 — Two Supabase browser client files.** Still open.
`apps/web/src/lib/supabase.ts` and `apps/web/src/lib/supabase/client.ts` both
still exist as separate browser client singletons.

**#12 — Compressed single-line files.** Still open, confirmed directly —
e.g. `processCellarTrackerUpload` in the CellarTracker actions file is one
line covering the entire download/parse/checksum/stage/redirect flow. The
original review recommended reformatting opportunistically rather than as a
dedicated sweep (to avoid burying behavioural diffs in blame history), which
is presumably why this hasn't moved — noting it as still true, not as a
lapse.

**#13 — Unpinned Python dependencies.** Still open. `requirements.txt` pins
`pandas`, `requests` and `streamlit` exactly, but `psycopg2-binary` (`>=2.9,<3`)
and `boto3` (`>=1.35,<2`) stay range-pinned, and `requirements-dev.txt`'s
`pytest>=8` has no upper bound at all.

## Recommendation

Of the twelve open items, **#4 is worth fixing now, on its own** — it's a
correctness bug in a view this repository just spent a full session getting
right for performance, the fix is a known pattern already used twice in the
same file, and it directly affects what a favourite's release-price evidence
chip claims. The rest are unchanged in risk or effort from the original
review's own ordering and can stay queued as before.
