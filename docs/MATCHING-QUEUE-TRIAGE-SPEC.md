# Matching queue triage — coverage tiering and second-wine conflicts

Written 3 September 2026. Status: **both slices implemented; both migrations
applied to production on 3 September 2026 and verified against the live queue.
The web app change is committed but not yet deployed.** Scope is the
`/matches` review queue only.

Implemented in `supabase/migrations/20260903170000_match_second_wine_conflict.sql`
(Slice 1) and `20260903180000_match_coverage_tier.sql` (Slice 2), with the
`/matches` page and `MatchGroupList` updated to match. §3.3's marker decision
was revised during implementation — see the note there.

Follows the handoff in `/tmp/bbx-handoff-matching-queue-2026-09-03.md`. That
document proposed two changes; this spec keeps both, but the shape of each
changed once the proposals were measured against the live data. The
measurements are in §2 and the three findings that moved the design are in §3.
Read §3 before §4 — two of the three reverse a decision the handoff had
already made.

## 1. Problem

After the three data repairs of 3 September and the owner's re-run, the queue
holds **1,612 unresolved groups, 1,513 of them with a rank-1 suggestion**
(measured at the end of the session; see the drift note in §2). The
owner's judgement is that most of that is noise rather than work, and the
sampling in the handoff supports it: 0 of 8 sampled from the lowest-coverage
band were correct.

Two goals, in priority order:

1. **Do not let a wrong confirm poison a price anchor.** `release_price_anchor_view`
   anchors on the earliest offer per `(parent_sku, format_code)`
   (`20260726162524_release_offer_pricing.sql`, ~line 776), so linking a second
   wine's offer to the grand vin's SKU corrupts that wine's anchor from the
   earliest offer forward. Les Forts de Latour trades at roughly a fifth of
   Château Latour.
2. **Shrink the queue the owner actually has to look at**, without writing
   anything irreversible to resolution state.

## 2. What was measured

All figures from the live database on 3 September 2026, read-only, scoped to
`release_offer` groups with `unresolved_row_count > 0` and a rank-1 suggestion.

Coverage is `cardinality(matched_words) / token_count(source_match_key)`, as
the handoff defined it. `source_match_key` is the space-normalised token string
from `private.release_wine_match_key(name, vintage)`, which **strips the
vintage**; `matched_words` comes from Algolia and **includes** it.

| Tier (coverage of rank-1 candidate) | Unresolved groups | of which second-wine conflicts |
| --- | --- | --- |
| `full` — cover ≥ 1.00, `typo_count = 0` | 389 | 1 |
| `full_with_typos` — cover ≥ 1.00, typos | 19 | 0 |
| `partial` — 0.75 – 0.99 | 300 | 4 |
| `low` — under 0.75 | 805 | 14 |
| `none` — no rank-1 candidate | 99 | 0 |
| **Total unresolved** | **1,612** | **19** |

This reproduces the handoff's shape (421 / 19 / 327 / 802). The absolute
numbers moved during the session — an earlier pass the same afternoon measured
416 / 19 / 326 / 817 over 1,578 groups with a candidate, against 1,513 by the
end — because the owner and a concurrent session were working the queue while
this was being written. **Treat every count here as a dated snapshot, not an
invariant**; the tier *boundaries* are what the implementation fixes.

The tiering discriminates, and it is computable entirely from stored columns —
**no re-matching required**, as claimed.

Note the last column: 5 of the 19 conflicts sit in `full` and `partial`, the
tiers Slice 2 keeps visible. Coverage does not subsume the conflict rule.

## 3. Three findings that change the proposals

### 3.1 The coverage metric is inflated by exactly one token, and that is load-bearing

The numerator counts the vintage; the denominator does not. **1,561 of 1,578
groups are inflated, by an average of 1.022 tokens.** Correcting it — counting
only matched words that actually appear in `source_match_key` — collapses the
top tier from 416 groups to 84.

The obvious conclusion is that the metric is buggy and should be corrected.
**That conclusion is wrong.** A 12-group sample of the band that moves
(corrected < 0.75 but raw ≥ 0.75) contains at least four plainly correct
matches that the correction would bury:

| Source | Rank-1 candidate | Raw | Corrected |
| --- | --- | --- | --- |
| 2011 Ch. Brane-Cantenac, Margaux | 2011 Château Brane-Cantenac, Margaux | 0.75 | 0.50 |
| 2010 Ch. Montrose, St Estephe | 2010 Château Montrose, St Estèphe | 0.75 | 0.50 |
| 2017 Ch. Brane-Cantenac, Margaux | 2017 Château Brane-Cantenac, Margaux | 0.75 | 0.50 |
| 2011 Barolo Cascina Francia, Giacomo Conterno | 2011 Barolo, Francia, Giacomo Conterno | 0.80 | 0.60 |

The cause is that `ch` and `château` are different tokens, so every abbreviated
Bordeaux source loses a token it should keep. The vintage inflation was
silently compensating for that gap. Two defects roughly cancelling is not a
good state, but the raw metric is the better-calibrated of the two available
today, and it is the one the handoff's 7-of-8 sample actually validated.

**Decision: keep the raw metric as specified, and record why.** The real fix is
token normalisation (`ch` → `chateau`, a stopword list), which changes match
behaviour rather than queue presentation and is out of scope here. Noted as
follow-up work in §7.

### 3.2 Second-wine demotion cannot promote a correct candidate, because there isn't one

Matching the eight proposed markers on **token boundaries** finds 20 groups
whose source name carries one. Of those:

- **7** already have a rank-1 candidate that carries the same marker — correct
  matches, which the rule correctly leaves alone.
- **3** have no candidates at all, so there is nothing to rank.
- **10** have five candidates of which **none** carries the marker.

In all 10 real conflicts, `candidates_carrying_marker = 0`. Demoting rank 1
therefore promotes the second-wrongest answer; it does not surface a right one.
BBR simply does not stock these wines in the catalogue the matcher searched.

**Decision: this is a suppression signal, not a ranking signal.** The rule
should mark the group as *no candidate carries the source's second-wine
marker* — a `no_suitable_match` recommendation and a confirm-time guard —
rather than reordering five wrong answers.

Boundary matching also matters: a naive `LIKE '%la croix de%'` additionally
flags `2010 Moulin à Vent, La Croix des Vérillats` (via "la croix de**s**"),
which the boundary form correctly excludes.

### 3.3 The dangerous direction is the reverse one, and it sits in the top tier

The proposed rule only covers *source has marker, candidate lacks it*. The
opposite — **source is the grand vin, candidate is the second wine** — is the
one that poisons a First Growth anchor, and it is not covered. Eight groups
match it, including the two highest-coverage rows in the whole hazard set:

| Source | Rank-1 candidate | Coverage | Correct? |
| --- | --- | --- | --- |
| 2011 Petit Mouton, Pauillac | 2011 Le Petit Mouton de Mouton Rothschild | 1.33 | **yes** |
| 2025 Château Margaux | 2025 Pavillon Blanc du Château Margaux | 1.00 | no |
| 2025 Ch. Mouton-Rothschild, Pauillac | 2025 Le Petit Mouton de Mouton Rothschild | 0.50 | no |
| 2025 Château Brane-Cantenac, Margaux | 2025 Pavillon Blanc du Château Margaux | 0.50 | no |

`2025 Château Margaux → Pavillon Blanc du Château Margaux` has full coverage
and zero typos, so under §4.2 it lands in the **top tier — the glance-and-
confirm band**. That is precisely the failure the tiering is meant to make
safe, and the forward-only rule misses it entirely.

Meanwhile the 10 forward conflicts from §3.2 are already handled by coverage:
8 of 10 fall below 0.75 and none reach the top tier.

> So the handoff has the priority inverted. The forward rule guards groups the
> tiering already buries; the reverse rule guards the one hazard that survives
> into the tier the owner is being asked to trust.

**Decision: the rule is symmetric, and a marker is the phrase that
distinguishes the second wine and never appears in the grand vin's name.**
`le petit` as a marker would demote
`Petit Mouton → Le Petit Mouton de Mouton Rothschild`, which is correct;
`petit mouton` matches on both sides and correctly stays silent. Fragment
markers also produced the only false negative found: `2023 Hermitage Le
Pavillon Rouge, M. Chapoutier → 2023 Pavillon Rouge du Château Margaux` agrees
on the bare token `pavillon` and escapes the rule (its low coverage catches it
instead).

**Revised during implementation.** This section first said "full second-wine
names". Testing that list against the queue showed the full name is brittle in
the other direction — it misses the same wine written differently on either
side, and flagged two correct matches as conflicts
(`2017 Alter Ego de Ch. Palmer`, and the catalogue's own
`La Croix Ducru-Beaucaillou`). The shipped markers are the shortest
distinguishing phrase instead: `alter ego`, `la croix`, `les forts`,
`petit cheval` rather than the full names. `la croix` is the loosest and the
one to watch.

## 4. The change

Two independently deployable slices, in this order. Both are view-level; no
migration writes to resolution state, and neither requires re-matching.

### 4.1 Slice 1 — second-wine conflict flag

A marker table of full second-wine names, matched on token boundaries against
`private.release_wine_match_key(...)` on both sides:

```
petit mouton · pavillon blanc · pavillon rouge · les forts de latour
carruades de lafite · clos du marquis · la croix de beaucaillou
alter ego de palmer · echo de lynch bages · le petit cheval
reserve de la comtesse
```

A group carries `second_wine_conflict = true` when a marker's presence
**disagrees** between the source name and the rank-1 candidate, in either
direction. Surfaced as:

- a new boolean column on `wine_match_review_view` (appended, so
  `CREATE OR REPLACE` keeps grants), and
- a warning on the group row and in the expanded panel, and
- a guard: a conflicted group is excluded from any future glance-confirm or
  auto-link path, and is offered `no_suitable_match` as the suggested action.

Measured against the live queue: **19 unresolved groups flagged (12 forward,
7 reverse), with no false positives.** Two of them were missed by the
full-name markers this spec first proposed and are the reason for the looser
form above — `2016 La Croix Ducru-Beaucaillou -> 2016 Château Ducru-Beaucaillou`,
and `2016 Reserve de la Comtesse de Lalande -> 2016 Château Pichon Longueville
Comtesse de Lalande`, which the speculative eleventh marker caught.
`2011 Petit Mouton -> 2011 Le Petit Mouton de Mouton Rothschild` is correctly
**not** flagged: both sides carry the marker.

A group with no rank-1 candidate is never flagged. Nothing can be wrongly
confirmed there, and without an explicit NULL guard the empty candidate name
normalises to `''`, carries no marker, and reports a conflict against a
candidate that does not exist — which flagged 3 candidate-less groups before
the guard went in.

Rank is **not** modified. It is assigned in TypeScript at match time
(`apps/web/src/lib/releaseOffers/algoliaMatching.ts:151`) and stored; changing
it would require a full Algolia re-run for no gain, per §3.2.

### 4.2 Slice 2 — coverage tiering

A `coverage_tier` column on `wine_match_review_view`, one of
`full` / `full_with_typos` / `partial` / `low`, using the raw metric of §2 and
§3.1, plus the numeric `token_coverage` for ordering within a tier.

It must be a **materialised column on the view**, not a client-side sort: the
`/matches` list paginates and orders server-side through PostgREST
(`apps/web/src/app/(protected)/matches/page.tsx:211`).

- The queue **defaults to `full`, `full_with_typos` and `partial`** — 708 of
  the 1,513 unresolved groups that have a candidate.
- `low` (805 groups) is reachable behind a filter chip, labelled as
  likely-unmatchable. **Nothing is written to the database**; a wrong threshold
  costs one view change to correct.
- The filter excludes only `low`, never `none`, so groups with no suggestions
  still appear under "All groups" instead of being silently filtered away.
  That is why the view spells the empty tier `'none'` rather than leaving it
  NULL: `not.eq` in PostgREST drops NULL rows.
- `wine_match_queue_summary` gains per-tier tallies. Its `RETURNS TABLE`
  signature changes, so this is `DROP FUNCTION` + `CREATE`, not
  `CREATE OR REPLACE`.

Tier is not a confidence score and must not be labelled as one in the UI. The
top tier sampled 7 of 8 correct — **glance-and-confirm, never auto-link**, and
§3.3 shows how a full-coverage row can still be badly wrong.

## 5. Non-goals

- Auto-routing the `low` tier to `no_suitable_match`. It mutates resolution
  state on a heuristic sampled at 8 of 817, and 77 of those groups have a sole
  candidate. Ranking is reversible; writing is not.
- Changing `algoliaMatching.ts`, the scoring function, or anything that would
  require re-running matching.
- Token normalisation (§3.1) and the `wine_match_suggestion_view` column
  additions needed to expose `matched_words` through the union surface — the
  latter is only required if the UI shows per-candidate coverage, which §4 does
  not.
- The loose ends carried in the handoff: orphaned suggestions, row 1101, rows
  148–174.

## 6. Deployment

One migration per slice, pushed and smoke-tested separately per `AGENTS.md`.
`supabase db push --linked` is a distinct step from merging; confirm with
`supabase migration list --linked`. These views feed catalogue arbitrage,
favourites and the wine card, so `/code-review` before pushing.

Slice 1 is the smaller and the higher-value; it should go first and be
confirmed live before Slice 2 is written.

## 7. Follow-up, not in scope

- ~~**Token normalisation**~~ — **done, Slice 3**
  (`20260903190000_match_token_normalisation.sql`). The before/after sample
  against linked rows is §8. Note the outcome contradicted the assumption
  recorded here: normalisation barely moved *recall*, and earned its place on
  *precision* instead.
- **The vintage-prefix invariant.** BBR prefixes every parent SKU with the
  wine's vintage; zero disagreements across 1,138 linked rows. A cheap
  assertion on any future auto-link path.
- **Marker coverage.** The list in §4.1 is the second wines seen in this
  queue, not an exhaustive one. It will need extending as new estates appear;
  worth revisiting if it ever grows past a few dozen entries.

## 8. Slice 3 — the coverage metric, corrected

§3.1 kept a metric that was wrong twice over on the grounds that the two
defects cancelled. Slice 3 removes both and drops the Algolia dependency:

```
coverage = |core(source_wine) ∩ core(candidate_name)| / |core(source_wine)|
```

with both sides normalised identically — accents folded, stopwords and
vintage-shaped tokens dropped, and `ch`/`dom`/`st` expanded. `ch` alone occurs
551 times in the corpus. Producer words (`chateau`, `domaine`) are kept, per
the reasoning already in `coreKey.ts`: dropping them collapses "Chateau
Margaux" to the Margaux appellation.

### The evaluation §7 asked for

Ground truth is the 1,248 (source, candidate) pairs inside groups the owner has
already linked by hand: the linked `parent_sku` is correct, the group's other
candidates are wrong. Same name source on both sides, threshold 0.75.

| | correct pairs kept (want high) | wrong pairs kept (want low) |
| --- | --- | --- |
| Old metric | 792 / 817 — 96.9% | 169 / 431 — 39.2% |
| **New metric** | **797 / 817 — 97.6%** | **150 / 431 — 34.8%** |

Better on both axes, so it is not a precision/recall trade. **But the size of
the win is not where §7 predicted.** Recall barely moved — 20 false negatives
against 21 — so the claim that normalisation would stop burying correct matches
was essentially wrong. What it actually does is reject wrong candidates, 11%
more of them in relative terms. Worth having, and worth recording that the
stated rationale did not survive measurement.

On the live queue this moves 1,513 groups from 708 workable / 805 low to
**597 workable / 916 low** — about 111 fewer to review, retaining slightly more
of the correct matches. No re-matching: both inputs are already stored.

### What Slice 3 does not touch

- `private.release_wine_match_key`, which feeds `source_match_key` and the
  **generated** `match_group_key`. Renormalising identity would regenerate
  every group key and orphan the suggestion rows under them.
- The second-wine marker test, which stays on `source_match_key`. Markers like
  `les forts` and `la croix` contain stopwords that core tokens drop by design.
- `coreKey.ts`. Its `wineCoreTokens` already handles vintages and stopwords but
  has no abbreviation expansion. Adding it would improve future *ranking*, but
  only takes effect on a fresh Algolia run — a separate decision, in §9.

### A latent defect found and deliberately left alone

`private.release_wine_match_key` folds accents with a `translate` whose
argument pair is 29 characters against 30. Postgres silently ignores the
surplus rather than erroring, so from `ù` onward the map is off by one:
`release_wine_match_key('… ù ý …')` returns `e u`. `ø` is not mapped at all.
Impact is small — few wine names carry those characters — and it is **not
fixed**, because that function feeds the generated `match_group_key`. Slice 3's
new function uses a corrected 30/30 map; the two normalisers therefore differ
on those characters by design.

## 9. Open questions for the owner

1. **Default filter.** §4.2 defaults the queue to the top three tiers (761
   groups) and hides `low` (817). Is hiding by default right, or should `low`
   be visible-but-sorted-last until you have looked at some of it yourself?
2. **Marker list.** Is the §4.1 list right for the estates you actually buy?
   `reserve de la comtesse` (Pichon Lalande) was added speculatively and
   matches nothing in the queue today.
3. **The 19 flagged groups.** Slice 1 ships a per-group warning and no bulk
   action, on the grounds that 19 is a morning's work and a bulk suppress is a
   mutation you cannot eyeball. Say if you would rather have the bulk action.
4. **Abbreviation expansion in the matcher itself** (`coreKey.ts`). Slice 3
   normalises the queue's *presentation*; the same expansion in
   `wineCoreTokens` would improve which candidate is ranked first. It changes
   `match_score` and only takes effect on a fresh Algolia run over the queue,
   so it is a cost-and-timing decision rather than a technical one.
