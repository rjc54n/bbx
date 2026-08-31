# Wine matching, Part B: release-price reconciliation

**Status:** design paper. **Not ready to implement.** Two decisions (§0) gate
the schema; several points are marked **[OPEN]**.

**Depends on:** [`MATCHING-FUNCTIONAL-SPEC.md`](MATCHING-FUNCTIONAL-SPEC.md)
(Part A): the unified surface, the `wine_ref` seam, and the separate
reconciliation-priority axis.

**Revised after:**
[`MATCHING-FUNCTIONAL-SPEC-REVIEW.md`](MATCHING-FUNCTIONAL-SPEC-REVIEW.md)
(30 Aug 2026) and
[`MATCHING-SPECS-SECOND-REVIEW.md`](MATCHING-SPECS-SECOND-REVIEW.md) (31 Aug
2026). The second review's §3.1 and §3.2 reshaped this paper: it is now scoped
to **release-offer** evidence and one **buy-side** opportunity, and it names
latency as a decision rather than an assertion.

---

## 0. Decisions that gate the design

Neither can be answered from the code. Both change the schema.

### 0.1 Scope: release offers only for v1

Linking a **release-offer** group makes valid in-bond release evidence
available to the release-price anchor and, through it, to scenario rows. A new
live ask on a wine with a known release price is a **buy-side arbitrage
candidate**.

Linking a **CellarTracker** group connects an owned wine to current asks, bids
and market comparisons in `current_cellartracker_records`. It does **not**
create a release anchor or a scenario row. Its urgent transition is more likely
a new **bid** (a sell opportunity) than a new ask.

These are different features. **Recommendation: Part B covers release offers
only.** CellarTracker sell-side reconciliation (`received_live_bid`,
`current_cellartracker_records`) becomes its own paper with its own trigger and
owner decision. The rest of this document assumes that scope.

### 0.2 A detection-to-surface latency target

§1.1 says a new listing is a live opportunity. The only current transition
source is the daily full-book sweep at 02:00 UTC
(`.github/workflows/daily_sweep.yml`). A wine listed at 02:30 is unseen for
~24h. There is an hourly arbitrage scanner
(`.github/workflows/arbitrage.yml`, 08:17–23:17 UTC) but it does not write to
the persistent sweep store.

A target must be set, for example: *95% of qualifying transitions surfaced
within N hours during a stated operating window.* Then decide:

- daily sweep is enough (accept ~24h worst case), or
- the hourly scanner emits a persistent listing-transition feed, or
- a dedicated lighter listing-only scan runs more often.

Detection latency, reconciliation-processing latency and owner-notification
latency are separate budgets. Do not choose a notification channel (§1.1)
before the detection target is set.

---

## 1. The problem

When the owner already holds release-offer evidence for a wine and that wine
**gets a live ask on BBX**, the evidence should already be linked, so the
release-price anchor and the affected `(parent_sku, format_code)` scenario rows
light up while the ask is live. Behaviour today, by group state:

| Group state when a format gets a live ask | Today |
| --- | --- |
| **Linked** (a prior confirmed or auto-linked match) | Automatic. `is_bbx_eligible` is a live join; `release_offer_evidence_view` already builds an anchor for any linked Parent ID with no eligibility gate. The next sweep and view refresh surface it. No action needed. |
| **Unresolved**, never linked | The next owner-run match run would re-enqueue it and its exact tier might auto-link, but nothing triggers a run, and a non-exact name still needs manual confirmation. |
| **No suitable match** (suppressed) | Never revisited. A suppressed group carries a resolution row, so every match run skips it. Nothing signals the wine is now listed. |

A BBR holding for the same wine does **not** change this: a holding carries a
Parent ID but never writes a `release_offer_product_resolution`.

### 1.1 Latency is a requirement, not a metric

The moment a format gets a live ask is close to the highest-value signal in the
pipeline. A design that detects the event but files it in a weekly-reviewed
queue has spent the effort and missed the point. The target in §0.2 makes this
concrete. **[OPEN]** delivery channel once detection is settled: in-app badge
on the `/matches` "open alerts" filter, or a push channel (there is none
today).

---

## 2. Vocabulary (from Part A §4)

- **BBX eligible**: the Parent ID has at least one live catalogue SKU.
- **Listed**: at least one format has a live ask
  (`catalogue_view.is_listed` / `ask IS NOT NULL`).
- **Has live bid**: at least one format has a standing bid.

These are explicit `EXISTS` checks against `catalogue_view`, never inferred
from "a row exists".

---

## 3. The trigger

Per the second review §3.3, the trigger grain must match the opportunity grain.

| Transition | Grain | In scope for v1? |
| --- | --- | --- |
| `became_listed` | `(parent_sku, format_code)`: a format went from no live ask to a live ask | **Yes, the primary trigger** |
| `became_eligible` | `parent_sku`: newly present in `prod_biddable` | **[OPEN]** optional secondary, lower priority |
| `received_live_bid` | `(parent_sku, format_code)` | No, that is the CellarTracker sell-side paper (§0.1) |

`became_listed` is `(parent_sku, format_code)` because a newly listed magnum is
a distinct opportunity even when the 75cl was already listed, and because the
release anchor it would feed is itself per format. A Parent-level "zero to any"
rollup would miss the magnum.

**[OPEN]** when several formats of one Parent ID first list in the same sweep:
one alert carrying all triggering formats, or one alert per format.

---

## 4. Data model: three ledgers

The second review §3.8 is adopted: alert rows cannot be the idempotency
record, because "a completed scan run with no alert" is ambiguous between no
work, partial work and a process that never started.

### 4.1 `listing_transitions`

One row per detected `(parent_sku, format_code, transition_kind)` in a scan
run.

| Field | Purpose |
| --- | --- |
| `id` | PK |
| `scan_run_id` | the sweep that detected it |
| `parent_sku`, `format_code` | the opportunity grain (`format_code` null only for `became_eligible`) |
| `transition_kind` | `became_listed` / `became_eligible` |
| `detected_at` | ordering, ageing |

Computed explicitly from before/after listed-state per scan run, **not** derived
from individual `observation_events` (a newly listed SKU emits `appeared`, not
an `is_listed` field change).

### 4.2 `reconciliation_runs`

One row per (scan run, reconciliation pass).

| Field | Purpose |
| --- | --- |
| `id` | PK |
| `scan_run_id` | the source sweep |
| `status` | `running` / `completed` / `failed` |
| `transitions_total`, `transitions_processed` | cursor / progress |
| `started_at`, `finished_at`, `error` | ops, alerting |

The repair scan (§7) reads **this ledger**, not alert absence, to find sweeps
whose reconciliation never completed.

### 4.3 `match_reconciliation_alerts`

One row per (source group, candidate, transition).

| Field | Purpose |
| --- | --- |
| `id` | PK |
| `transition_id` | FK to `listing_transitions` |
| `reconciliation_run_id` | FK to `reconciliation_runs` |
| `source` | `release_offer` (only value in v1; column kept for the future) |
| `match_group_key` | the source group; `(source, match_group_key)` never bare |
| `candidate_parent_sku` | the Parent ID that caused the alert; a candidate, not a group decision |
| `match_algorithm`, `algorithm_version` | how the candidate was derived (§6) |
| `confidence` | `exact_unique` / `ambiguous` |
| `status` | `open` / `linked` / `dismissed` / `stale` |
| `disposition_reason` | why dismissed or auto-actioned |
| `opened_at`, `updated_at` | ordering, ageing |
| unique `(transition_id, source, match_group_key, candidate_parent_sku, algorithm_version)` | idempotency |

**Episodes.** A wine can delist and relist. Because a transition belongs to a
specific `scan_run_id`, "the same alert twice in one listed spell" and "listed
again months later" are naturally different `transition_id`s. A date bucket is
**not** used: two genuine relisting episodes can fall in one bucket. **[OPEN]**
whether a `dismissed` alert suppresses a *later* transition's alert for the
same `(group, candidate)`, or the later one genuinely re-raises.

---

## 5. Suppression reasons

### 5.1 Where they live

The second review §3.9 is adopted. A reason must be a **durable group-level
decision**, not a field on snapshot row resolutions: a later CellarTracker
snapshot creates new evidence rows and does not carry the old resolution, and
even for release offers the reason is one decision about a group, not per row.

- Release offers: a `release_offer_group_decisions` table keyed by
  `match_group_key` (release-offer `match_group_key` is stable across imports).
- The row-level `status = 'ignored'` stays as the *application* of the decision
  to the corpus; the group-decision row is the record of intent.
- Store the source identity fields used for exact matching at decision time, so
  a later normalisation change is detectable.

### 5.2 The reasons

- `not_in_catalogue`: reopen on `became_listed` / `became_eligible`
- `ambiguous`: do **not** auto-reopen; a repeat of the same candidate is not new
  information
- `insufficient_evidence`: **[OPEN]** reopen policy
- `review_later`: needs a `review_after` timestamp or an explicit manual-reopen
  action; "later" with no time is not actionable

### 5.3 Historical suppressions

The second review §3.10 corrects the previous draft. Historical `ignored` rows
have no reason and are labelled "No suitable match" (Part A). When such a wine
becomes listed, the previous plan "list once, low priority, never a live alert"
would hide exactly the opportunity this feature exists to surface.

Instead, one of:

- a **one-time baseline review** of all historical suppressions before live
  reconciliation is enabled, tagging each with a reason; or
- historical `unknown` groups that become listed **do** raise a review-only
  alert, marked `reason: unknown`.

Either way they are never auto-linked.

---

## 6. Source-specific exact adapter

v1 has one source, but the interface is defined so CellarTracker's paper can
add its own implementation without touching this one.

- **Release offers**: `private.release_wine_match_key(product.name,
  product.vintage) = release_offer_source_rows.source_match_key`, unique parent
  match. This is the existing `begin_release_offer_match_run` "local exact"
  tier.
- **CellarTracker** (future paper): `private.bbr_wine_core_key(name, producer,
  country, region, subregion) = evidence.source_core_key`, a token-set
  comparison with producer/geography handling. `source_match_key` still exists
  on CellarTracker evidence but is **not** what its exact tier uses.

```
reconcile(source, candidate_parent_sku, transition) ->
    { confidence: exact_unique | ambiguous | none,
      match_algorithm, algorithm_version }
```

Orchestration (the scan-run loop, writing `reconciliation_runs` and alert rows)
is shared. The identity comparison is never shared. Every proposal records its
`match_algorithm` and `algorithm_version`.

---

## 7. Sweep integration

### 7.1 Transition computation

Parent/format-level transitions are computed explicitly from before/after
listed-state for the scan run and written to `listing_transitions` (§4.1).

### 7.2 Which sweep states permit reconciliation

- `completed` scan run: full reconciliation.
- `partial` scan run: **no auto-link** (first review §2.4). **[OPEN]** whether
  it may still raise review-only alerts, or is left entirely to the repair
  scan.

### 7.3 Idempotency and recovery

- A reconciliation pass is idempotent per `transition_id`: re-processing a
  transition is a no-op via the alert unique constraint.
- The repair scan reads `reconciliation_runs` for `completed` sweeps with no
  `completed` reconciliation run and processes them.
- An alert fires when a sweep succeeds but its reconciliation run fails.
- Local exact reconciliation is DB-local and bounded. Any Algolia-backed
  candidate search (not in v1) is a resumable stage, never inside a
  transaction, keeping the existing candidate-count cap.

---

## 8. Rollout: shadow first

Each stage is a gate.

1. **Data model.** The three tables, private functions, constraints, the
   additive `decision_origin` column (§9), the `release_offer_group_decisions`
   table and reasons (§5). Deployed with nothing reading or writing the alert
   tables.
2. **Sweep integration, shadow mode.** The sweep computes transitions and the
   reconciliation pass writes alert rows with `status = open`. **Nothing is
   auto-linked.** The `/matches` surface shows the "open alerts" filter (Part A
   §3.6 priority axis).
3. **Observation.** Run for a period whose length and sample size are set **in
   advance**. Report: transitions found, groups inspected, proposals,
   `exact_unique` vs `ambiguous` split, and, by comparing proposals against
   what the owner then does manually, the false-positive rate.
4. **Auto-link, scoped.** A separate switch. Enabled only when: the sample size
   was met, the pre-set false-positive ceiling was met, and every false
   positive is explained by a corrected rule or an excluded source class. Then
   auto-link only `confidence = exact_unique` proposals whose
   `candidate_parent_sku` is the Parent ID of the triggering transition.
   Suppressed groups stay review-only regardless. **[OPEN]** require two
   consecutive successful sweeps if the transition feed proves noisy.
5. **Undo and provenance.** Every auto-link has one-click undo and shows its
   scan run, algorithm and candidate evidence.

---

## 9. `decision_origin`, additive

The second review §3.11 is adopted. Do **not** rename or re-constrain
`match_method`: `local_exact` stays a correct *algorithm* label whatever
triggered the decision.

- Add a nullable `decision_origin` column to both `*_product_resolutions`
  tables and their `*_resolution_events` audit tables.
- Values: `owner_run`, `manual`, `sweep_reconciliation`.
- Backfill existing rows only where the inference is safe and documented
  (`manual` method → `manual` origin; the auto-link methods → `owner_run`).
- `sweep_reconciliation` is only ever the new origin.
- No change to the existing `match_method` CHECK constraints.

---

## 10. Open questions

1. **§0.1** Confirm Part B is release-offer only for v1.
2. **§0.2** The detection-to-surface latency target, and the transition
   producer (daily sweep / hourly scanner feed / dedicated scan).
3. **§1.1** Alert delivery: in-app badge only, or build a push channel.
4. **§3** Does `became_eligible` raise a secondary lower-priority item, or is
   `became_listed` the only trigger.
5. **§3** One alert per Parent ID carrying all triggering formats, or one per
   format.
6. **§4.3** Does a `dismissed` alert suppress a later transition's alert for the
   same `(group, candidate)`.
7. **§5.2 / §5.3** `insufficient_evidence` reopen policy; and one-time baseline
   review vs `reason: unknown` review-only alerts for the historical backlog.
8. **§7.2** May a `partial` sweep raise review-only alerts.
9. **§8** The shadow-mode sample size and false-positive ceiling; one-sweep vs
   two-sweep confirmation for auto-link.

---

## 11. Acceptance criteria

To be completed once §0 and §10 are closed. The matrix and minimum scenarios
below are the current draft.

### 11.1 Functional matrix

Cross-product of: `{unresolved, linked, no-suitable-match, excluded}` group
state, `{became_listed, became_eligible, delisted, relisted}` transitions,
`{exact-unique, ambiguous, no candidate}` outcomes, `{complete, partial}`
sweeps, `{first run, retry after crash}`, `{one format, several formats per
Parent ID}`.

### 11.2 Minimum scenarios

1. A release-offer group gets one `exact_unique` candidate after a
   `became_listed` on one format: alert in shadow; link once enabled.
2. Two Parent IDs share the normalised name+vintage key: `ambiguous`, no
   auto-link.
3. A `not_in_catalogue` suppressed group is raised for review on
   `became_listed`.
4. An `ambiguous` suppressed group is **not** reopened when the same candidate
   recurs.
5. An excluded group never enters reconciliation; restoring it after an alert
   was created for its group behaves correctly.
6. A linked group produces an audit entry and **no** queue item on transition.
7. A newly listed magnum gets **no** anchor when release evidence exists only
   for a 75cl case; the alert names the magnum format, and matching finds no
   in-bond evidence for it.
8. A `partial` sweep creates no auto-link.
9. A process stops after the sweep commit: the repair scan completes
   reconciliation on the next run from `reconciliation_runs`, with no duplicate
   transitions, alerts or links.
10. A wine goes `became_eligible`, then `delisted`, then `became_listed` months
    later: a new transition and a new alert, not a duplicate of the first.
11. A non-owner cannot read or mutate any reconciliation object.
12. A historical `unknown` suppressed group that becomes listed raises a
    `reason: unknown` review-only alert and is never auto-linked.

### 11.3 Deployment gates

Local migration replay green; DB access tests green; `apps/web` lint/test/build
green; linked migration ledger verified; signed-in deployed-route smoke test
separate from local checks; shadow-mode evidence reviewed and signed off before
auto-link is enabled; a partial or ambiguous production write failure can be
recovered without resending an uncertain write.

---

## 12. Technical guard rails

- Reconciliation functions in a **private** schema; no privileged `SECURITY
  DEFINER` function exposed through `public`; `security_invoker = true` on any
  view; grants minimal; anon / non-owner / owner access all tested.
- `(source, match_group_key)` everywhere; dispatch via the Part A source
  adapter, never a constructed RPC name.
- DB uniqueness constraints on transition ingestion and open alerts; repeated
  scan-run processing a no-op; conflict-safe inserts for concurrent workers;
  confirm / dismiss / auto-link close the alert atomically with the resolution
  change.
- Never retry an ambiguous production DB failure without checking server state
  first ([`../AGENTS.md`](../AGENTS.md)).
- No Algolia call inside a DB transaction.
- Excluded rows filtered before counts, exact matching, candidate generation
  and reconciliation.
- Observability: transitions found, groups inspected, proposals, ambiguous
  results, auto-links, confirmations, dismissals, retries, failures, oldest
  open alert, `completed` sweeps with no `completed` reconciliation run. Every
  automatic resolution traceable to `transition_id` + `reconciliation_run_id` +
  algorithm + candidate evidence.
- Regenerate `apps/web/src/lib/database.types.ts` after every schema change;
  delete throwaway verification objects immediately.
- Performance work on a Supabase data branch, not production, unless no branch
  is available and that trade-off is recorded.
