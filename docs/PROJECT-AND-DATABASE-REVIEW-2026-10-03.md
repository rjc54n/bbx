# BBX project and database review

Status: completed 3 October 2026. Review of `main` at `9a281187c83533a9c1b6bde4c4ad702373c85819`, with read-only production observations between 17:36 and 19:18 UTC. Recommendations only. No application code, schema, stored data, schedules or infrastructure settings changed.

## Assessment

The application has a useful shape for its owner's purpose: discover wines, compare format-specific market prices, add private cellar and historic-offer evidence, save research queries, and continue to BBX to act. The core data distinctions are mostly sound. The current problem is the cost and reliability of keeping that research data current.

The database occupied **359.08 MB**, about **72% of the documented 500 MB Free-plan database allowance**, during this review. It is below the quota, but that does not establish that the free compute can sustain its refresh workload. Three main materialised views consume **144.95 MB** including indexes. There is also substantial estimated residual bloat in the older source tables and caches.

The recent fixes address real causes of unnecessary writes: conditional upserts, 30-day event retention, removal of unused indexes and separation of REST-check timestamps. All their migrations are live. However, **no production sweep has completed after the 2 October write-reduction and timestamp changes**. The last source publication is from 1 October. The latest actual attempt, on 2 October, failed. Recent green scheduled jobs exited outside the permitted window.

Keep the existing architecture and full biddable catalogue. Verify the recent changes under one normal sweep before adding another major redesign. Prioritise publication monitoring, the price-change query, bounded retention and measured reclamation of residual bloat. Remove the confirmed duplicate index, but do not treat every zero-use index as waste.

The operational target should be bounded growth and predictable I/O with spare capacity. Requiring literally zero unused space would encourage repeated table rewrites and remove the reusable space that normal updates need.

---

## Scope and evidence limits

The review covered the Python discovery, pricing, sweep and persistence paths; the Next.js catalogue, scenarios, wine cards, cellar and matching readers; authentication and database permissions; current SQL definitions; storage and index inventories; migration deployment; tests and GitHub workflows.

The repository contains 413 tracked files, including 35 Python files, 193 TypeScript/TSX files, 78 Supabase migrations and 20 database test files. Review depth was concentrated on the paths that consume database resources and affect trading decisions. This is not a line-by-line certification of every file or a penetration test.

Evidence is labelled as follows:

- **Live:** production catalogue metadata, bounded aggregates, definitions, existing query statistics, logs and GitHub run records read during this review.
- **Code:** behaviour traced in the reviewed commit. A reproducible mechanism is not necessarily a production incident.
- **Historical:** previous measurements recorded in repository documents or earlier GitHub logs, with their dates retained.
- **Proposal:** an optimisation requiring local validation. Savings and latency improvements are not claimed until measured.

`supabase branches list` returned no branches. Production checks therefore used bounded read-only SQL, normally with 5-8 second statement limits, plus metadata inspection. No refresh, write benchmark, `EXPLAIN ANALYZE`, dump, vacuum, reindex or row-equivalence test ran against production. One planner-only `EXPLAIN` inspected the price-change query without executing it. The CLI bloat check is a statistical estimate, not a physical page inspection.

The review did not obtain current dashboard CPU, memory, disk-budget or total disk-usage graphs. Database size excludes WAL and some other disk consumption. No authenticated browser journey was repeated here. Existing deployment records and CI results are separate evidence, not substitutes for those missing checks.

---

## Product fit and architecture

| Capability | Current implementation | Assessment |
|---|---|---|
| Discover listed and unlisted biddable wines | `prod_biddable` discovery, persistent products/SKUs, catalogue filters and search | Supports bids for wines without an ask. Keep the full universe, as already agreed with the owner. |
| Compare actionable prices | Per-format ask, highest bid, guide, last transaction and estimated next offer | Preserve `(parent_sku, format_code)` throughout. A case and a magnum are different trading opportunities. |
| Use personal evidence | BBR snapshots, CellarTracker records, accepted offers and owner reference decisions | This is the app's main advantage over a generic market browser. Protect the source records and corrections. |
| Repeat research | Saved scenarios, favourites and explicit filters | Useful. Scenario pagination already avoids exact result counts. |
| Act on BBX | Validated product links, with search fallback | The app supports decisions and hands off to BBX. It does not place orders or record executed trades. That is consistent with a manual owner workflow. |
| Monitor new opportunities | Separate hourly arbitrage scanner with Slack/S3 deduplication | It does not update the Supabase catalogue. Its success must not be reported as catalogue freshness. |

The main dependencies are:

```text
Algolia discovery + BBX REST pricing
  -> private.products / skus / offers
  -> catalogue_mv
      -> catalogue_view + product_rest_checks.published_at
      -> wine_market_summary_mv
      -> wine_scenario_mv
  -> facet materialised views

BBR / CellarTracker / promotional imports
  -> source evidence + owner matching decisions
  -> historic_reference_candidate_view
  -> resolved_reference_price_view
  -> catalogue enrichment / wine cards / favourites / scenarios

Separate hourly scanner
  -> Algolia + REST + GraphQL -> Slack, with S3 notification state
```

The source/cache/private-evidence separation is sensible. Ordinary views do not store another copy of their result. Their cost is query execution. Materialised views do store a copy and have a separate refresh cost.

Preserve these domain rules while optimising:

- The BBX guide is the volume-scaled Liv-ex signal. It is not independent corroboration of Liv-ex.
- Format-adjusted guide prices are modelled estimates. Keep their labels and shared Python/SQL checks.
- Candidates are for human review. Do not turn pragmatic comparisons into claims of executable arbitrage.
- Historic reference prices are distinct from current asks and bids. The new 75 cl reference restrictions avoid applying a standard-bottle benchmark indiscriminately to other formats.
- BBR current holdings, historical observations and CellarTracker records have different authority and date meanings. Do not collapse them to save a small amount of space.

Sources: [project README](../README.md), [pricing pipeline](../core/pipeline.py), [listing links](../apps/web/src/lib/listingLinks.ts), [historic reference migration](../supabase/migrations/20261003070650_historic_reference_price.sql), [scenario evaluator](../apps/web/src/lib/scenarios/evaluate.ts).

---

## Live database baseline

Project: `ytgzgybgwsucsqeyetmk`, BBX Bargains, `eu-west-1`, PostgreSQL 17.6. The project endpoint reported `ACTIVE_HEALTHY`. The database started at 08:54 UTC on 2 October. The initial check found no other active query and `default_transaction_read_only = off`.

| Measure | Observed value | Interpretation |
|---|---:|---|
| Database size | 359,083,155 bytes, 359.08 MB | Unchanged between the initial and later size readings. |
| Nominal space below 500 MB | 140.92 MB | Not all safely available for permanent data: refreshes and maintenance need room. |
| Application tables and materialised views, including indexes | 342.27 MB | `public` and `private`; excludes system schemas. |
| Indexes on those relations | 110.35 MB | Included in the preceding total, not additional. |
| All six materialised views | 145.19 MB | About 40.4% of the database. |
| All public ordinary tables | 40.68 MB | Includes owner records and matching machinery. |
| Main catalogue text-search indexes | 37.60 MB | Both have observed use. |
| Ordinary tables / ordinary views / materialised views | 35 / 38 / 6 | Across `public` and `private`; 92 indexes. |
| Storage objects | 14 objects, 17.28 MB from object metadata | Private `cellar-imports` bucket. Object payloads are separate from database size. |
| Shared buffers | 234.88 MB, 224 MiB | Does not prove the whole instance's memory use or working set. |
| `work_mem` | 2,184 KiB | Per operation, not a single allocation for the whole server. |
| Configured maximum connections | 60 | Initial database statistics showed 13 backends. Do not increase this to address I/O. |

The following sizes are measured bytes converted to decimal MB. Row counts are planner estimates unless explicitly marked exact.

| Largest relation | Estimated rows | Total MB | Index MB | Role |
|---|---:|---:|---:|---|
| `public.catalogue_mv` | 69,901 | 91.29 | 43.29 | Main format-level read cache |
| `private.products` | 52,975 | 76.64 | 20.28 | Wine identity and catalogue attributes |
| `public.wine_market_summary_mv` | 51,067 | 32.93 | 3.22 | Wine-level market summary |
| `private.observation_events` | 113,853 | 29.57 | 14.07 | Recent change history |
| `private.skus` | 70,379 | 27.12 | 6.99 | Format-level current state |
| `public.wine_scenario_mv` | 69,901 | 20.73 | 2.86 | Additional market-only scenario projection |
| `private.offers` | 46,941 | 17.54 | 5.28 | Offer state used for next-offer estimates |
| `public.release_offer_source_rows` | 3,545 | 11.58 | 1.02 | Original promotional evidence |
| `public.release_offer_match_suggestions` | 7,755 | 10.22 | 3.24 | Current matching candidates |
| `public.release_offer_match_run_groups` | 10,822 | 5.82 | 3.06 | Matching execution history |
| `private.product_rest_checks` | 52,807 | 5.41 | 2.18 | Internal and published REST freshness |

The event table had **114,241 exact rows** at the later bounded aggregate. This illustrates why planner estimates should not be described as exact inventories.

Supabase currently documents a 500 MB Free-plan database limit and Nano compute with shared CPU and up to 0.5 GB memory. Its published Nano disk baseline is 5 MB/s and 250 IOPS, with temporary burst capacity. These are platform specifications, not measurements of this instance's available capacity. [Database size](https://supabase.com/docs/guides/platform/database-size), [compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk).

### Bloat: a real candidate, but not a measured reclamation budget

The CLI's statistical estimate reported:

| Relation | Reported bloat ratio | Approximate estimated excess allocation |
|---|---:|---:|
| `private.products` | 2.9 | 35 MiB, about 37 MB |
| `public.catalogue_mv` | 1.9 | 22 MiB, about 23 MB |
| `public.wine_market_summary_mv` | 1.9 | 14 MiB, about 15 MB |
| `private.skus` | 1.8 | About 9 MB |
| `private.offers` | 1.7 | About 5 MB |

The CLI prints PostgreSQL-style `MB`/`kB` units; the table makes the binary/decimal distinction explicit. These rounded estimates identify investigation order. They do not establish that a maintenance operation will safely return those amounts to the filesystem. The estimator also classified two expression indexes as `table` entries, which is another reason not to sum its entire output uncritically or apply its generic estimates to GIN indexes.

The main relations reported zero estimated dead tuples after the restart. That does not disprove bloat: vacuumed reusable space remains allocated, and cumulative statistics have a short observation window. The new scenario cache, by contrast, had an estimated bloat ratio near 1.0. Its 20.73 MB is mostly an additional data copy, not evidence of dead-row accumulation.

Do not run `VACUUM FULL` as routine nightly housekeeping. Standard vacuum permits reuse of space; full vacuum rewrites and locks a relation and needs extra space. Measure the reduced-write workload first, then consider one planned reclamation operation at a time with a tested restore and adequate disk headroom. [PostgreSQL vacuum guidance](https://www.postgresql.org/docs/17/routine-vacuuming.html).

---

## Refresh and recovery findings

### What actually ran

| UTC time | Outcome | Evidence |
|---|---|---|
| 29 September, 07:57-08:17 | Last run recorded as `completed` | Live `private.scan_runs` |
| 1 October, 13:18 | Source committed; catalogue refresh sequence failed | Run marked `partial`, `QueryCanceled` |
| 1 October, 15:19-15:36 | Source committed and both then-existing main caches refreshed | Run still `partial`: discovery collected 51,947 of 51,948 expected hits |
| 2 October, 07:51-08:17 | Failed while loading products | Five attempts at `SELECT * FROM products` timed out; no new source commit |
| 2-3 October, recent scheduled jobs | Green, but no sweep | Window checks exited in seconds; the inspected 3 October job ran at 20:10 BST, outside 22:00-01:00 |

The successful 1 October publication refreshed `catalogue_mv` in about 16.5 seconds, `wine_market_summary_mv` in 48.2 seconds and facets in 18.0 seconds. These are historical elapsed intervals from that job's logs, not performance measurements of today's code. The new `wine_scenario_mv` was created on 3 October and has no observed sweep-refresh baseline yet.

At 19:14 UTC on 3 October:

- The latest `checked_at` and `published_at` were both **1 October, 15:32:58 UTC**.
- No REST-check rows had unpublished changes.
- **3,697 parents** had a last REST check more than 30 days old.
- **13,399 events** were older than 30 days. Retention only runs after the sweep's source/refresh stages, so missed sweeps also delay cleanup.

Recent checkpoint samples showed low sync times, for example 13 buffers with 1.382 seconds of paced writing and 0.003 seconds of sync. That supports an idle instance currently behaving better. A large checkpoint with 223 seconds of writing for 2,229 buffers is not, by itself, evidence of slow storage: checkpoint pacing matters.

The sampled log window also contains permission and SQL-development errors. Do not count every logged error as an application outage. In particular, a `CREATE TABLE` rejected inside a read-only transaction does not establish that the platform imposed quota-based read-only mode.

Sources: [successful source-refresh job](https://github.com/rjc54n/bbx/actions/runs/36883325391), [failed sweep](https://github.com/rjc54n/bbx/actions/runs/36980383226), [inspected window-only job](https://github.com/rjc54n/bbx/actions/runs/37146909825), [write-reduction record](SWEEP-WRITE-REDUCTION-2026-10-02.md).

### R1. High priority: measure publication health independently of job success

**Live and code.** Green window-only jobs do not prove freshness. `fetchLatestCompletedScan()` filters out all partial and failed runs. The catalogue banner therefore reports the 29 September completed run even though a partial run published newer source data on 1 October. It cannot explain a later failed refresh or a night in which no job entered the window.

`commit_sweep()` writes terminal status and `finished_at` before cache refreshes. A failed refresh changes status to partial, but a timestamp-publication or facet-refresh exception only logs an error. The cadence guard treats all partial runs like completed ones for 40 hours, including cache failures. A zero-row materialised view produces a warning but is still considered a successful refresh.

**Recommendation:** distinguish latest attempt, source commit and successful cache publication using a few fields on the existing run record. Persist per-stage outcome and duration there. Drive the user-facing age from successful publication and expose a later failed attempt separately. Alert on excessive publication age even if recent GitHub jobs are green. A threshold around 60 hours is a proposed starting point for the agreed two-day cadence, not an existing service promise.

Treat unexpectedly empty catalogue caches as a failed publication. Make timestamp-publication and facet failures visible to the owner. Provide an operator recovery path for cache publication that does not refetch and rewrite the source book. Keep a failed source refresh distinct from incomplete discovery that nevertheless produced useful data.

**Acceptance:** a skipped night, partial discovery, failed second cache, failed timestamp publication and zero-row cache each produce an accurate status. A successful scheduled run followed by stable overnight health is required before declaring recovery.

Sources: [scan status reader](../apps/web/src/lib/query/scanHealth.ts), [banner](../apps/web/src/components/catalogue/DataHonestyHeader.tsx), [sweep](../core/sweep.py), [store](../core/store.py), [cadence guard](../core/sweep_window.py).

### R2. Medium priority: bound retention work and its backlog

**Code, with live backlog.** `prune_observation_events()` issues one `DELETE ... WHERE observed_at < cutoff` and commits it as one transaction. It has no row limit, elapsed-time budget or progress checkpoint. The table has no date-leading index. A period of failed sweeps can make the next successful run perform a larger cleanup precisely when the database is recovering.

The current retention window and explicit non-fatal Slack alert are good decisions. Preserve them. Convert the delete to bounded batches with a total per-run budget, reporting deleted rows, elapsed time and remaining backlog. An `observed_at` access path is a candidate only after comparing its read benefit against its index size and write cost on a local extract. Batching by itself can repeatedly scan the same table if the access path is poor.

Keep retention independent from source transaction success. Consider a separately invocable housekeeping command for recovery, without introducing a second scheduler by default. Do not change the accepted 30-day history policy or delete source evidence.

Source: [retention implementation](../core/store.py#L188), [accepted retention policy](STORAGE-RETENTION-PLAN-2026-10-01.md).

### R3. Medium priority: make rotation match the two-day cadence

**Code, reproduced locally.** `rotation_bucket_for_date()` uses calendar ordinal modulo 30. At an exactly two-day cadence, 30 successive sweeps visit only 15 of the 30 buckets. A local check over 60 days confirmed this. The overdue check prevents permanent starvation, so it would be incorrect to say half the book is never refreshed. It does mean half the rotation relies on catch-up rather than the intended even rotation, which can concentrate REST work.

Define selection in terms of the agreed freshness interval and actual sweep cadence. A small deterministic scheme that advances through all buckets, or bounded selection of the oldest checks, is sufficient. Preserve unconditional listed-wine pricing and the overdue safeguard. Test alternate-day runs, missed nights and failed runs. Changing rotation must not silently extend the freshness policy.

Sources: [rotation and overdue selection](../core/sweep.py#L195), [schedule](../core/sweep_window.py).

### R4. Medium priority: avoid repeating expensive successful refresh stages

**Code.** The refresh retry loop wraps all three main caches. A known failure in the second or third stage starts again at `catalogue_mv`, repeating already successful work. The refusal to retry ambiguous transport failures is correct and should remain.

Record which stage failed and retry only a known-failed stage when the source version is unchanged. The three refreshes currently commit separately, so readers can temporarily see different cache generations. A conservative published timestamp does not make that sequence atomic. Record the generation/source run and expose the degraded state; do not build a general orchestration service for this single-owner application.

The 90-minute workflow limit and the latest allowed start also deserve a finish-time check. During winter, a start just before 01:00 UK time could continue beyond 02:00 UTC. Retain margin before the documented backup-risk window. Manual dispatch bypasses both current guards and should remain an explicit operational choice.

Sources: [refresh loop](../core/store.py#L752), [workflow](../.github/workflows/daily_sweep.yml), [operational rules](../AGENTS.md).

---

## Query and cache efficiency

### Observed read costs

These are existing `pg_stat_statements` samples since the 2 October reset, not controlled benchmarks. Sample counts are small and may include verification traffic. Means are not p95s and exclude browser/network latency.

| Query shape | Calls | Mean database execution | Maximum | Finding |
|---|---:|---:|---:|---|
| Authenticated unfiltered catalogue, market-price order and exact count | 8 | 2,041 ms | 2,846 ms | Main landing query still expensive |
| Catalogue search by name/producer | 32 | 61 ms | 654 ms | Text indexes serve an observed useful path |
| Scenario reference query, one shape | 4 | 906 ms | 1,684 ms | A materialised market projection has not eliminated all work |
| Another scenario reference shape | 3 | 909 ms | 2,556 ms | Requires query-specific validation |
| Page-scoped historic-reference enrichment | 26 | 126 ms | 632 ms | Additional serial cost after the catalogue query |
| BBR positions market view | 14 | 220 ms | 710 ms | Keep unless later measurements identify a regression |
| Recent price changes with exact count | 2 | 916 ms | 994 ms | About 102 MB of temporary blocks written across two calls |

### R5. High priority: reduce price-change query temporary I/O

**Live and code.** `recent_price_change_view` joins event history to the wide catalogue rows before `DISTINCT ON` selects one event per format. The outer request then sorts by observation date and asks for an exact count. The planner-only inspection confirmed scans of events and catalogue, a hash join, a wide sort, deduplication and another sort. Existing statement statistics recorded 12,488 temporary blocks written across just two calls, about 102 MB at 8 KiB per block.

**Recommendation:** test selecting the latest event using narrow event columns before joining wine labels and format details. Retain the existing deterministic `observed_at DESC, event_id DESC` tie rule. Compare a partial expression index over the price-change subset with a sort-based approach. Do not recreate the previously removed broad event index without proving that the replacement serves this read path.

Keep exact totals unless the owner agrees to a pagination change. A page-plus-one approach, already used by scenarios, is an option if total page counts are not useful. Any new index must fit inside an explicit storage allowance; do not trade an unmeasured index for the known I/O cost.

**Acceptance:** identical latest-event rows on a restricted local extract, including simultaneous field changes, missing formats and tied timestamps; lower temporary writes and buffer work; no change to the accepted 30-day semantics. A date predicate can make the displayed window explicit even when cleanup is late, but should be agreed and tested as such.

Sources: [original view definition](../supabase/migrations/20260719120000_catalogue_read_model.sql), [price-change fetch](../apps/web/src/lib/query/fetchCatalogue.ts#L114).

### R6. Medium priority: optimise the default catalogue read without weakening search

**Live and code.** The unfiltered landing query orders 69,901 format rows by `market_price_p`, then parent and format, and calculates an exact count. `catalogue_mv` has a unique identity index and two GIN search indexes, but no index supporting this default ordering. The page's narrow selection already omits the joined freshness column, which is a useful optimisation.

Test a compact B-tree on `(market_price_p ASC NULLS LAST, parent_sku, format_code)` against the actual request. It can avoid a full sort, but the exact count can still dominate. Compare both costs separately. Do not create an index for every selectable sort or add a wide covering index that duplicates the displayed row.

The browser's effect uses a cancellation flag to suppress obsolete results but does not abort the underlying request. Rapid query changes can leave work running. Pass an abort signal through the supported query path and avoid starting reference enrichment after cancellation. Measure before claiming server work has been cancelled, since transport cancellation is not always immediate database cancellation.

**Acceptance:** same ordering, null placement and stable pagination; faster default-page reads under the agreed workload; explicit storage/write cost; ordinary search remains usable.

Sources: [fetch and exact count](../apps/web/src/lib/query/fetchCatalogue.ts#L76), [browser request lifecycle](../apps/web/src/components/catalogue/CatalogueBrowser.tsx), live index definitions.

### R7. Medium priority: simplify refresh computation before adding more caches

**Live definitions and code.** The main catalogue refresh performs a lateral offer aggregate for each live SKU. The offer index is needed for those probes. The summary cache then scans the catalogue in separate selection and aggregation branches. Concurrent refresh still executes the complete backing query; reduced source writes do not make it incremental. [PostgreSQL refresh documentation](https://www.postgresql.org/docs/17/sql-refreshmaterializedview.html).

Test a grouped offer calculation against the current per-format lateral calculation. It must preserve floor tolerance, tied lowest offers, inferred format matching, gone-offer exclusion and next-higher-price behaviour. Do not replace it based only on a shorter SQL definition.

The new scenario cache is a 20.73 MB projection of `catalogue_mv`, with arithmetic conversions and repeated identity text. It was added to solve a read-path problem, so removing it without a comparison would risk restoring that problem. Test whether equivalent selected expressions over the existing catalogue can supply scenarios at acceptable cost. If not, consider a narrower scenario cache and join labels after filtering. Keep owner references live and outside publicly readable market caches.

The three facet caches together occupy only **0.238 MB**. Their storage is not a useful cleanup target. Their historical refresh cost, about 18 seconds, is a reason to measure whether they can share one source scan or skip refresh when their inputs are unchanged. Do that only after the main workload is stable.

The recent conditional upserts should remain. They still send and conflict-check the discovered rows, but avoid creating new versions for unchanged facts. Client-side changed-row filtering may later reduce transfer and unique-index probes. Preserve reset-on-return behaviour and atomic disappearance handling if pursuing it.

Sources: [main cache migration](../supabase/migrations/20260827120000_catalogue_materialised_read_model.sql), [scenario cache migration](../supabase/migrations/20261003081500_wine_scenario_reference.sql), [conditional writes](../core/store.py#L170).

### R8. Medium priority: make cache selection deterministic and remove misleading timestamp contracts

**Live definitions.** `wine_market_summary_mv` chooses a representative row with `DISTINCT ON (parent_sku) ORDER BY parent_sku, case_size`. Formats can share a case size but have different bottle volumes or listing states. Without a further tie-breaker, the chosen row can vary, causing avoidable cache changes and unstable representative metadata.

Agree what the representative format should mean, then add a deterministic tie-breaker consistent with that rule. Separately calculate wine-level listing availability if consumers need an aggregate; do not infer it from an arbitrary representative format. Test equal case sizes and different volumes/listing states.

`catalogue_mv.last_rest_checked_at` and the summary copy are deliberately frozen by the 2 October migration. The 3 October scenario cache copies that frozen value and exposes it through `market.*`. The current scenario evaluator neither selects nor filters that field, so this review found a **latent data-contract defect, not a demonstrated stale timestamp on the scenario screen**. Remove or clearly deprecate the field, or join the appropriate published freshness in a supported reader. Do not reintroduce it into the cached payload and recreate timestamp churn.

The wine-format and BBR position readers use `catalogue_view`, which supplies `product_rest_checks.published_at`. That path should remain the freshness authority.

Sources: [summary definition](../supabase/migrations/20260827120000_catalogue_materialised_read_model.sql#L276), [timestamp migration](../supabase/migrations/20261002120000_product_rest_checks.sql), [scenario projection](../supabase/migrations/20261003081500_wine_scenario_reference.sql), [selected scenario fields](../apps/web/src/lib/scenarios/evaluate.ts).

---

## Indexes, retention and resource lifecycle

### R9. Medium priority: remove one confirmed duplicate; measure the rest

The live catalogue shows `idx_release_offer_match_suggestions_group_rank` duplicating the B-tree columns, operator classes, collation and ordering of `release_offer_match_suggestions_match_group_key_rank_key`. The latter enforces a unique constraint. The extra non-unique index occupies **901,120 bytes, 0.90 MB**.

Remove the redundant non-unique index in an isolated migration after confirming dependencies. Preserve the unique constraint. This is a small definite reduction in allocation and future writes, not a solution to the refresh incident.

| Index or group | Size | Disposition |
|---|---:|---|
| `catalogue_mv_name_trgm` | 25.23 MB | Keep for now: 90 observed scans; supports the app's search purpose. |
| `catalogue_mv_producer_trgm` | 12.37 MB | Keep for now: 92 observed scans; review only with search-equivalence tests. |
| Cache unique indexes | 11.72 MB across the three main caches | Keep: identify rows and support concurrent refresh. |
| `idx_products_release_name_match` | 8.86 MB | Measure during imports/matching. Zero scans in this short window is insufficient evidence to drop it. |
| `idx_products_core_key` | 7.66 MB | Same: specialised matching paths are infrequent. |
| `idx_offers_parent_sku_format` | 1.78 MB | Keep while the catalogue uses per-format offer probes. No post-restart sweep explains zero observed use. |
| `idx_obs_run` | 0.84 MB | Review: the larger unique event index has `scan_run_id` as its leading column. The narrower index can still be cheaper for some reads. |
| `idx_skus_gone_since`, `idx_offers_gone_since` | 2.19 MB together | Measure plans/selectivity over real refreshes before deciding. |
| Event primary and unique indexes | 13.24 MB | Preserve integrity/idempotency unless the event model is deliberately changed. |

The performance advisor reported 29 unused-index notices and 25 unindexed foreign keys. Neither list should become an automatic migration. Run identifiers and owner identifiers do not need every possible child-side index when their parent rows are rarely changed or deleted. Conversely, a future retention policy that deletes matching runs may make a currently unindexed foreign key relevant.

Source: [matching index creation](../supabase/migrations/20260728093834_historic_offer_catalogue_matching.sql#L68), live catalogue comparison; [unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [foreign-key index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

### R10. Medium priority: bound regenerable matching history without deleting decisions

The two sources' match suggestions, run groups and run headers occupy about **19.69 MB**. The suggestions are a current candidate set, not simply one copy per historical run. Run groups do accumulate execution history. Source rows, accepted prices, owner resolutions and resolution events have different retention requirements.

Define a small retention policy for completed operational runs while preserving current suggestions and the evidence needed to explain accepted links. Inspect foreign keys before implementing it: suggestion rows reference their source run with `ON DELETE CASCADE`, and owner resolutions can also reference runs. Blindly deleting old run headers can therefore remove current candidates or fail on retained decisions.

Do not delete original promotional text, import files, owner corrections, accepted BBR history or unresolved evidence as generic cleanup. The low-volume private records are the app's differentiated content. Legacy reference objects are already tracked for cleanup after three clean production days in [issue 14](https://github.com/rjc54n/bbx/issues/14). Honour that condition and check dependencies with `RESTRICT`; their small size does not justify bypassing the cutover checks.

Keep the existing 30-day event policy. A future narrower event payload or a typed latest-price-change relation might reduce the 29.57 MB event footprint, but neither is necessary before the query and retention fixes have been measured. Partitioning 114,000 events would add maintenance machinery without a demonstrated need.

### R11. Medium priority: retain performance evidence before resetting statistics

The post-sweep `pg_stat_statements_reset()` is an intentional workaround for previously costly metrics-exporter reads. Removing it without addressing the long statement texts could restore that problem. It also deletes the evidence needed to prove which refresh stage or application query consumed resources. Fatal sweep failures bypass the reset altogether.

Before resetting, write a small summary to job output: stage duration, actual changed-row counts, relation-size changes, WAL delta, temporary-byte delta and statistics-reset time. Do not store full query texts or an unbounded performance history in the production database. Reuse job artifacts or the existing run record for a compact summary. Database-wide counters include concurrent activity, so label their scope.

Over time, compare fixed statement shapes or prepared batch execution if large varying SQL texts remain a problem. This is secondary to the current write reduction. Index-use statistics and `pg_stat_statements` have different reset behaviour; never infer an index is dispensable just because statement statistics were cleared.

Sources: [statistics reset](../core/store.py#L241), [historical exporter diagnosis](SWEEP-WRITE-REDUCTION-2026-10-02.md).

---

## Code quality, data correctness and security

### Controls worth keeping

The core Python pipeline is shared by Streamlit and the arbitrage bot. Database access is concentrated in `core/db.py` and `core/store.py`. Source writes, events and run status commit atomically. Failed REST batches are distinguished from missing offers. Discovery completeness gates disappearance handling. Format-specific pricing and source-disagreement handling have focused tests.

The web app uses a shared filter registry and deterministic pagination ties. Scenarios fetch a bounded page with an extra row. Owner checks are deduplicated per server request with React `cache`, while RLS remains authoritative. Server-side secrets are not required in the browser. Source-specific imports preserve evidence and explicit owner decisions rather than trying to infer every correction automatically.

These are appropriate choices for one owner. There is no case here for adding queues, a separate cache service, a data warehouse, multi-tenant machinery or a generic job scheduler.

### R12. Medium priority: distinguish missing enrichment from failed enrichment

`fetchCatalogue()` catches a historic-reference query error and returns catalogue rows with empty reference fields. Keeping the market page available is sensible. Presenting a failed private lookup exactly like no private evidence hides a loss of the app's main benefit.

Return an enrichment status alongside the rows and display a concise retryable message. Do not block public market data, and do not expose database error details in the UI. This is a confirmed code path, not a claim that current owner reference reads are failing. Existing log denials may include anonymous verification requests; the current browser client already uses the SSR session.

Source: [reference fallback](../apps/web/src/lib/query/fetchCatalogue.ts#L103).

### Further bounded improvements

| Area | Finding and recommendation |
|---|---|
| Full-table client readers | The BBR positions page and some favourites readers fetch without explicit pagination. Local API configuration has a 1,000-row limit. Current estimated BBR evidence is below that, and evidence rows are not the same as position rows, so truncation is not established. Add pagination or an explicit completeness check before those collections can exceed the deployed API limit. |
| Search escaping | Raw PostgREST OR expressions quote commas/parentheses but do not consistently escape embedded quotes/backslashes. Add focused parser fixtures for literal unusual input. This is filter correctness, not evidence of SQL injection. |
| Python dependency reproducibility | `psycopg2-binary`, `boto3` and pytest use ranges without a resolved Python lock. Scheduled jobs install afresh. Pin or lock the production environment after validation to separate dependency drift from source defects. The web lockfile and `npm ci` already provide a firmer baseline. |
| Local/production parity | SQLite tests cover business logic but cannot prove PostgreSQL plans, locking, materialised refreshes or grants. Retain the PostgreSQL migration/pgTAP/concurrency checks. |
| Dual scan-store migration paths | `core/db.py` still has a legacy `_migrations` bootstrap alongside Supabase migrations. It is guarded and currently deployed coherently, but should not become a second place for new production schema changes. |
| Maintenance breadth | The previous Streamlit interface, bot and Next.js app add surfaces to test. Keep the scanner's distinct role; retire a UI only if the owner no longer uses it. File count alone is not runtime bloat. |
| Documentation | README text still describes a public catalogue, while the current app route is under owner protection. Some historic design sections retain superseded statements. Record current ownership and deployment facts in the entry documentation; keep dated incident evidence intact. |

### Access-control assessment

**Live:** all 28 public ordinary tables had RLS enabled. Owner-data policies use `private.is_app_owner()`; the allowlist SELECT policy uses the authenticated user's UUID. The Storage bucket is private. Ordinary public views inspected in the inventory use invoker security. The executable public security-definer bodies checked here contain owner checks, except a withdrawn compatibility function that unconditionally raises an exception. No anonymous execute grant was found on those owner mutation functions.

This supports the intended single-owner access model. It is not proof of all live Auth settings, MFA enforcement or every direct API action.

The security advisor reported:

| Notice | Count | Assessment |
|---|---:|---|
| Mutable search path on `search_producers` | 1 | Pin the path and qualify references. This is an invoker search function, not evidence of an owner-data privilege bypass. [Guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable). |
| `pg_trgm` in `public` | 1 | Low-priority schema hygiene. Move only with function/operator/index dependency checks. [Guidance](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public). |
| Materialised views reachable through API roles | 6 | Market-only caches, with no private reference value in the inspected definitions. Review deliberate exposure; do not add owner evidence to them. [Guidance](https://supabase.com/docs/guides/database/database-linter?lint=0016_materialized_view_in_api). |
| Authenticated callers can execute security-definer functions | 50 | Expected for owner RPCs only because their bodies enforce ownership. Preserve negative access tests. [Guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). |
| Leaked-password protection disabled | 1 | Assess plan availability and owner account controls; not a database-capacity fix. [Password guidance](https://supabase.com/docs/guides/auth/password-security). |

The signed-in UI does not remove the existing anonymous market-data grants. That exposure may be intentional, but it allows direct API reads independent of the owner interface. Review whether it remains wanted for this single-owner product before changing grants. The concern is also availability: expensive public queries can consume the same small database's resources. Do not claim an exposure of cellar records from these market-only grants.

Installed extensions were `plpgsql`, `pg_stat_statements`, `uuid-ossp`, `pgcrypto`, `supabase_vault` and `pg_trgm`. No large unused application extension footprint was identified. Hosted Supabase background services and platform-managed objects should not be removed as speculative cleanup.

### Backup and recovery scope

The documented incident backup command exports the `private` scan-store schema. That is appropriate for that retention operation, but it does not cover all owner records in `public`, Storage object payloads or Auth setup. This review did not verify a current complete restore set.

Before further destructive cleanup, confirm a recoverable copy of accepted cellar/promotional evidence and owner decisions, plus the original Storage files. Test a restore outside production. This is a verification gap, not a claim that no other backups exist. Keep backups and private extracts outside Git. The scan store can be repopulated; an owner's manual decisions and original records may not be recoverable from BBX.

---

## Recommended delivery order

This is a review backlog, not approval to implement its UX or architectural choices. Preserve the recorded decisions to remain on the Free plan, retain the full biddable universe and run every two days overnight UK time.

| Order | Work | Observable outcome | Decision or validation needed |
|---|---|---|---|
| 1 | Observe a normal post-change sweep and record publication/health evidence | Confirm changed-row counts, all three cache durations, published age and overnight behaviour | No forced daytime sweep; current dashboard resource evidence still needed |
| 2 | Add accurate attempt/publication status and missed-publication alerting | A green skipped job cannot conceal stale data | Agree the age threshold and concise owner-facing status |
| 3 | Bound retention; correct rotation/cadence mismatch | Predictable cleanup and REST selection after missed nights | Preserve accepted history and freshness policies |
| 4 | Remove the confirmed redundant matching index | About 0.90 MB less allocated index space and one fewer index to maintain | Isolated migration and smoke check |
| 5 | Optimise latest-price-change selection | Lower temporary I/O with identical results | Restricted local extract and query comparison |
| 6 | Evaluate the default catalogue sort/count path | Faster first-page reads without harming search | Agree any count/pagination change; measure index trade-off |
| 7 | Resolve summary tie selection and obsolete timestamp contracts | Stable rows and one clear freshness source | Confirm representative-format semantics |
| 8 | Measure remaining cache costs, then choose one simplification | Lower refresh work or less duplicated storage | Demonstrate benefit before changing cache architecture |
| 9 | Reclaim selected residual bloat if still necessary | Sustained size reduction after writes stabilise | Restore proof, maintenance window, spare disk and one relation at a time |
| 10 | Add matching-history lifecycle and finish legacy cleanup | Bounded operational history without lost owner evidence | Dependency analysis; honour the three-clean-day cutover gate |

Do not add together the bloat estimates, possible cache removal and index savings as a guaranteed total. Those changes overlap and some may trade storage for read speed. The 0.90 MB duplicate index is a measured allocation; the 20.73 MB scenario cache is a possible architectural saving; residual bloat is an estimate requiring a maintenance decision.

### Acceptance for remaining on the Free plan

Use the next five real sweeps, rather than five scheduled job results, as the initial observation period. Proposed operating criteria are:

- Every due sweep either publishes successfully or produces an actionable alert. Record source, catalogue, summary, scenario and facet outcomes separately.
- Database size settles instead of rising after every refresh. Keep a working target below roughly 400 MB and act before 450 MB; these are proposed operating margins, not Supabase limits.
- Measure peak disk use separately, including WAL and refresh temporary space. A low end-of-job database size cannot establish peak safety.
- Conditional upserts update changed/returning rows, rather than the whole book. Compare counters before and after a run; logging how many rows were submitted is insufficient.
- Cache work tracks real changes after timestamp decoupling. Use local buffer/WAL comparisons and ordinary production-run measurements; do not benchmark production repeatedly.
- The price-change query's temporary writes fall after optimisation. Ordinary catalogue/scenario reads remain within the existing role timeouts, with enough margin for the normal refresh workload.
- Checkpoints, trivial-query response and dashboard disk I/O remain healthy during the run and after the backup window. Do not interpret paced checkpoint write duration alone as a failure.
- Overdue REST checks and retention backlog do not accumulate across successful runs.

If these criteria cannot be met after the bounded changes, the owner must choose a further reduction in refresh work or revisit compute capacity. Being below 500 MB alone is not an acceptance test. No paid-plan change is proposed for execution in this review.

### Safe change procedure

Validate each SQL change on a restricted local extract while no data branch is available. Compare results both ways and inspect plans/buffers locally. Record that local elapsed times do not predict Nano latency. Apply one independently deployable database slice, confirm the remote migration ledger and smoke-test its readers before proceeding.

Schedule expensive maintenance outside 02:00-05:00 UTC and only on a healthy instance. Avoid combining bulk deletion, index changes, full vacuum and repeated sweeps in one recovery session. After an ambiguous production failure, inspect server-side activity before any retry. A merge deploys the web app, not the database.

Sources: [repository operating rules](../AGENTS.md), [local-extract validation policy](PERFORMANCE-DATA-BRANCH-VALIDATION.md).

---

## Validation performed

| Check | Result |
|---|---|
| Working tree before review | Clean, `main` at `9a28118` |
| Local/remote migration ledger | All 78 matched through `20261003140728` |
| Python tests using the project virtual environment | 340 passed, 4 skipped; skipped tests require a running local PostgreSQL instance |
| Web unit tests | 370 passed across 41 files |
| Web lint | Passed |
| Production build and TypeScript | Passed; initial sandbox port-binding failure resolved by the permitted local build rerun |
| Current application CI | Passed at the reviewed commit, [run 37137693204](https://github.com/rjc54n/bbx/actions/runs/37137693204) |
| Latest database-changing CI | Passed migration replay, schema lint, pgTAP and BBR concurrency steps, [run 37128760650](https://github.com/rjc54n/bbx/actions/runs/37128760650) |
| Live size, relations, indexes, definitions, grants and policies | Read-only checks completed |
| Supabase security/performance advisors | Read and assessed; notices were not auto-fixed |
| Rotation/cadence check | Local 60-day alternate-day sequence reached 15/30 buckets |
| Production refresh/load test | Not performed |
| Current owner/non-owner browser smoke test | Not performed in this review |
| Complete restore test and dashboard resource verification | Not performed in this review |

The initial system Python lacked pytest; the existing project virtual environment supplied it. No dependencies were installed. An additional GitHub read initially stopped when automatic approval review hit a usage limit. It succeeded after resumption, so that did not leave an evidence gap.

---

## Appendix: complete application relation inventory

All ordinary tables and materialised views in `public` and `private` are listed below. Sizes include indexes and TOAST. They are a point-in-time inventory, not a proposal to retain every object forever. An unknown planner row estimate is shown as `unknown`.

| Relation | Kind | Estimated rows | Total MB | Index MB |
|---|---|---:|---:|---:|
| `public.catalogue_mv` | Materialised view | 69,901 | 91.292 | 43.295 |
| `private.products` | Table | 52,975 | 76.644 | 20.275 |
| `public.wine_market_summary_mv` | Materialised view | 51,067 | 32.932 | 3.219 |
| `private.observation_events` | Table | 113,853 | 29.573 | 14.074 |
| `private.skus` | Table | 70,379 | 27.116 | 6.988 |
| `public.wine_scenario_mv` | Materialised view | 69,901 | 20.726 | 2.859 |
| `private.offers` | Table | 46,941 | 17.539 | 5.276 |
| `public.release_offer_source_rows` | Table | 3,545 | 11.583 | 1.016 |
| `public.release_offer_match_suggestions` | Table | 7,755 | 10.224 | 3.236 |
| `public.release_offer_match_run_groups` | Table | 10,822 | 5.825 | 3.056 |
| `private.product_rest_checks` | Table | 52,807 | 5.407 | 2.179 |
| `public.release_offer_prices` | Table | 5,698 | 2.572 | 1.221 |
| `public.cellartracker_match_suggestions` | Table | 2,025 | 2.114 | 0.655 |
| `public.cellar_import_rows` | Table | 1,557 | 1.696 | 0.164 |
| `public.cellartracker_match_run_groups` | Table | 1,788 | 1.319 | 0.729 |
| `public.wine_match_group_evidence` | Table | 3,079 | 1.073 | 0.303 |
| `public.release_offer_resolution_events` | Table | 1,610 | 1.032 | 0.246 |
| `public.release_offer_product_resolutions` | Table | 2,056 | 1.032 | 0.418 |
| `public.cellartracker_evidence` | Table | 604 | 0.500 | 0.229 |
| `public.bbr_holding_evidence` | Table | 910 | 0.467 | 0.205 |
| `public.cellartracker_product_resolutions` | Table | 233 | 0.172 | 0.041 |
| `public.cellartracker_record_decisions` | Table | 236 | 0.164 | 0.074 |
| `public.cellartracker_resolution_events` | Table | 234 | 0.139 | 0.016 |
| `public.facet_values_mv` | Materialised view | 548 | 0.139 | 0.049 |
| `public.cellar_imports` | Table | 2 | 0.131 | 0.115 |
| `public.release_offer_match_runs` | Table | 6 | 0.115 | 0.016 |
| `public.release_offer_imports` | Table | unknown | 0.098 | 0.082 |
| `public.cellartracker_match_runs` | Table | 5 | 0.090 | 0.016 |
| `private.scan_runs` | Table | 84 | 0.090 | 0.033 |
| `public.format_options_mv` | Materialised view | 52 | 0.066 | 0.016 |
| `public.saved_scenarios` | Table | unknown | 0.049 | 0.033 |
| `public.wine_favourites` | Table | unknown | 0.049 | 0.033 |
| `public.app_owners` | Table | unknown | 0.041 | 0.033 |
| `public.release_offer_record_exclusions` | Table | unknown | 0.033 | 0.016 |
| `public.bbx_fee_schedule` | Table | unknown | 0.033 | 0.016 |
| `private._migrations` | Table | unknown | 0.033 | 0.016 |
| `public.owner_release_anchors` | Table | unknown | 0.033 | 0.016 |
| `public.pending_favourites` | Table | unknown | 0.033 | 0.025 |
| `public.reference_price_decisions` | Table | unknown | 0.033 | 0.016 |
| `public.release_price_anchor_overrides` | Table | unknown | 0.033 | 0.025 |
| `public.facet_ranges_mv` | Materialised view | 1 | 0.033 | 0.016 |

## Appendix: repeatable lightweight checks

Run outside the protected incident window. Confirm instance health before each group and stop if a bounded read times out. These checks do not establish peak I/O or physical bloat.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT now(), pg_database_size(current_database()) AS database_bytes,
       pg_postmaster_start_time(),
       current_setting('default_transaction_read_only') AS read_only;
SELECT id, status, started_at, finished_at, error_message,
       algolia_complete, rest_skus_expected, rest_skus_priced,
       rest_skus_failed
FROM private.scan_runs
ORDER BY started_at DESC LIMIT 5;
COMMIT;
```

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT max(checked_at) AS latest_check,
       max(published_at) AS latest_publication,
       count(*) FILTER (WHERE checked_at IS DISTINCT FROM published_at)
           AS unpublished_parents,
       count(*) FILTER (WHERE checked_at < now() - interval '30 days')
           AS overdue_parents
FROM private.product_rest_checks;
SELECT schemaname, relname, n_live_tup, n_dead_tup,
       n_tup_ins, n_tup_upd, n_tup_del, last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname IN ('public', 'private')
ORDER BY pg_total_relation_size(relid) DESC LIMIT 12;
COMMIT;
```

Save the observation time and reset times alongside results. After a sweep, compare publication state and counter deltas before the application clears statement statistics. Do not use `max(published_at)` alone as proof that every listed format is fresh; it describes the newest parent check, not coverage.
