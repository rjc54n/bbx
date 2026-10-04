# Tranche 2 read measurements

Status: pre-implementation evidence, 4 October 2026. Read-only production checks ran between 13:49 and 14:01 UTC, outside the 02:00-05:00 UTC backup-risk window. No schema, data, persistent settings or application code changed. This records scope for owner review; it does not authorise implementation or deployment.

## Preserved statement statistics

[The JSON snapshot](evidence/pg-stat-statements-reads-2026-10-04.json) contains the full query text and all reported `pg_stat_statements` counters for 74 `SELECT`/`WITH` statement shapes. It was captured at 13:51:06 UTC, before the next sweep reset. The counters began at the 3 October 23:07:51 UTC reset. The selection is based on the statement prefix, so it should be read as read-shaped SQL rather than proof that every statement is free of side effects.

The current snapshot has one unfiltered catalogue landing call with exact count: 3,178 ms of database execution, 35,438 shared-buffer hits and 226 shared-buffer reads. It has no recorded call for the price-change page, an unfiltered name sort or `/matches`. The only name sorts in the snapshot also filter by search terms and vintage; their 3 ms calls do not answer the unfiltered-sort question. This is a small, mixed-traffic sample, not a controlled latency distribution.

No Supabase data branch is available. A cheap activity check found no other active backend before the probes. Each probe used `BEGIN READ ONLY`, a 5-second statement limit and one `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` query. This is a deliberate limited production read in place of a branch measurement. It does not include PostgREST, browser or network time. The page probes selected the same catalogue columns as the client, or `*` for the price-change view, and fetched 26 rows to model page plus one. The count probes were separate to isolate the work that exact totals add.

| Path | Database execution | Shared-buffer hits / reads | Temporary writes | Reading |
|---|---:|---:|---:|---|
| Catalogue exact count | 2,383 ms | 29,763 / 0 | 0 | Material cost that page-plus-one can remove. |
| Catalogue price sort, 26 rows | 1,622 ms, then 203 ms on one repeat | 5,898 / 0 on both | 0 | Full scan and top-N sort. Timing varied enough that an index needs local comparison. |
| Catalogue unfiltered name sort, 26 rows | 53 ms | 5,891 / 0 | 0 | No current case for a name-sort index. |
| Price-change page, 26 rows | 1,513 ms | 7,940 / 0 | 5,399 blocks, 44.23 MB | Wide selection still spills after removing the count. Keep R5's narrow-event rewrite. |
| Price-change exact count | 238 ms | 31,864 / 0 | 543 blocks, 4.45 MB | Removing it helps, but it is not the main R5 cost. |
| `/matches` exact count | 768 ms | 4,243 / 149 | 0 | Material for a list read; remove its exact count and use page plus one. |

Raw plans: [catalogue count](evidence/catalogue-count-plan-2026-10-04.json), [price sort](evidence/catalogue-page-price-plan-2026-10-04.json), [price sort repeat](evidence/catalogue-page-price-repeat-plan-2026-10-04.json), [name sort](evidence/catalogue-page-name-plan-2026-10-04.json), [price-change page](evidence/price-changes-page-plan-2026-10-04.json), [price-change count](evidence/price-changes-count-plan-2026-10-04.json), [`/matches` count](evidence/matches-count-plan-2026-10-04.json). Times are single executions, except the price-sort repeat. Buffer counts and temporary writes are per plan, not totals across these probes. A warm cache and changing instance load can affect the figures.

The R9 duplicate remains present. `idx_release_offer_match_suggestions_group_rank` is a non-unique B-tree on `(match_group_key, rank)` occupying 901,120 bytes. `release_offer_match_suggestions_match_group_key_rank_key` is the unique constraint index on the same columns, occupying 909,312 bytes. The isolated R9 migration should remove only the non-unique index.

---

## Proposed scope for owner review

- R9: one migration removing only the confirmed duplicate index. Verify the unique constraint and normal matching reads afterwards.
- R5: select narrow latest-event rows before joining the catalogue, retain timestamp and event-ID tie order, and remove the exact count. Check results in both directions and compare PostgreSQL plans on a local copy of the data. Do not add an event index unless that comparison justifies its storage and write cost.
- R6: use page plus one on the catalogue and abort obsolete browser requests. Leave the unfiltered name sort without a new index. Trial a compact price-sort index only on the local copy; include its measured size and refresh cost before deciding whether to ship it. The count removal is already justified; the price-index decision remains open.
- `/matches`: remove the exact count and use page plus one with the existing deterministic order. Keep the separate queue summary; do not rewrite its view or small owner-data counts in this tranche.
- R12: return an enrichment-failed status with otherwise usable market rows and offer a retry. Keep an absent reference distinct from a failed lookup. The owner must approve the displayed message before building it.

The pagination display needs the owner's choice: next/previous controls only, or an approximate total explicitly labelled as such. Next/previous is the simpler option and avoids a potentially misleading estimate for filtered lists. Apply the chosen pattern to the catalogue and price-change lists, and to `/matches` if its exact count is removed.

Implementation remains local until the owner confirms the display and R12 wording. There will be no production slice before 05:00 UTC on 6 October, and only after the first new-code sweep and the following backup window show healthy publication and instance capacity. Deploy R9 first, then R5, then any justified sort index, with one migration pushed and smoke-tested before the next. App deployment and migration deployment are separate checks.
