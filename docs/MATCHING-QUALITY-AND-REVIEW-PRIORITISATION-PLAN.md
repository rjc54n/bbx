# Matching quality and review prioritisation: epic and implementation plan

**Written:** 6 September 2026.
**Status:** approved, with an implementation candidate completed locally on 6
September 2026. No production migration, match run or application deployment
has been made. The held-out evaluation and performance gates still require a
Supabase development branch; see
[`MATCHING-QUALITY-EVALUATION-2026-09-06.md`](MATCHING-QUALITY-EVALUATION-2026-09-06.md).

**Builds on:**
[`MATCHING-FUNCTIONAL-SPEC.md`](MATCHING-FUNCTIONAL-SPEC.md),
[`MATCHING-QUEUE-TRIAGE-SPEC.md`](MATCHING-QUEUE-TRIAGE-SPEC.md) and
[`MATCHING-RECONCILIATION-SPEC.md`](MATCHING-RECONCILIATION-SPEC.md).

**Motivating example:** release-offer group `2017|ch lynch bages pauillac`
has the correct rank-1 catalogue candidate, Parent ID `20178004817`, but the
candidate sits in the hidden low-coverage tier because `ch` and `chateau` are
different tokens. A normal manual pass over the default queue will not see it.

---

## 1. Problem statement

The matching pipeline can find the correct BBR Parent ID and still make it
unlikely that the owner will review it.

The `/matches` page defaults to `tier=workable`. That removes every unresolved
group whose rank-1 candidate has token coverage below 0.75. The coverage value
is:

```text
cardinality(Algolia matched_words) / token_count(source_match_key)
```

This is search-engine retrieval evidence. It is not the probability that two
records describe the same wine. The numerator and denominator also pass
through different normalisation paths. Abbreviations, extra catalogue
geography and alternative source formatting can therefore push a correct
candidate below the gate.

The practical failure is larger than one missed review:

1. An unresolved release-offer group has no Parent ID.
2. Its valid in-bond prices cannot enter `release_offer_evidence_view`.
3. No `(parent_sku, format_code)` release-price anchor is created.
4. The catalogue, wine card and scenario results show no imported release
   price for the affected format.

The earlier triage work identified the metric defect. Slice 3 in
`20260903190000_match_token_normalisation.sql` tested symmetric token overlap
and improved the labelled-pair result. It was reverted by
`20260903210000_revert_coverage_to_stored_metric.sql` because calculating
regex tokenisation inside the live view increased the measured page query
from about 1.6 seconds to 4.3 seconds. The comparison was better, but the
delivery mechanism was unsuitable for the free-tier production instance.

There are therefore two related problems:

- **matching quality:** abbreviations and source-specific renderings weaken
  exact matching and candidate ranking;
- **work prioritisation:** a weak proxy hides groups instead of ordering all
  available work by match evidence, ambiguity and likely owner value.

Changing 0.75 to another threshold would move the failure boundary. It would
not repair either problem.

---

## 2. Verified baseline and constraints

This section is based on repository code and migrations inspected on 6
September 2026. Production counts quoted from the earlier triage spec are a 3
September snapshot and must be re-measured before implementation.

### 2.1 Current matching path

- Release-offer and CellarTracker groups use separate source adapters and a
  shared catalogue target.
- Algolia `prod_product`, filtered to `family_type:Wines` and normally to the
  source vintage, generates candidates.
- Release offers use `exactParentSkus(...)` for exhaustive exact validation
  and `topHistoricOfferCandidates(...)` for the five stored suggestions.
- `wineCoreTokens(...)` removes accents, punctuation, articles and vintage
  tokens. It does not expand abbreviations.
- `coreKeyScore(...)` is symmetric token-set F1. It does not weight distinctive
  tokens or record disagreements.
- Algolia order breaks score ties.
- Stored `match_score` is a ranking score, not calibrated confidence.
- The two sources expose a common union through
  `wine_match_review_view` and `wine_match_suggestion_view`.
- The review page sorts and paginates in PostgREST. Any primary priority must
  therefore be a server-side field, not a client-only reorder of 50 rows.

### 2.2 Identity and evidence grains

- A matching decision links a source group to a Parent ID.
- Release-price evidence remains specific to
  `(parent_sku, format_code)` after that link.
- A Parent ID link does not prove that every catalogue format has release
  evidence.
- `prod_biddable` is a separate Algolia index, while matching searches the
  wider `prod_product` catalogue. Catalogue presence and current BBX
  eligibility must remain separate facts.

### 2.3 Existing safety rules

- A missing vintage is never exact release-offer evidence.
- Exhaustive validation is required before the current release-offer exact
  path can auto-link.
- CellarTracker uses source-specific producer and ordering logic.
- `second_wine_conflict` is a symmetric confirm-time warning. A full token
  match cannot override it.
- Owner decisions are reversible, and resolution events are retained.
- Matching tables and views are owner-only. Public views use
  `security_invoker` and privileged functions check `private.is_app_owner()`.

### 2.4 Operational constraints

- Regex or token processing must not run thousands of times in the live page
  query.
- Database and application releases are separate. A Vercel deployment does
  not apply a Supabase migration.
- Performance work that needs representative data must use a Supabase data
  branch. Production is not the test environment.
- The implementation must be small enough for one owner and a low-write
  workflow. A general entity-resolution platform is not justified.
- Current Supabase changes concerning extension-version pinning and automatic
  Data API exposure do not change this design. Any new public object still
  needs explicit privileges, RLS where applicable, and a checked API contract.

---

## 3. Epic

### Epic statement

As the owner reviewing imported wine records, I need every unresolved group to
remain discoverable and the most likely useful links to appear first, so that
valid release prices and holding records reach their downstream views without
unsafe bulk linking or hours of low-yield review.

### Outcomes

- No unresolved group disappears because one heuristic falls below a
  threshold.
- Common source variations such as `Ch.` and `Chateau` contribute equivalent
  evidence in the wine-name field.
- Candidate order uses several explainable agreements and disagreements.
- The queue distinguishes likely, ambiguous, weak and legacy evidence.
- Source-specific business impact affects order without changing identity.
- Alias-only matches remain manual in the first release.
- Matching work is precomputed during a run and read cheaply by the page.
- Each match card explains why the candidate was promoted or held back.

### User stories

#### Story 1: see all unresolved work

As the owner, I can open `With suggestions` and know that no group has been
removed by the default coverage filter.

#### Story 2: review likely useful matches first

As the owner, I see a current catalogue candidate with usable source evidence
before a weak nearest-name result that has no current downstream value.

#### Story 3: understand the ranking

As the owner, I can see short reasons such as `same vintage`, `Ch. expanded to
Chateau`, `candidate adds declared geography` and `clear lead over candidate
2` before confirming a group.

#### Story 4: protect against plausible false positives

As the owner, I see second-wine, vintage, producer and close-runner-up warnings
as ambiguity. A high text score does not suppress those warnings.

#### Story 5: verify downstream release evidence

As the owner, after confirming the correct Parent ID, I can see which exact
formats received release-price evidence and which did not.

#### Story 6: improve the matcher safely

As the owner, I can compare the old and new rankings over historical decisions
before the new algorithm changes live suggestions or any automatic link.

---

## 4. Functional design

The following are the recommended product decisions for this epic.

### D1: default to all suggestion evidence

`/matches?state=with-suggestions` must no longer apply `tier=workable` by
default. Every group with suggestions appears unless the owner explicitly
selects a filter.

The existing `tier=workable`, `tier=low` and `tier=all` URLs remain valid as
diagnostic filters during the transition. Token coverage moves out of the
primary workflow and is labelled `Legacy Algolia coverage`.

This is the first independently deployable slice. It prevents further misses
while the matcher work is being built.

### D2: use review bands, not a visibility gate

Each rank-1 suggestion receives one review band:

| Band | Meaning | Behaviour |
| --- | --- | --- |
| `likely` | Strong agreement, adequate lead and no blocking risk flag | Appears early; still needs manual confirmation in this epic |
| `ambiguous` | Useful candidate but a contradiction, missing hard field or small lead | Appears with the reason for caution |
| `weak` | Little positive evidence or a nearest result dominated by disagreement | Appears later; never hidden |
| `legacy` | Suggestion predates algorithm v2 and has not been reassessed | Visible with a `Run matching again` label |

The review band describes match evidence. It does not describe the value of
linking the group.

### D3: keep evidence and impact separate

Each group also receives an impact band through its source adapter:

| Band | Release offers | CellarTracker |
| --- | --- | --- |
| `current_market` | Rank-1 candidate was BBX-eligible at observation and the group has at least one valid in-bond format | Current holding quantity exists and the candidate was BBX-eligible at observation |
| `source_evidence` | Valid source evidence exists but the candidate was not then BBX-eligible | Current holding quantity exists but the candidate was not then BBX-eligible |
| `identity_only` | No usable price format is available | No positive current quantity is available |

This avoids pretending that a release price and a holding quantity have the
same numeric value. The common queue uses coarse bands; the expanded panel
shows the source-specific facts.

Within `With suggestions`, the default order is:

1. `likely` plus `current_market`;
2. `ambiguous` plus `current_market`;
3. `likely` plus `source_evidence`;
4. `ambiguous` plus `source_evidence`;
5. `weak`, `identity_only` and `legacy`;
6. evidence score, score margin, source and `match_group_key` as stable
   tie-breakers within each class.

The exact ordinal is stored as `review_priority`, so PostgREST can sort before
pagination. A card still displays the review and impact bands separately.

### D4: canonicalise by field and source

The shared matcher gains a versioned canonicalisation function:

```text
canonicaliseWineIdentity(value, field, source, rulesVersion)
```

It returns canonical tokens and a list of transformations that fired. Rules
are scoped to a field and source adapter. There is no universal abbreviation
dictionary.

Initial evidence-backed wine-name rules are:

```text
ch.  -> chateau
ch   -> chateau
dom. -> domaine
dom  -> domaine
```

Rules use whole-token boundaries. `ch` inside another word must not expand.
`st` is not included until the challenge set separates `Saint`, `St` as a
literal name component and other uses. Every later alias requires a fixture
showing the positive case and at least one boundary or ambiguity case.

The canonicaliser also retains the current accent, punctuation, vintage and
stopword handling. Candidate-declared trailing geography is removed as it is
today. Producer terms remain because removing `chateau` would collapse
`Chateau Margaux` towards the Margaux appellation.

The canonicaliser does **not** replace either generated `match_group_key`
normaliser. Changing those keys would re-key source groups and orphan stored
suggestions or decisions.

### D5: generate candidates through bounded query variants

Candidate generation uses a bounded union:

1. The existing source query.
2. An alias-expanded query only when canonicalisation changes searchable
   terms and the first pass does not already produce adequate evidence.
3. Existing CellarTracker producer-aware query variants remain
   source-specific.

Results are deduplicated by Parent ID before scoring. The vintage facet and
`family_type:Wines` remain hard retrieval constraints where vintage exists.

No initial group issues more than two candidate-generation queries. Requests
still honour `MAX_QUERIES_PER_REQUEST = 50`. The exhaustive release-offer
validation pass remains separate and unchanged for automatic linking.

Algolia synonyms may be tested as a future retrieval aid, but the first
implementation keeps aliases in version-controlled application code. A search
configuration change outside the repository would be harder to audit and
rollback.

### D6: compare several pieces of evidence

For every candidate, algorithm v2 records:

- vintage agreement, disagreement or absence;
- canonical exact-name agreement after permitted geography removal;
- source-token coverage;
- candidate-token coverage;
- symmetric token F1;
- source-specific producer agreement where available;
- Algolia typo count and original rank as retrieval evidence;
- second-wine and other explicit risk flags;
- the difference between rank 1 and rank 2 after v2 scoring;
- short, deterministic display reasons.

The v2 evidence score is deterministic and lies between 0 and 1. Named
constants define its weights. Thresholds for `likely` and `ambiguous` are set
after the baseline evaluation in Slice 0, then committed with the evaluation
record. They are not inferred from the old 0.75 coverage boundary.

Hard rules override the score:

- a known vintage disagreement cannot be `likely`;
- a missing release-offer vintage cannot be `likely`;
- `second_wine_conflict = true` forces `ambiguous`;
- an alias-only equivalence can be `likely` for review but cannot auto-link in
  this epic;
- a small top-versus-runner-up margin forces `ambiguous` even if the top score
  is high.

Token-set subset equality is not sufficient. A candidate that contains every
source token plus a distinguishing cuvee or second-wine phrase must be
penalised or flagged, not treated as a perfect match.

### D7: explain the result on the card

The rank-1 candidate shows:

- review band and impact band;
- current or observation-time BBX eligibility, labelled accurately;
- evidence score and margin to candidate 2;
- up to four positive reasons;
- every risk flag;
- release-offer valid in-bond fragment and distinct-format counts, or
  CellarTracker quantity;
- legacy coverage only in an expandable diagnostic area.

The confirm control is unchanged. A conflict warning stays adjacent to the
control. The manual catalogue search remains available for all bands.

### D8: keep automatic linking unchanged

Algorithm v2 changes candidate retrieval, ranking and review order. It does
not widen release-offer or CellarTracker automatic-link eligibility.

A later proposal may allow canonical alias equality to auto-link, but only
after a separate review of false positives, exhaustive-search behaviour and
the required precision. That decision is outside this epic.

---

## 5. Scope

### In scope

- Release-offer and CellarTracker candidate generation and ranking.
- Shared field-aware canonicalisation with source adapters.
- Stored, versioned match evidence.
- Review bands, impact bands and server-side priority.
- The `/matches` default, filters, sort and explanation UI.
- Historical-decision evaluation and challenge fixtures.
- Database migrations, generated types, pgTAP, Vitest and performance checks.
- End-to-end verification that a confirmed release match reaches only the
  supported catalogue formats, wine card and scenarios.

### Out of scope

- A generic matcher for people, companies, addresses or arbitrary products.
  Research from those categories informs the method, not the product scope.
- Re-keying `match_group_key` or changing accepted source-row identity.
- Automatically linking alias-only or probabilistic matches.
- Bulk confirmation or bulk `No suitable match` actions.
- Replacing Algolia with `pg_trgm`, a vector model or an external matching
  service.
- Installing Splink, Dedupe or RapidFuzz as production dependencies.
- Building a continuously trained model.
- Changing release-price selection, anchor precedence or scenario formulae.
- Solving the separate new-listing reconciliation feature in
  `MATCHING-RECONCILIATION-SPEC.md`.
- Treating Parent ID identity as format evidence.

### Upper boundary

The largest acceptable implementation is a deterministic, versioned v2
matcher with source adapters, stored comparison evidence, a prioritised review
surface and evaluation tooling. If implementation requires a new generic
entity table, background model training, embeddings or a separate matching
service, stop and return to design review.

### Lower boundary

The minimum useful release is:

1. remove the default low-coverage exclusion;
2. expand `ch` to `chateau` in a versioned wine-name canonicaliser;
3. store the resulting v2 score, margin, review band and reasons at match time;
4. sort all suggestions by review priority;
5. prove the Lynch-Bages fixture and downstream release-price path.

### Path boundaries

Expected implementation paths:

```text
apps/web/src/lib/wine/
apps/web/src/lib/releaseOffers/algoliaMatching.ts
apps/web/src/lib/releaseOffers/algoliaServer.ts
apps/web/src/lib/cellar/cellartrackerMatching.ts
apps/web/src/lib/matching/
apps/web/src/app/(protected)/matches/
apps/web/src/components/matching/
apps/web/src/lib/database.types.ts
supabase/migrations/
supabase/tests/database/
docs/
```

The implementation may add focused fixtures beside the matching tests.

It must not change scenario formulae, release-anchor precedence, catalogue
price calculations, import raw-row contracts or BBR holding identity. A needed
change outside the expected paths stops the slice for design review unless it
is a test proving the downstream contract.

---

## 6. Technical design

### 6.1 Application modules

Refactor shared identity work under `apps/web/src/lib/wine/`:

```text
identityCanonicaliser.ts
identityEvidence.ts
identityRanking.ts
identityTypes.ts
```

Source adapters remain in:

```text
apps/web/src/lib/releaseOffers/algoliaMatching.ts
apps/web/src/lib/cellar/cellartrackerMatching.ts
```

The shared modules know how to canonicalise and compare prepared fields. They
do not decide which CellarTracker producer field or release-offer geography
segment is authoritative. Each source adapter prepares that input.

Suggested contracts:

```ts
type CanonicalIdentity = {
  tokens: string[];
  normalisedText: string;
  transformations: string[];
};

type CandidateEvidence = {
  algorithmVersion: string;
  evidenceScore: number;
  reviewBand: "likely" | "ambiguous" | "weak";
  sourceCoverage: number;
  candidateCoverage: number;
  tokenF1: number;
  canonicalExact: boolean;
  scoreMargin: number | null;
  riskFlags: string[];
  reasons: string[];
  components: Record<string, number | boolean | string | null>;
};
```

The arrays are sorted and deduplicated before persistence. Reason codes are
stable identifiers mapped to display copy in the UI. They are not free-form
model output.

### 6.2 Candidate ranking

Candidate ranking runs in two phases:

1. Prepare and score every unique Parent ID returned by the bounded retrieval
   passes.
2. Sort by hard-risk class, evidence score, original Algolia order and Parent
   ID. Calculate the rank-1 margin against the resulting runner-up.

The scoring function must accept its weights as an explicit versioned
configuration. A change to aliases, weights, thresholds or risk rules changes
`algorithm_version`.

Term-frequency weighting is deferred from the first implementation. It is a
sound record-linkage technique, but maintaining catalogue-wide token
frequencies would add another derived dataset. Add it only if the v2 evaluation
shows common tokens still dominate real errors. Algolia already supplies typo
tolerance, so `pg_trgm` is also a measured fallback rather than a default
dependency.

### 6.3 Stored suggestion evidence

Add nullable v2 columns to both
`public.release_offer_match_suggestions` and
`public.cellartracker_match_suggestions`:

| Column | Type | Purpose |
| --- | --- | --- |
| `algorithm_version` | `TEXT` | Exact canonicalisation and scoring version |
| `evidence_score` | `NUMERIC(5,4)` | Stored v2 comparison score, 0 to 1 |
| `score_margin` | `NUMERIC(5,4)` | Rank-1 lead; null on non-rank-1 or no runner-up |
| `review_band` | `TEXT` | `likely`, `ambiguous` or `weak`; null means legacy |
| `review_priority` | `SMALLINT` | Server-side queue order, bounded by a check |
| `impact_band` | `TEXT` | `current_market`, `source_evidence` or `identity_only` |
| `risk_flags` | `TEXT[]` | Stable machine-readable warning codes |
| `match_reasons` | `TEXT[]` | Stable positive reason codes |
| `comparison_evidence` | `JSONB` | Remaining typed score components for evaluation and display |

The existing `match_score`, `matched_words`, `typo_count` and Algolia rank are
retained. They remain useful provenance and support old suggestions.

Constraints require:

- scores and margins between 0 and 1;
- the documented enum values;
- `comparison_evidence` to be a JSON object when present;
- `score_margin` only on rank 1;
- non-null arrays with empty-array defaults.

Do not backfill v2 values by guessing from the old columns. Existing rows show
as `legacy` until a supervised rerun replaces their suggestions.

### 6.4 Source impact inputs

Extend match-run group preparation so source impact is calculated once:

- release offers: count valid in-bond price fragments and distinct non-null
  `format_code` values among accepted, non-excluded rows in the group;
- CellarTracker: sum the accepted snapshot's positive quantity for the group.

The recording RPC combines these stored group facts with each candidate's
`was_biddable_at_observation` to assign `impact_band` and `review_priority`.
This keeps regex, tokenisation and price-fragment aggregation out of page
reads.

Observation-time eligibility is used for stable stored priority. The card also
shows current eligibility from `catalogue_view`. A later catalogue transition
does not silently rewrite matching evidence; rerunning matching or the Part B
reconciliation feature is the refresh mechanism.

### 6.5 Database views

Append the common v2 fields to the per-source suggestion views and
`wine_match_suggestion_view` using explicit column lists.

Append the rank-1 fields to both per-source review views and
`wine_match_review_view`:

```text
algorithm_version
evidence_score
score_margin
review_band
review_priority
impact_band
risk_flags
match_reasons
top_candidate_parent_sku
top_candidate_was_biddable_at_observation
```

Legacy rows are presented as `review_band = 'legacy'` and a low-priority
ordinal. No token function or JSON traversal is permitted in the list filter
or sort path.

`wine_match_queue_summary` gains counts for `likely`, `ambiguous`, `weak` and
`legacy`. Its `RETURNS TABLE` change requires `DROP FUNCTION` then `CREATE
FUNCTION`, followed by the existing explicit revoke and owner grant.

All views remain `WITH (security_invoker = TRUE)`. No new `SECURITY DEFINER`
read wrapper is needed.

### 6.6 Indexes

Create a partial composite index on each suggestion table for rank-1 queue
reads:

```sql
CREATE INDEX ...
ON public.<source>_match_suggestions
    (review_priority, evidence_score DESC, match_group_key)
WHERE rank = 1;
```

Confirm the final column order against the actual generated query using
`EXPLAIN (ANALYZE, BUFFERS)` on a data branch. Do not add indexes merely
because columns exist. If the planner cannot use the index through the current
view stack, measure a small maintained priority projection before accepting a
slower page.

### 6.7 RPC contracts and validation

Both result-recording RPCs accept the new candidate fields. They must reject:

- more than five stored candidates;
- unknown review or impact bands;
- scores outside 0 to 1;
- malformed `comparison_evidence`;
- non-rank-1 margins;
- unknown reason or risk codes if a database allowlist is adopted.

The database recalculates or validates `review_priority` from the submitted
bands. It must not trust an arbitrary client ordinal.

The RPCs remain owner-gated and idempotent at the existing run-group boundary.
A retry after a processed group returns the existing processed result. An
ambiguous transport failure is checked against server state before any retry,
as required by `AGENTS.md`.

### 6.8 Page query and URL contract

Extract state, review-band, tier and sort parsing from the server component to
a testable query module.

New query parameter:

```text
review=all|likely|ambiguous|weak|legacy
```

Default is `all`. The default sort is stored `review_priority`, then
`evidence_score DESC`, `score_margin DESC`, `source`, `match_group_key`.

Explicit legacy `tier` parameters continue to work. An absent `tier` means all
tiers. Invalid `review`, `tier` and `sort` values fall back to the documented
defaults and are never interpolated into database identifiers or RPC names.

### 6.9 Downstream contract

No release-price view changes are required. The end-to-end contract remains:

```text
confirmed release-offer group
  -> release_offer_product_resolutions at Parent ID grain
  -> valid in-bond release_offer_prices
  -> release_offer_evidence_view at Parent ID plus format grain
  -> release_price_anchor_view
  -> catalogue, wine card and scenario projections
```

Tests must show that a valid 6x75cl price does not populate a 1x150cl format
unless independent evidence exists for that format.

---

## 7. Delivery plan

Each slice is independently deployable. Database migrations are applied and
verified separately from application deployment.

### Slice 0: evaluation baseline and challenge set

No product or schema change.

- Export a bounded, non-sensitive evaluation dataset from historical owner
  decisions on a data branch or through read-only local fixtures.
- Treat the confirmed Parent ID as the positive candidate within a linked
  group and the other stored candidates as negatives.
- Treat candidates from a `No suitable match` group as negatives only where
  the decision is still semantically valid.
- Split by group, not by candidate, into a development set and a held-out set.
- Add a reviewed challenge set for abbreviations, extra geography, producer
  order, typos, second wines, missing vintage and close candidates.
- Record current top-1, top-5, low-tier false-negative and review-page latency
  baselines in a dated Markdown report.
- Commit proposed v2 weights and thresholds only after this report exists.

Gate: the dataset and classification rules are reviewable, and the 2017
Lynch-Bages case is represented without relying on production-only state.

### Slice 1: remove the default coverage exclusion

Application-only, no migration.

- Change the absent-tier default from `workable` to `all`.
- Keep explicit legacy tier filters.
- Update copy so coverage is a diagnostic, not a recommendation that the low
  band is probably unmatchable.
- Add URL and default-query tests.

Gate: every unresolved group with suggestions is reachable in the default
result set and pagination count.

### Slice 2: canonicaliser and v2 comparator in shadow code

Application-only and not yet called by live recording.

- Add shared canonicalisation, evidence and ranking modules.
- Add source-adapter preparation.
- Add original and alias-expanded query planning with the two-query cap.
- Run both old and v2 ranking in fixtures and the Slice 0 evaluation harness.
- Produce a dated comparison report covering promotions and regressions.

Gate: owner approves the chosen aliases, risk rules, thresholds and observed
ranking changes. No live candidate or resolution has changed.

### Slice 3: additive persistence migration

Database-only.

- Create the migration with `supabase migration new`.
- Add nullable v2 columns, constraints and rank-1 partial indexes.
- Extend run-group impact inputs.
- Append view columns and summary counts.
- Update pgTAP permission and data-contract tests.
- Regenerate `database.types.ts` after the migration is applied locally.

Release order:

1. reset and test the local database without seed data;
2. run pgTAP and advisers;
3. validate query plans and latency on a data branch;
4. merge the additive migration while the old app remains compatible;
5. run `supabase migration list --linked`;
6. apply this one migration with `supabase db push --linked` outside the
   02:00 to 05:00 UTC protected window;
7. verify the remote ledger and cheap read-only smoke queries.

Gate: old application behaviour remains intact and all new fields are nullable
or have safe defaults.

### Slice 4: write v2 evidence

Application plus RPC replacement, dependent on Slice 3 being live.

- Send and validate v2 candidate evidence.
- Calculate source impact and priority during result recording.
- Preserve old exact auto-link inputs and decisions unchanged.
- Add idempotency, malformed-payload and partial-run tests.
- Deploy the app.
- Run one supervised, bounded match batch and inspect stored evidence before a
  full rerun.

Gate: alias-only equality affects suggestions and review bands but never
increments an automatic-link count.

### Slice 5: prioritised queue and explanation UI

- Add review-band filters and priority ordering.
- Display impact, score margin, reasons and risks.
- Label old rows as legacy.
- Keep manual search and all existing decision controls.
- Add page-query, component and accessibility tests.
- Run the full supervised rematch only after the bounded batch is accepted.

Gate: the 2017 Lynch-Bages group appears in the default first-priority band
after rerun, with Parent ID `20178004817` at rank 1 and an explanation of the
abbreviation and geography handling.

### Slice 6: downstream and performance release gate

- Confirm a fixture group through the real RPC path.
- Assert format-specific release evidence, anchor, catalogue, wine-card and
  scenario outputs.
- Compare first-page and summary-query latency with the Slice 0 baseline on a
  data branch.
- Review `EXPLAIN (ANALYZE, BUFFERS)` for filter and sort behaviour.
- Run lint, Vitest, build, database tests and advisers.
- Perform a code review focused on state transitions, false positives,
  permissions, retry behaviour and deployment ordering.

Gate: all ACs in §9 pass. Any proposed automatic-link expansion is a new plan,
not a close-out task for this epic.

---

## 8. Testing strategy

### 8.1 Canonicalisation fixtures

Positive cases:

- `2017 Ch. Lynch-Bages` and `2017 Chateau Lynch-Bages` produce equivalent
  wine-name tokens.
- Accented and unaccented `Chateau` forms are equivalent.
- Candidate-declared trailing `Pauillac, Bordeaux` can be removed without
  deleting the first name segment.
- `Dom.` and `Domaine` are equivalent as whole wine-name tokens.

Negative cases:

- `ch` inside another word is not expanded.
- A country segment that is not the candidate's declared country is retained.
- A geographic term inside the identity-bearing first segment is retained.
- `Chateau Margaux` does not reduce to `Margaux`.
- A second-wine phrase is not removed as a stopword or geography.

### 8.2 Ranking challenge cases

- `2017 Ch. Lynch-Bages` ranks Parent ID `20178004817` first and is `likely`.
- `2011 Ch. Brane-Cantenac` is not demoted solely because of `Ch.`.
- `2025 Chateau Margaux` against `Pavillon Blanc du Chateau Margaux` is
  `ambiguous` with a second-wine risk.
- `Petit Mouton` against `Le Petit Mouton de Mouton Rothschild` is not falsely
  marked as a second-wine disagreement when the marker is present on both
  sides.
- A candidate containing all source tokens plus a conflicting cuvee term is
  not scored as exact.
- Two close same-producer candidates produce an ambiguous small-margin result.
- A known vintage disagreement cannot rank as likely.

### 8.3 Retrieval tests

- Alias expansion issues no second query when it changes nothing.
- A second query is conditional and the candidate union is deduplicated by
  Parent ID.
- No group issues more than two candidate-generation queries.
- Multi-query requests remain capped at 50.
- A failed optional query preserves valid candidates from the successful
  query but records degraded retrieval evidence.
- Exact validation failure cannot create auto-link evidence.

### 8.4 Database tests

- Score, margin, band, JSON-object and rank constraints reject invalid rows.
- Legacy rows remain readable with null v2 evidence.
- Both source branches expose the same common v2 projection.
- Review-band counts reconcile to the applicable suggestion backlog.
- The default queue contains low legacy-coverage groups.
- Non-owner authenticated and anonymous callers gain no new read or execute
  capability.
- Result-recording retries remain idempotent.
- Source impact counts exclude rejected imports and excluded rows.

### 8.5 Downstream tests

- Confirming the correct release-offer group creates resolutions only for its
  unresolved source rows.
- Only valid in-bond fragments with a usable `format_code` reach release
  evidence.
- Release evidence joins the confirmed Parent ID and the matching format.
- Catalogue and wine-card release prices appear for supported formats.
- Scenario results receive the same format-specific release price.
- Other formats for the same Parent ID remain null without their own evidence.
- Unlinking removes the derived source anchor through the existing view path.

### 8.6 Performance tests

Measure the exact query shapes used by `/matches`:

- first page, default source and state;
- release-offer-only likely filter;
- ambiguous filter;
- exact pagination count;
- `wine_match_queue_summary`;
- source-wine search.

The hard release gate is that p95 for each changed query is no more than 1.25
times its Slice 0 data-branch baseline, unless the owner explicitly accepts a
measured exception. Regex, array tokenisation and JSON evidence extraction may
not appear in the page sort or filter plan.

---

## 9. Acceptance criteria

### AC-1: no unresolved suggestion is hidden by default

- Positive test: opening `/matches?state=with-suggestions` without `tier`
  includes groups from every legacy coverage tier.
- Positive test: exact count and pagination describe the same unfiltered set.
- Negative test: an invalid tier parameter cannot exclude records.

### AC-2: field-aware aliases handle the motivating failure

- Positive test: `Ch.` and `Chateau` are equivalent in a wine-name field.
- Positive test: 2017 Lynch-Bages ranks Parent ID `20178004817` first and is
  reviewable from the default queue.
- Negative test: alias replacement does not fire inside longer tokens or in an
  unapproved field.

### AC-3: candidate generation is bounded and recoverable

- Positive test: original and changed canonical query results are unioned and
  deduplicated.
- Positive test: one optional-query failure retains the successful result and
  marks degraded evidence.
- Negative test: no initial group exceeds two candidate queries or bypasses
  the 50-query request cap.

### AC-4: ranking records balanced evidence

- Positive test: each v2 suggestion stores its algorithm version, score,
  component evidence, reasons and risks.
- Positive test: rank 1 records its margin when a runner-up exists.
- Negative test: one-directional token containment alone cannot produce
  canonical equality.

### AC-5: contradictions control the review band

- Positive test: same-vintage canonical agreement with a sufficient margin
  and no risks can be `likely`.
- Positive test: second-wine disagreement and small margin force
  `ambiguous`.
- Negative test: a high evidence score cannot override a hard conflict or
  known vintage disagreement.

### AC-6: priority combines evidence with source value

- Positive test: a likely release match with current catalogue eligibility and
  at least one valid in-bond format precedes a weak nearest-name result.
- Positive test: release and CellarTracker panels show their own impact facts.
- Negative test: impact cannot change the Parent ID decision or suppress a
  risk flag.

### AC-7: every result is explainable

- Positive test: the card shows deterministic reason and risk labels matching
  stored codes.
- Positive test: legacy suggestions are labelled and remain actionable.
- Negative test: the UI does not call `match_score`, `token_coverage` or
  `evidence_score` a probability or confidence unless it is calibrated as one
  in a later design.

### AC-8: automatic linking is not widened

- Positive test: the existing exhaustive exact path still auto-links the same
  fixtures as before.
- Negative test: alias-only equality, a high v2 score or a likely band cannot
  create a resolution automatically.
- Negative test: validation-search failure cannot auto-link.

### AC-9: release-price propagation remains format-specific

- Positive test: confirming the Lynch-Bages Parent ID makes valid release
  evidence available to the catalogue, wine card and scenarios for each
  supported format.
- Negative test: a release record for one format does not populate a sibling
  format under the same Parent ID.

### AC-10: historical evaluation shows no ranking regression

- Positive test: held-out top-1 and top-5 recovery of the owner-confirmed
  Parent ID are reported for old and v2 algorithms.
- Positive test: v2 top-1 and top-5 results are no worse than the old algorithm
  on the held-out set, and every changed rank in the challenge set is reviewed.
- Negative test: thresholds are not selected from the held-out results and
  then reported as independent validation.

### AC-11: database access remains owner-only

- Positive test: the owner can read v2 evidence and call the existing match
  functions.
- Negative test: `anon` and a non-owner authenticated user cannot read new
  evidence or execute privileged record functions.
- Negative test: no new public `SECURITY DEFINER` function is callable through
  default `PUBLIC` execute privilege.

### AC-12: page performance stays within the measured budget

- Positive test: all changed data-branch p95 query times are at or below 1.25
  times their Slice 0 baselines.
- Positive test: plans use stored scalar priority fields rather than per-read
  canonicalisation.
- Negative test: no heavy performance verification is run against production.

### AC-13: deployment is independently verifiable

- Positive test: the additive schema can run while the old app is deployed.
- Positive test: local reset, pgTAP, Vitest, lint, build and advisers pass.
- Positive test: the linked migration ledger confirms the migration before
  the dependent app release is treated as shipped.
- Negative test: merge status or a green Vercel deployment is not accepted as
  proof that the database change is live.

---

## 10. Risks and controls

| Risk | Control |
| --- | --- |
| Alias expands an ambiguous token | Field-scoped whole-token rules, positive and negative fixtures, version every rule change |
| Better recall promotes a second wine | Symmetric marker conflict, candidate-side coverage, explicit risk override |
| One high score hides a close alternative | Persist and display top-versus-runner-up margin |
| Review score is mistaken for probability | Call it evidence score; no confidence wording or auto-link use |
| New computation repeats the reverted 4.3 s query | Compute during matching, store scalar sort fields, data-branch performance gate |
| Added Algolia passes exceed request limits | Conditional second query, two-query maximum, existing 50-query chunking |
| Existing suggestions have fabricated v2 evidence | Nullable additive columns and explicit legacy band; rerun to replace |
| Priority becomes stale when catalogue state changes | Label observation-time eligibility, show current eligibility separately, rerun or Part B refresh |
| Parent-level match is treated as format evidence | End-to-end negative tests for unsupported sibling formats |
| Migration and app deploy out of order | Additive schema first, verify linked ledger, dependent app second |

Rollback is deliberately simple:

- Slice 1 can restore the old default query parameter, although doing so would
  restore the known visibility defect.
- V2 writes can be disabled while nullable columns and legacy reads remain.
- Queue ordering can fall back to the existing stable queue order.
- Existing resolutions and release-price evidence are not rewritten by this
  epic, so matcher rollback does not require data reversal.

---

## 11. Research basis

The design applies methods used beyond wine-name matching while keeping the
implementation specific to BBX:

- [Name Variants for Improving Entity Discovery and Linking](https://drops.dagstuhl.de/entities/document/10.4230/OASIcs.LDK.2019.14)
  explains why abbreviations, aliases and partial matches need entity-type
  rules plus ambiguity handling.
- [Attribute Extraction from Product Titles in eCommerce](https://arxiv.org/abs/1608.04670)
  combines curated normalisation with structured product attributes rather
  than relying on raw title similarity.
- [Splink's Fellegi-Sunter guide](https://moj-analytical-services.github.io/splink/topic_guides/theory/fellegi_sunter.html)
  describes combining several agreements and disagreements into one record
  linkage weight.
- [Splink term-frequency adjustments](https://moj-analytical-services.github.io/splink/topic_guides/comparisons/term-frequency.html)
  explains why common values should contribute less evidence than uncommon
  values. This is deferred until BBX data shows it is needed.
- [RapidFuzz token-set documentation](https://rapidfuzz.github.io/RapidFuzz/Usage/fuzz.html)
  documents that a subset can score 100, which is unsafe for cuvees and second
  wines without contradiction rules.
- [PostgreSQL `pg_trgm`](https://www.postgresql.org/docs/17/pgtrgm.html)
  provides indexed character-trigram similarity. It remains a fallback because
  Algolia already supplies typo-tolerant retrieval.
- [Dedupe active-learning documentation](https://docs.dedupe.io/_/downloads/en/latest/pdf/)
  selects uncertain pairs for labelling. BBX keeps operational priority and
  model-learning priority separate, since the owner first needs useful missed
  links rather than the pairs most informative to a classifier.
- [Algolia synonyms](https://www.algolia.com/doc/guides/managing-results/optimize-search-results/adding-synonyms)
  can improve query recall. Repository-owned query variants are preferred for
  the first release because they carry an explicit algorithm version and
  rollback path.

These sources support a staged record-linkage pipeline. They do not justify
adding an ML platform or replacing the current source-specific identity rules.

Implementation names must describe the domain contract. Production code and
database objects must not contain plan terms such as `slice`, `AC-1` or
`challenge case`.
