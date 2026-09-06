# Matching quality evaluation, 6 September 2026

**Status:** local implementation evidence. The production database was read
only. No migration, match run or application deployment was made.

**Related plan:**
[`MATCHING-QUALITY-AND-REVIEW-PRIORITISATION-PLAN.md`](MATCHING-QUALITY-AND-REVIEW-PRIORITISATION-PLAN.md).

---

## Result

The existing coverage gate hides confirmed correct candidates. Removing that
gate is supported by current data and does not depend on accepting the v2
matcher.

The v2 matcher passes the reviewed challenge fixtures, including 2017
Lynch-Bages. Its weights and review thresholds are not calibrated
probabilities. A Supabase development branch is still required for a held-out
historical comparison and representative query timing before production use.

## Read-only production baseline

The Supabase connector queried `wine_match_review_view` and
`wine_match_suggestion_view` on 6 September 2026. The query did not mutate data
and did not use `EXPLAIN ANALYZE`.

| Source | Linked groups | Confirmed Parent ID at retained rank 1 | Confirmed Parent ID in retained top 5 | Correct rank 1 marked low coverage | No retained confirmed candidate |
| --- | ---: | ---: | ---: | ---: | ---: |
| CellarTracker | 286 | 173 | 174 | 92 | 112 |
| Release offers | 1,368 | 1,108 | 1,111 | 27 | 257 |

Among linked groups where the confirmed Parent ID remains in the stored top
five, the existing rank 1 recovers 173 of 174 CellarTracker groups and 1,108
of 1,111 release-offer groups. The low-coverage filter would still hide 119 of
those correct rank-1 candidates.

The absence of a retained candidate is not a matcher failure by itself. Exact
local matches can be linked without keeping a suggestion, and old match runs
may have replaced or removed their candidate rows.

The unresolved backlog at the same read was:

| Source | Needs review | With suggestions | Low legacy coverage | Second-wine conflicts |
| --- | ---: | ---: | ---: | ---: |
| CellarTracker | 313 | 290 | 269 | 5 |
| Release offers | 1,361 | 1,300 | 827 | 28 |

This baseline shows the size of the visibility problem. It does not estimate
false-positive precision because the unresolved groups do not have reviewed
labels.

## Challenge set

The implementation's Vitest fixtures cover these decisions:

| Case | Required v2 result |
| --- | --- |
| `2017 Ch. Lynch-Bages` against Parent ID `20178004817` | Rank 1, canonical score 1.0000, `likely`, approved alias reason |
| `Chateau Margaux` against `Pavillon Blanc du Chateau Margaux` | Not canonical exact, `ambiguous`, second-wine risk |
| `Petit Mouton` against `Le Petit Mouton de Mouton Rothschild` | No false second-wine disagreement |
| `Dom.` against `Domaine` | Equivalent only in the wine-name field |
| Alias text inside a longer word | No expansion |
| Known vintage disagreement | `weak` regardless of name score |
| Equal top candidates | `ambiguous` because the score margin is small |
| Candidate with distinguishing extra terms | Not canonical exact and flagged for review |

The initial deterministic score is:

```text
0.50 x symmetric token F1
+ 0.20 x source-token coverage
+ 0.20 x candidate-token coverage
+ 0.10 x canonical exact agreement
```

The initial review boundaries are `likely >= 0.82`, `ambiguous >= 0.55`, and
`weak < 0.55`. A rank-1 lead below 0.08 forces `ambiguous`. Known vintage and
second-wine disagreements override the numeric score.

These values were selected to make the reviewed challenge cases explicit.
They must not be described as confidence or probability.

## Local verification

- Empty local database rebuilt through every migration, including
  `20260906133120_matching_review_priority_v2.sql`.
- 357 Vitest assertions passed across 41 files.
- 462 pgTAP assertions passed across 16 files, including a negative test that
  keeps 1x150cl null when the source evidence covers only 6x75cl.
- ESLint passed.
- Next.js production build and TypeScript passed.
- Supabase database lint reported one existing warning: the unused
  `p_import_id` parameter in `public.accept_bbr_import`.
- Supabase performance adviser reported no warnings.
- Supabase security adviser reported two existing warnings:
  `public.search_producers` has a mutable search path, and `pg_trgm` is in the
  public schema. This change added neither issue.

## Unfinished release evidence

There is no Supabase development branch for this project. The following plan
gates therefore remain open:

- split historical decisions by group into development and held-out sets;
- compare old and v2 top-1 and top-5 recovery on the held-out set;
- inspect every changed challenge-set rank;
- measure the exact default, filtered, count and summary query shapes;
- confirm each changed p95 is no more than 1.25 times its baseline.

Production rollout must keep the database and application steps separate. The
additive migration goes first. The application can follow only after the
remote migration ledger and cheap read queries confirm the new columns and
views exist.
