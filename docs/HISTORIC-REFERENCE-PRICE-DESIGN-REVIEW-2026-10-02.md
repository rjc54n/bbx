# Historic reference price: data model and change review

Status: approved design, 3 October 2026. No schema, application or production data was changed at review time.

## Decision in view

A historic reference price is an evidenced earlier price used to compare with today's BBX ask and bid. It is a benchmark, not a claim about the original release price, the current seller's cost or another seller's acquisition lot. This feature covers every case size of 75 cl bottles. The reference is one price per 75 cl bottle for each `parent_sku`, and a market comparison scales it by the listing's case size. The source's case size and date meaning remain visible. Larger and smaller bottle volumes are out of scope.

The application currently calls its benchmark a release price. That label overstates what an accepted offer proves, and excludes BBR purchase-price evidence. Build a new owner-only reference resolution over the existing source records. Keep the offer records and BBR snapshots as evidence. Do not copy private prices into `catalogue_view` or the catalogue materialised view.

---

## What the current model says

| Source | Stored grain and amount | Date actually known | Current path into comparisons |
| --- | --- | --- | --- |
| BBR My Cellar | Accepted `bbr_holding_evidence` rows, Parent ID and exact format, GBP in-bond reported purchase price per case | Snapshot `effective_date`. This is when BBR reported the price, not necessarily the purchase date. | `bbr_position_observations` and `bbr_positions_view` preserve all accepted history. No path into `resolved_release_anchor_view`. |
| Historic CSV and Gmail offers | `release_offer_prices` fragments linked to Parent ID and exact format; only valid GBP in-bond prices in `release_offer_evidence_view` | `offer_date`, the dated offer, not proof that it was the original release | `release_price_anchor_view` chooses the earliest offer unless an offer is confirmed. |
| Owner entry | `owner_release_anchors`, one asserted GBP in-bond case price per format | Optional `offer_date` and free-text note; the date and source type are not structurally distinguished | Always outranks imported offers in `resolved_release_anchor_view`. |
| CellarTracker | `current_cellartracker_records`, one linked wine row and GBP purchase price per 75 cl bottle. The import enforces GBP only; the owner confirms these prices were entered from BBR purchase records and are always in-bond. | No purchase date. The latest accepted import time is not a price date. | Shown as purchase-price evidence, but never supplies a release anchor. Matching is at Parent ID, without a case format. |

Implementation checked: [BBR history](../supabase/migrations/20260905160000_bbr_position_history.sql), [offer evidence](../supabase/migrations/20260730090000_import_owner_decisions.sql), [owner resolver](../supabase/migrations/20260817140000_owner_release_anchors.sql), [catalogue browser](../apps/web/src/lib/query/fetchCatalogue.ts), [favourites](../supabase/migrations/20260827120000_catalogue_materialised_read_model.sql) and [scenarios](../supabase/migrations/20260829120000_scenario_per_75cl_money.sql).

`wine_card_view` is wine identity. `wine_card_format_view` is the format-level presentation record. There is no persisted, source-neutral golden price row. The catalogue browser fetches `catalogue_view` and then decorates each page from `resolved_release_anchor_view`. The wine card, scenarios and favourites use separate database views. A change limited to the catalogue browser would therefore leave contradictory prices elsewhere.

The source boundaries matter:

- BBR snapshots are repeated observations of a position, not transactions or acquisition lots. A changed reported price cannot safely be interpreted as a second purchase.
- The offer pipeline has no trusted, deployed `offer_kind` field that separates an initial release from a later back-vintage offer. Earliest accepted offer means earliest known offer.
- A linked 75 cl CellarTracker purchase price is already at the chosen per-bottle grain. It can enter the candidate set directly, while its missing purchase date remains explicit. Because it was transcribed from BBR records, it is the same signal as BBR, not independent corroboration: 118 of the 130 wines held in both agree within 1p per bottle. Agreement between the two must not be presented as two sources confirming a price.
- The four existing owner entries are deliberate assertions, but their notes describe different evidence. Preserve them as manual reference choices, without relabelling their dates as proven release dates.

---

## Live data check

Read-only queries against the linked Supabase project on 2 October 2026 found:

| Check | Result | Design consequence |
| --- | ---: | --- |
| Accepted BBR Parent ID and format positions | 213 | Historical observations, including former holdings, must feed candidate selection. |
| BBR positions with one distinct positive reported price | 211 | These are candidate prices after dividing by their 75 cl case size; wine-level conflicts can still arise from other evidence. |
| BBR positions with changing reported prices | 2 | Preserve the dated values and require a choice. One position moves £159, £135, then £121.98 per case; another changes and later returns to £159. |
| BBR positions with an exact catalogue format | 211 | Two BBR positions need a source-only wine card or reference history without a catalogue row. |
| Accepted, linked, valid in-bond offer rows after de-duplication | 2,666 across 2,347 formats | The existing earliest-offer rule covers many formats but does not establish original release. |
| Offer formats with more than one distinct price | 70 | Date order is evidence, not a conflict-resolution decision. |
| Formats present in both BBR and offer evidence | 77 | 56 have the same case price, 20 differ while BBR itself is consistent, and one also has conflicting BBR history. |
| Combined BBR and offer formats | 2,483 | 2,392 have one distinct price and 91 have competing prices. This excludes owner and CellarTracker entries. |
| Conflicts remaining after a 2% price band | 84 | A bounded read-only check found only seven of the 91 exact-price conflicts within 2%, using `max(price) <= 1.02 × min(price)`. Tolerance alone does not settle the selection rule. |
| In-scope 75 cl case formats | 1,512 | 74 have competing exact case prices and 67 remain conflicting after the 2% band. Of these formats, 1,197 are 6 × 75 cl and 191 are 12 × 75 cl. |
| Wines with 75 cl BBR or offer evidence after normalising by case size | 1,455 | 54 have evidence in multiple 75 cl case sizes; 105 have competing exact per-bottle prices and 92 remain conflicting after the 2% band. |
| Wines with 75 cl evidence including CellarTracker | 1,471 | 155 have linked positive CellarTracker prices, 16 of them without BBR or offers. There are 113 exact per-bottle conflicts, 99 beyond 2%. |
| Wine-level conflicts by cause, after rounding each candidate to whole pence per bottle | 113 | None is caused by fractional pence. 83 wines have offers that disagree with each other, 12 have BBR and CellarTracker more than 1p apart, two have changing BBR history, and one has CellarTracker against offers without BBR. Wines can fall into more than one group. |
| Current CellarTracker rows | 603 | 290 are linked to a Parent ID; 155 linked wines have a positive recorded price. |
| Linked priced CellarTracker wines also found in BBR / offers | 130 / 70 | These are wine-level overlaps, not exact-format price contradictions. |
| Owner release-price entries / confirmed offer selections | 4 / 0 | Existing manual prices need a safe migration; no offer confirmations need migration. |
| Saved scenarios | 3 | Two definitions use a release comparison or sort. Their meaning must not change silently. |
| Favourited wines | 22 | Ten have more than one catalogue format, three have more than one listed format, and seven currently display a release figure. A wine-wide price cell can hide a format mismatch. |

For 2010 Château Poujeaux, the accepted BBR observation is £210 per 12 × 75 cl case, effective 1 February 2020. The matching catalogue format is `12-00750`, and `bbr_positions_view` calls it former. No resolved release anchor exists. This is a valid BBR-reported historic reference candidate; the evidence does not date the purchase or establish the original release price.

The catalogue materialisation contains 54,541 75 cl formats, including 15,912 listed formats. It also contains 9,391 magnum formats, including 1,915 listed formats. Hiding non-75 cl formats from the owner's main browsing and scenario screens would be a query or UX change; deleting them from source data is not needed for this reference-price design.

These counts describe the queried production state on 2 October 2026. There was no Supabase data branch available. The checks were bounded, read-only aggregates and targeted record lookups. No row-equivalence or timing test was run against production. The earlier 91-conflict count is at exact case-format grain; it is not the count for the chosen per-bottle model. Blanking all 113 wine-level conflicts would remove many existing offer-derived numbers before owner decisions are considered.

---

## Proposed resolution contract

1. Keep source records authoritative. Add a `historic_reference_candidate_view` over eligible accepted 75 cl evidence. It exposes `parent_sku`, `source_kind`, original amount and case size, normalised pence per 75 cl bottle, and distinct `price_event_date` and `observed_on` fields. Offers and BBR case prices divide by their 75 cl case size. A linked, positive 75 cl CellarTracker purchase price is already per bottle and can enter directly. The candidate detail retains source row keys for navigation; owner decisions do not depend on them. An offer has an event date, BBR has an observation date, and CellarTracker has no known purchase date.
2. Compare per-bottle amounts before selecting a wine-level reference. Store and compare per-bottle money as whole integer pence, matching the existing `*_per_75cl_p` and CellarTracker columns: `round(case_price_p::numeric / case_size)`. Case prices are almost always whole pounds, so £110 for six bottles is £18.333… per bottle; the recurring fraction is an artefact of division, not price information. A candidate supports the selected price when it is within 1p per bottle of that price. A set has competing prices when its highest and lowest rounded values differ by more than 1p. This keeps the rule unambiguous if three prices differ by 1p in sequence. A case figure shown beside a listing is the per-bottle reference multiplied by the listing's case size, rounded to whole pounds. For any case of up to 100 bottles, this recovers the original whole-pound case price exactly, because the per-bottle rounding error is at most 0.5p a bottle. Percentage comparisons use the per-bottle integers directly. Repeated observations of the same amount are one price choice with several supporting records. Preserve the records, original case amounts and dates in the detail view. Exclude zero, invalid, unaccepted, unlinked, excluded, duty-paid and unknown-basis values from automatic comparison.
3. Add one owner-only `reference_price_decisions` row per `parent_sku`, containing a positive GBP in-bond `price_per_75cl_p INT`, optional note, decision time and an optional date. The note states what the date means. A case-price entry is divided by that case's size and rounded to whole pence when saved. The four existing `owner_release_anchors` belong to four separate wines and all use 6 × 75 cl; migrate their per-bottle values, notes and dates without treating the old `offer_date` column as proof of an offer date. Current candidates within 1p support the owner price; that does not mean the owner selected a particular source. BBR and CellarTracker agreement is one underlying purchase signal, not independent corroboration. If matching evidence disappears, keep the owner's price and show `no current corroboration`.
4. Add a `resolved_reference_price_view`, with at most one row per `parent_sku`. Its owner-facing contract is `reference_price_per_75cl_p`, `reference_status`, source summary, source date and date meaning, plus a count and range for competing prices. The first matching rule wins:

   1. **Owner override.** A `reference_price_decisions` row always wins. It is a correction to the automatic rule, not a routine step.
   2. **BBR.** The owner's own purchase, as BBR reports it. If one wine has several BBR prices, through changing snapshots or several case sizes, use the earliest `effective_date`, then the lower per-bottle price. A later reported figure may be a blended average after a top-up purchase.
   3. **CellarTracker.** Used only when BBR has no 75 cl evidence for the wine. It is a transcription of BBR records, so it never outranks or corroborates BBR.
   4. **Earliest dated offer.** The earliest `offer_date`, then the lower per-bottle price.

   The status is `owner`, `automatic` or `automatic, review` (see below). `automatic, 3 competing prices` keeps the benchmark available without claiming certainty. Never label an automatic result `initial` or `release`.
5. For a 75 cl listing, calculate its comparable case reference as the per-bottle reference multiplied by the listing case size. For Favourites and wine-level comparisons, use 75 cl ask and bid prices per bottle. Do not mix in large-format prices scaled to 75 cl: those can carry a premium the owner does not want in this benchmark.

The candidate view is a read model, not a new evidence table. The decision table is the only new durable price state. A decision's positive price and wine are checked on write; it does not need source-row invalidation or a wrong-source-wine check. A later source relink can change corroborating evidence without changing the owner's value. A note can record a specific source document when the owner wants provenance beyond a numeric match.

A 2% band may group near-equal evidence in the detail display, but it does not choose the benchmark: 99 of 113 wine-level conflicts exceed that band after CellarTracker is included. A flagged automatic number retains comparisons and saved-scenario coverage.

Overrides should be rare, so most disagreement is shown, not queued. Offers disagreeing among themselves (83 of the 113 wines) are expected: offers at different dates and case sizes differ. The precedence rule settles them, and the detail view shows the range. Only disagreement within the owner's own purchase evidence calls for a look: changing BBR history (two wines) or CellarTracker more than 1p from the selected earliest BBR price (12 wines). These get the `automatic, review` status. The current review list has 13 wines because one wine meets both conditions. The cause of each discrepancy still needs inspection. The owner can override any wine from its detail view, and clearing the override returns it to the automatic rule. No background adjudication service is needed.

---

## Consumers and wording to change

| Surface | Required change |
| --- | --- |
| Catalogue browser | Continue the bounded, owner-authenticated second read for its page of Parent IDs. Fetch resolved references and conflict status by `parent_sku`. For each 75 cl case row, scale the per-bottle value by its case size. Keep `catalogue_view` public-data-only. Default the owner's browser to 75 cl rows if the owner confirms that separate UX choice. |
| Wine card | Read the one resolved reference for the wine. Show all candidate records with source case size and date meaning. Calculate each 75 cl format's comparison using its own case size. Do not show a reference comparison beside other bottle volumes. |
| Offer review | Keep `/release-prices` as an accepted offer source screen until its navigation is renamed. It is not the unified reference inventory today. Adapt the per-format detail or add a reference detail route for BBR, offers, manual entries and CellarTracker context. |
| Scenarios | Replace the release fields with `reference_price_per_75cl_p`, `ask_vs_reference_pct` and `bid_vs_reference_pct` in the new read model and app. Preview the two affected saved definitions against their current results, then convert their stored field names as part of the cutover. With three saved definitions, retaining two field vocabularies has little benefit. Preserve the old fields only during the deployment transition. |
| Favourites | Keep one row per wine. Compare the per-bottle reference with the lowest 75 cl ask per bottle and highest 75 cl bid per bottle, labelling both as bottle prices. The current `wine_market_summary_mv` mixes bottle volumes before converting them to 75 cl equivalents; its ask and bid fields cannot be reused for this comparison without a 75 cl filter. |
| Bid comparison | Compare a proposed bid and estimated seller net with the reference, but label the result as a comparison with historic evidence. It is not proof of the seller's cost or profit. Replace `recoup bid` wording if this calculation is retained. |

`release_price_anchor_view` and accepted offer records can remain as source-specific history during the transition. New comparison metrics should use the resolved reference, not a mixture of old and new anchors. Avoid a blanket rename of `release_price_p`: an offer amount is still an offer amount in source evidence.

The new views must use `security_invoker = true`, owner-only grants and the existing owner-scoped source policies. The decision table needs its own owner-only policy. The existing `catalogue_view` is also readable by `anon`; joining BBR or CellarTracker purchase prices into it would cross the current privacy boundary. The earlier release-anchor view needed a materialised CTE after repeated evidence scans caused slow queries, so a four-source join must not be assumed cheap.

Phase 8 proposes a `wine_scenario_mv` to collapse the slow scenario view stack, but it is not built yet. Its current draft copies owner price fields into a materialised view, grants that view to all `authenticated` users, and refreshes it after the daily catalogue sweep. A materialised view does not inherit source-table row-level security. The scenario plan needs a privacy review before any owner price enters it, and manual reference decisions or BBR imports need a freshness path beyond the nightly sweep. Options to test locally are an owner-only live reference join over the market scenario materialisation, or an owner-checked query function over a private materialisation with an explicit refresh after relevant writes. Do not commit to the second option until its refresh cost and access boundary are checked. Coordinate this change with Phase 8 before cutting scenarios over.

---

## Delivery sequence and checks

1. In one independently deployable migration, add the per-bottle candidate and resolved views, the wine-level decision table and owner write action, and migrate the four owner entries. Keep old app reads available. Check 75 cl eligibility, case-size division, tax basis, source exclusions, repeated BBR snapshots, CellarTracker corrections, source removal, the 2010 Poujeaux case, and owner-only access on local fixtures.
2. Move the catalogue browser and wine card to the resolved reference. Verify that a 6 × 75 cl source can compare with a 12 × 75 cl listing through per-bottle scaling and that BBR prices do not enter the public catalogue view.
3. Move scenarios and favourites after previewing the two affected saved definitions. Replace release comparison labels and the `recoup bid` claim. Resolve the Phase 8 read path, privacy and refresh questions before scenario cutover. Remove obsolete resolver paths only after all consumers have moved.

Make each database migration independently deployable, apply it separately from the Next.js deployment, and check the remote migration ledger. Supabase's current pricing excludes Branching from the Free plan, and no branch existed at review time. Use local `supabase db start` with a restricted, production-shaped extract of the relevant source and market rows for row-equivalence and query-plan checks. A local machine is much faster than the Nano production instance, so local wall-clock time is not a timing pass: compare `EXPLAIN (ANALYZE, BUFFERS)` plan shape and buffer counts with the existing resolver instead. The existing [data-branch validation policy](PERFORMANCE-DATA-BRANCH-VALIDATION.md) names a branch as its only approved place, so amend that policy explicitly before using the local substitute. Bounded read-only production aggregates and signed-in smoke checks remain separate checks, not substitutes for row-equivalence or timing tests.

## Decisions needed before implementation

Decided on 2 October 2026: the reference is per 75 cl bottle, and other bottle volumes are out of scope. CellarTracker prices are in-bond, transcribed from BBR. Money is whole pence per bottle; a candidate within 1p supports the selected price, and a range over 1p is a conflict. Precedence is owner override, then BBR, then CellarTracker, then earliest offer. Competing prices show a flagged automatic number, not a blank.

Still open:

- Decide whether 75 cl should be the default filter on owner-facing catalogue and scenario screens. Keep other formats in source data; removing them from the database is a separate decision with wider effects.

---

## Reproducible conflict check

This read-only query rounds each candidate to whole pence and counts conflicts at the chosen per-bottle wine grain. A range greater than 1p is a conflict. It does not select an automatic winner or calculate the 13-wine purchase-evidence review list. Run repeat analysis on an approved local production-shaped extract or a data branch; the dated production counts above are a baseline, not a performance test.

```sql
WITH candidates AS (
    SELECT parent_sku,
           round(release_price_p::numeric / split_part(format_code, '-', 1)::numeric)::int AS bottle_p
    FROM public.release_offer_evidence_view
    WHERE release_price_p > 0 AND format_code ~ '^[0-9]+-00750$'
    UNION ALL
    SELECT parent_sku,
           round(purchase_price_per_case_p::numeric / split_part(format_code, '-', 1)::numeric)::int
    FROM public.bbr_position_observations
    WHERE purchase_price_per_case_p > 0 AND format_code ~ '^[0-9]+-00750$'
    UNION ALL
    SELECT parent_sku, purchase_price_per_bottle_p::numeric
    FROM public.current_cellartracker_records
    WHERE parent_sku IS NOT NULL
      AND bottle_volume_ml = 750
      AND purchase_price_per_bottle_p > 0
), by_wine AS (
    SELECT parent_sku, min(bottle_p) AS min_p, max(bottle_p) AS max_p
    FROM candidates
    GROUP BY parent_sku
)
SELECT count(*) AS wines,
       count(*) FILTER (WHERE max_p - min_p > 1) AS competing_price_wines,
       count(*) FILTER (WHERE max_p > min_p * 1.02) AS beyond_2_pct
FROM by_wine;
```
