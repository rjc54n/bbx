# Independent implementation review, 20 August 2026

## Scope

This review covers the 21 commits from 13 to 19 August 2026, from `1547e08` to `eb6f34e`. The change set contains 58 files, 4,613 insertions and 862 deletions. I reviewed the code, migrations, tests, live migration ledger, live database advisers and representative live query plans. I did not alter application code or production data.

The main conclusion is that the work has produced a useful canonical read model around the BBR Parent ID. It keeps source evidence separate and adds owner facts without overwriting imports. That is a sound direction for this application. It is not yet a source-neutral golden record. Two correctness faults should be fixed before treating the derived release-price metrics as dependable across the app.

## Findings by priority

| Priority | Finding | Effect | Recommended response |
|---|---|---|---|
| P1 | Owner release prices do not reach the catalogue | The catalogue can show the imported price after the owner has replaced it | Read `resolved_release_anchor_view` in the catalogue and add a conflicting-source regression test |
| P1 | Tax basis is discarded before price comparisons | Duty-paid or unknown prices are compared with in-bond market prices as if they were equivalent | Restrict v1 owner facts to in-bond, or carry `tax_basis` through every derived view and suppress invalid comparisons |
| P1 | Scenario queries use a costly layered view plus exact counts | Analytics requests take seconds on the live database | Build a lean scenario query surface, remove exact counts from the request path and add a query budget |
| P2 | Page clamping depends on a PostgREST error | An out-of-range scenario URL can show an empty page and an impossible page number | Clamp from the returned count whenever `page > pageCount`, then re-query or redirect |
| P2 | The documentation calls the implemented design a no-code draft | Reviewers cannot tell which steps exist or which parts remain planned | Replace the status line with an implementation ledger and separate design decisions from future work |
| P2 | Approximate counts look exact in the UI | Users may treat estimates as audited totals | Prefix estimates with `About` or `~`, or provide a maintained exact counter where accuracy matters |
| P3 | The wine page assembles seven sources in application code | More request fan-out and another identity-precedence implementation | Keep for now, then move stable precedence rules into one tested read model |

## Correctness findings

### 1. Owner release prices do not reach the catalogue

The owner-anchor migration says the value flows into the catalogue, favourites and wine card. The release-price page repeats that claim. The database migration only repoints `release_price_market_view` and `wine_card_format_view` to `resolved_release_anchor_view`.

The catalogue follows a separate path. [`fetchCatalogue.ts`](../apps/web/src/lib/query/fetchCatalogue.ts) reads `release_price_anchor_view`, which contains imported anchors only. On 20 August, the live database had one owner anchor and one corresponding catalogue mismatch. This is an observed fault, not a theoretical edge case.

Fix:

1. Change catalogue enrichment to `resolved_release_anchor_view`.
2. Return `anchor_status` with the price so the UI can identify an owner value.
3. Add a test where the imported and owner prices differ. Assert that catalogue, wine card, favourites and scenarios all show the owner value.

### 2. Tax basis is accepted, then lost

`owner_release_anchors` accepts `in_bond`, `duty_paid` and `unknown`. `resolved_release_anchor_view` omits `tax_basis`. The downstream views then calculate ask-versus-release, bid-versus-release and recoup values without checking comparability. Only the release-price detail page warns about a non-in-bond owner fact. The catalogue, wine card and scenarios cannot issue the same warning because they do not receive the field.

This can produce numerically correct arithmetic with a false business meaning. A percentage based on prices with different tax treatment should not be ranked beside an in-bond comparison.

The smallest safe fix is to accept only in-bond owner release prices in the current prototype. If all tax bases are needed, carry `tax_basis` through `resolved_release_anchor_view`, `release_price_market_view`, `wine_card_format_view` and `wine_scenario_view`. Set comparison metrics to null unless the basis is known to match.

### 3. Out-of-range scenario pages are not reliably clamped

The scenario page retries only when `runError` is present. A valid range beyond the last row can return an empty array with a count and no error. The page can then display an empty result with a page number greater than the calculated page count.

Clamp after every successful count. The rule should be `page = min(requestedPage, max(pageCount, 1))`. Re-query or redirect when that value changes. Apply the same review to release-price and CellarTracker pagination because those routes use the same error-dependent assumption.

## Assessment of the canonical wine record

The current model is best described as a canonical presentation record for biddable wines:

- `wine_ref = parent:<parent_sku>` gives one stable application reference for BBR-tracked wines.
- `wine_card_view` provides wine-level identity.
- `wine_card_format_view` preserves the per-format price grain.
- release offers, BBR holdings and CellarTracker records remain separate evidence.
- owner release prices are stored as owner facts with their source replacement retained.

These choices avoid destructive consolidation. They also retain enough provenance to explain most displayed values. The views use invoker security and the owner table uses row-level security.

The model does not yet meet the usual meaning of a golden record:

- identity is still anchored to the BBR Parent ID;
- off-catalogue wines have no durable canonical identity;
- source conflicts are not resolved field by field;
- the planned `wine_locals` or equivalent resolver does not exist;
- the wine page still chooses identity fallbacks in TypeScript after seven parallel reads.

That limitation is acceptable if it is explicit. Calling it a complete single wine record would set the wrong expectation for future imports and edits. Keep the current read model, label it accurately, and add source-neutral identity only when an actual off-catalogue workflow requires it.

## UX and UI review

The recent UI work fixes several real operating problems:

- shared pagination gives consistent controls and stable page jumps;
- server-side search and pagination avoid loading full accepted-offer and CellarTracker result sets;
- optimistic match removal and pending states reduce repeated submissions;
- catalogue and favourites now lead to the same wine page;
- the wine status band gives a useful summary before the evidence sections;
- release tasting notes remain visible as source evidence.

The analytics tab is a reasonable prototype, but its controls expose storage details. Price filters are labelled in pence and most enum fields use comma-separated free text. Saved scenarios are unversioned stored filters, not yet named analytical strategies. Mark the route as experimental. Use picker values from the same registry or facet source as the query, label money in pounds, and validate empty enum filters before save.

The app has no route `loading.tsx` files under the protected area. Slow server navigation therefore looks like an unresponsive click until the full server response arrives. This is a major perceived-speed issue and is covered in the separate [performance review](PERFORMANCE-REVIEW-2026-08-20.md).

Approximate record counts should look approximate. The accepted-offer browser currently presents an estimated count as `N accepted offer records`. Use `About N` or `~N` and give exact wording only to exact or maintained counts.

## Implementation size and maintainability

The change set is large for one week, but most of the size is migrations, tests and explicit UI. I did not find a broad abstraction layer that should be removed immediately. The repeated query and identity rules are the main maintenance cost.

The practical simplifications are:

- provide one resolved release-anchor read contract and use it everywhere;
- make one lean scenario read model instead of stacking analytical logic over several general-purpose views;
- cache one owner verification per server render;
- replace whole-table aggregation in the CellarTracker page with an aggregate view or function if the snapshot grows;
- split `WINE-RECORD-SPEC.md` into a short architecture decision and an implementation status table.

Avoid adding a generic fact framework now. The current owner release-price table is easier to secure and test than a polymorphic facts table. Generalise only after a second owner-fact type has concrete query and editing requirements.

## Recommended order

1. Fix owner-anchor propagation and tax-basis handling. Add cross-surface tests.
2. Replace the scenario query path and exact count. Set a measured database budget.
3. Deduplicate owner checks and add protected-route loading states.
4. Fix count wording and page clamping.
5. Update the wine-record specification and web route documentation.
6. Add application CI and clear the current dependency advisories.

## Verification performed

- Python: 280 tests passed.
- Web: 253 tests passed across 27 files.
- ESLint: passed.
- Next.js production build: passed with network access. The sandboxed build failed while fetching Google-hosted Geist fonts.
- Live migration ledger: matched all local migrations through `20260817160000_review_view_release_info`.
- Live database: read-only row counts, advisers, `pg_stat_statements` and representative `EXPLAIN (ANALYZE, BUFFERS)` checks.
- GitHub Actions: the 20 most recent scheduled runs were successful. These runs do not validate web changes on pull requests.
- `git diff --check` for the review range: one trailing-whitespace error in `docs/WINE-RECORD-SPEC.md` line 443.

The checks prove local code health and current database state. They do not prove the behaviour of the deployed signed-in web application because no browser session or deployment check was part of this review.

