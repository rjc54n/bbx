# Tranche 2 local handover

Status: built and verified locally on 4 October 2026. No Tranche 2 migration or app change has been deployed. Production work is gated until after 05:00 UTC on 6 October, subject to the first new-code sweep and its following backup window remaining healthy.

The [pre-implementation measurements](TRANCHE-2-MEASUREMENTS-2026-10-04.md) and [statement snapshot](evidence/pg-stat-statements-reads-2026-10-04.json) were saved before the next sweep reset. The owner chose next/previous controls only for the catalogue, price-change and `/matches` lists. The owner approved the R12 message, "Historic reference prices could not be loaded. Catalogue prices are still shown.", with a "Try again" button.

---

## Local changes and evidence

- R9 has a separate migration that removes only `idx_release_offer_match_suggestions_group_rank`. The unique `(match_group_key, rank)` constraint and its index remain. The duplicate occupied 901,120 bytes in production at measurement time.
- R5 has a separate migration that selects the latest narrow price event per `(parent_sku, format_code)` before joining catalogue details. It retains `observed_at DESC, event_id DESC` as the tie rule. The price-change list fetches 26 rows for a 25-row page and does not request an exact count.
- R6 makes the catalogue fetch 26 rows for each 25-row page, aborts obsolete requests and avoids reference enrichment for the extra row. There is no new name-sort index: the unfiltered production probe took 53 ms. A separate migration adds a price-sort index because the production price page required a full scan and a local trial reduced the same 26-row read from 28.44 ms and 3,162 buffer hits to 0.228 ms and 26 hits plus 3 reads. The index occupied 3,497,984 bytes locally. One local no-change concurrent refresh took 752.686 ms with the index and 671.497 ms without it. This single pair is a cost signal, not a production refresh forecast.
- The `/matches` list now uses page plus one and omits its exact list count. The separate queue summary remains. Its production exact-count probe took 768 ms.
- R12 distinguishes a successful reference lookup with no evidence from a failed lookup. The failed case retains catalogue prices, shows the approved message and offers a retry.

A restricted local extract contained six private scan tables: 88 scan runs, 107,619 observation events, 53,005 products, 47,323 offers, 52,837 product REST checks and 70,391 SKUs. After local restore, `catalogue_mv` held 69,908 rows and `recent_price_change_view` held 32,987. The extract was deleted after validation. No Supabase data branch was available, so the production work was limited to the bounded read-only probes recorded in the measurement document.

On the copied data, old and new R5 views had zero differences in either `EXCEPT ALL` direction across all 32,987 rows. A rolled-back fixture with same-time events confirmed that the later event ID won in both views, and a missing-format event stayed absent. Full ordered row comparisons also matched in both directions for catalogue price pages 1, 2 and last, catalogue name pages 1 and 2, and price-change pages 1, 2 and last. The last-page `hasNext` value was false in both lists.

At local `work_mem=2184kB`, the old R5 plan took 169.249 ms and wrote 5,388 temporary blocks. The new unfenced view took 93.902 ms and wrote 725 blocks. A trial partial event index reduced the new view to about 63 ms and zero temporary writes, but occupied 4,505,600 bytes and increased buffer hits from 4,864 to 59,235. That index was removed from local testing and is outside this tranche.

---

## Checks and release gate

A clean `supabase db reset --local --no-seed` replayed all migrations, including R9, R5 and the price-sort index, in that order. The local pgTAP suite passed: 21 files, 528 tests. Web lint and 382 Vitest tests passed, and the Next.js production build succeeded. An authenticated browser check against the local Supabase copy showed 25 catalogue and price-change rows per page and working Next navigation. The last-page `hasNext` checks were SQL comparisons, not browser checks. Local `/matches` had no public matching records, so only its empty state was checked in the browser. Temporarily revoking local access to the reference view showed the exact approved R12 message while keeping the catalogue rows visible. Restoring access and pressing "Try again" removed the message. The access change and test owner were local only; the subsequent clean database replay removed the test owner.

Do not push the app code or deploy a Tranche 2 migration before the time and health gate. After 05:00 UTC on 6 October, inspect the first new-code sweep's terminal outcome, source and cache publication coverage, cache freshness, stage durations, WAL and temporary I/O, and instance capacity through the following backup window. If those are healthy, apply and smoke-test R9 first, then R5, then the price-sort index. Check `supabase migration list --linked` after each push. Deploy the app only when its required database shape is live, and confirm the deployed readers through normal use without load tests. If the sweep or backup window is degraded, defer all slices and investigate the existing run evidence before any retry.
