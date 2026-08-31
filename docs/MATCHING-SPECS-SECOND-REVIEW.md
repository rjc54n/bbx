# Second review of the wine matching specifications

**Documents reviewed:** `MATCHING-FUNCTIONAL-SPEC.md` and `MATCHING-RECONCILIATION-SPEC.md`  
**Review date:** 31 August 2026  
**Review stance:** adversarial functional and technical review  
**Repository basis:** local code and migrations only; deployed Supabase state was not checked

## 1. Overall assessment

The specifications now reflect most of the first review. The split between the unified surface and background reconciliation is the right boundary. The revised documents also correct the earlier terminology, retain source-specific matching algorithms, separate alert priority from resolution state, introduce shadow mode, and acknowledge migration deployment as a separate operation.

Part A is close to implementation-ready, but three parts still need a concrete contract: queue-summary counts, old-route redirects, and the data needed for queue ordering and source-specific panels.

Part B is appropriately marked not ready. It still lacks two decisions that determine the purpose and architecture of the feature:

1. Release-offer and CellarTracker matches have different downstream effects and probably different priority triggers.
2. A daily 02:00 sweep cannot satisfy a live-opportunity requirement without a stated latency target and a faster source of listing transitions.

The documents should be revised again before Part A becomes an implementation plan. Part B should remain a design paper until its open decisions are closed.

## 2. What the revision resolved

The following first-round findings are now addressed:

- Part A and Part B can be considered separately.
- `BBX eligible`, `listed` and `has live bid` are defined as different states.
- The union uses `UNION ALL`, explicit columns and `(source, match_group_key)` identity.
- Historical suppressions use the neutral `No suitable match` label.
- Release-offer and CellarTracker exact matching remain source-specific.
- Reconciliation alert state is separate from match resolution state.
- Background auto-linking starts in shadow mode and has a separate enablement gate.
- Excluded release-offer rows are explicitly in scope for correction.
- Parent-level matching is no longer claimed to create an anchor for every format.
- Database migration, application deployment and live verification are separated.

Those corrections remove the principal defects in the original single specification.

## 3. Remaining findings

### 3.1 [P0] Part B assigns the same downstream value to two different sources

Part B says that release-offer or CellarTracker evidence should be linked so that the release-price anchor and scenario rows become available. That is correct only for release-offer evidence.

CellarTracker resolutions feed `current_cellartracker_records`, where a linked Parent ID adds market comparisons to the owner's inventory. CellarTracker evidence does not enter `release_offer_evidence_view`, does not create a release-price anchor, and is not an input to `wine_scenario_view`.

The sources therefore support different owner decisions:

| Source | Effect of linking | Likely urgent transition |
| --- | --- | --- |
| Release offer | Makes valid release evidence available to matching `(parent_sku, format_code)` rows and scenarios | A new live ask may create a buy-side arbitrage candidate |
| CellarTracker | Connects an owned wine to current asks, bids and market comparisons | A new live bid may matter more than a new ask if the owner is considering a sale |

One common `became_listed` trigger may be appropriate for release offers but not for CellarTracker. Treating both as the same live arbitrage problem would create low-value CellarTracker alerts and hide the more relevant bid transition.

#### Recommendation

- State the downstream result and owner decision separately for each source.
- Decide whether Part B initially covers release offers only.
- If CellarTracker remains in scope, define its priority event independently. `received_live_bid` may be its primary trigger rather than deferred scope.
- Remove the statement that a CellarTracker match creates release anchors or scenario rows.
- Remove the claim that a BBR holding can link a release-offer group. A holding carries a native Parent ID but does not write a `release_offer_product_resolution`.

### 3.2 [P0] The latency requirement conflicts with the ingestion cadence

Part B calls the event a fresh live opportunity and says time-to-surface is a first-class requirement. The proposed source is the daily full-book sweep at 02:00 UTC. A listing that appears just after that run may remain unseen for almost 24 hours. GitHub Actions cron is also best-effort.

Choosing an in-app badge or a push notification changes delivery after detection. It does not reduce detection latency.

The repository has an hourly arbitrage scanner from 08:17 to 23:17 UTC, but it does not populate the persistent daily-sweep store. The specification does not say whether that scanner can emit transitions, whether a lighter listing-only scan is needed, or whether daily latency is acceptable.

#### Recommendation

- Define a measurable service target, for example: 95% of qualifying transitions surfaced within a stated number of minutes or hours during a stated operating window.
- Decide whether the daily sweep meets that target.
- If it does not, design a lighter transition feed or integrate persistent transition output with the hourly scanner.
- Separate detection latency, reconciliation processing latency and owner-notification latency.
- Do not choose a push channel until the upstream detection target is settled.

### 3.3 [P0] Transition grain is inconsistent with format-level opportunity data

Part B defines `became_listed` as some format changing from no live ask to a live ask, but then proposes a Parent-level before-and-after roll-up and stores only `candidate_parent_sku` in the alert.

These definitions produce different behaviour:

- Parent-level zero-to-any detects the first listed format only.
- Format-level false-to-true also detects a newly listed magnum when a 75 cl format was already listed.
- Release anchors and scenarios operate at `(parent_sku, format_code)` grain.

The acceptance criteria recognise the format issue, but the proposed data model cannot record which format caused the alert.

#### Recommendation

- Define the grain per transition kind.
- `became_eligible` can be Parent-level.
- `became_listed` and `received_live_bid` should normally be `(parent_sku, format_code)` transitions.
- Add `format_code` or a foreign key to a durable transition row in the reconciliation model.
- Decide whether several formats first observed in one sweep form one Parent-level alert or separate format alerts.
- Use the triggering format when assessing whether matching release evidence can create an anchor for the opportunity.

### 3.4 [P1] The Part A summary RPC cannot return PostgREST estimated bucket counts as described

Part A correctly states that estimated count is a PostgREST request option. It then proposes one `wine_match_queue_summary()` RPC returning estimated counts for several states.

`Prefer: count=estimated` estimates the number of rows returned by the RPC. It does not turn `count(*) FILTER (...)` values inside the function into planner estimates. A SQL summary function will normally calculate exact bucket counts unless it implements a separate approximation method or reads precomputed counters.

The specification also places a `SECURITY DEFINER` summary function in `private` behind a public wrapper. That is unnecessary for an owner-readable aggregation if the union view already applies the owner access boundary. The exact invocation and grants are not defined, and Part B separately says no privileged definer function should be exposed through `public`.

#### Recommendation

Choose one implementable option:

1. One exact, single-pass `SECURITY INVOKER` summary function over owner-protected views, then benchmark it.
2. Separate PostgREST `head` queries with `count=estimated`.
3. A maintained summary table if exact one-pass aggregation is too slow.

Prefer option 1 until measurement shows it is too expensive. Keep the public function `SECURITY INVOKER`, revoke execution from `PUBLIC` and `anon`, grant it to `authenticated`, and rely on the existing owner-protected underlying objects. If privileged execution is genuinely required, specify the private function's owner check and grants explicitly.

### 3.5 [P1] The old-route redirect contract is incorrect and incomplete

Part A says old routes preserve `source` and `state`. The old routes do not currently have a source filter. Each route itself determines its source. An incoming `source` value should be ignored or overwritten, not preserved.

The old and new state values also differ:

| Old state | Proposed new state |
| --- | --- |
| `unresolved` | `needs-review` |
| `candidates` | No direct equivalent |
| `linked` | `linked` |
| `suppressed` | `no-suitable-match` |
| `all` | `all` |

Search and pagination parameters are omitted from the redirect contract even though current bookmarks can contain `q` and `page`.

#### Recommendation

Define the mapping explicitly. For example:

- `/release-prices/matches` always sets `source=release_offer`.
- `/cellartracker/matches` always sets `source=cellartracker`.
- Preserve validated `q` and `page`.
- Map each old state to a new state or retain a `with-suggestions` filter so `candidates` bookmarks keep their meaning.
- Reject or normalise unknown parameters.
- Test the complete URL, not only `source` and `state` in isolation.

### 3.6 [P1] The default queue cannot be implemented from the stated union contract

The `needs-review` definition includes groups whose latest match run recorded an error. The common projection does not include an error flag, error time or latest run identity.

Its first ordering tier is an exact or high-confidence single candidate. The common review projection exposes only `suggestion_count`. The suggestion union contract is not defined in enough detail to provide a common confidence measure, and the two backends do not share the same exactness semantics. Existing exact unique tiers normally auto-link, so the document should also explain when an exact candidate remains awaiting confirmation.

The first two `needs-review` bullets, unresolved with suggestions and unresolved without suggestions, already cover every unresolved group. Mixed groups are a subset, not an additional set.

#### Recommendation

- Add explicit common fields such as `last_run_status`, `last_error_at` and, only if defensible, `review_priority`.
- Define `review_priority` through source adapters rather than comparing raw scores across sources.
- Add `match_score` and candidate provenance to the suggestion contract if the UI uses them.
- Simplify `needs-review` to `unresolved_row_count > 0 OR last_run_status = 'failed'`, then describe mixed groups as a presentation rule.
- State why an exact candidate can remain unlinked. Otherwise remove that ordering tier from Part A.

### 3.7 [P1] The CellarTracker evidence panel needs a new data source or query

Part A says the CellarTracker panel shows holding quantity and snapshot context from existing per-source review views. `cellartracker_match_review_view` contains producer and region, but not quantities, `accepted_at` or snapshot identity.

Those fields exist in `current_cellartracker_records`, not in the match review view. The implementation plan does not say whether the panel will query that view, extend the review view, or add a grouped detail view.

#### Recommendation

- Specify the CellarTracker detail query and its grouping semantics.
- If reading `current_cellartracker_records`, group rows by the visible `(source, match_group_key)` and avoid a separate request per card.
- Decide which quantities are useful: home, BBR-held and total.
- Include the accepted snapshot timestamp so the owner can judge freshness.
- Add the required columns or detail endpoint to Slice 1 if a schema change is needed.

### 3.8 [P1] Reconciliation idempotency needs two ledgers, not inference from alerts

Part B gives two different idempotency identities:

- the alert table uses `(source, match_group_key, candidate_parent_sku, episode_key)`;
- the recovery section uses `(scan_run_id, source, match_group_key, candidate_parent_sku)`.

It then says the repair scan finds completed scan runs with no reconciliation record. A completed run can legitimately generate no alerts. A run can also process some transitions and fail before processing the rest. Alert absence cannot distinguish no work, incomplete work and a process that never started.

#### Recommendation

Use three explicit objects:

1. A durable transition table, at the correct Parent or format grain.
2. A reconciliation-run ledger with `scan_run_id`, status, cursor or counts, started time, finished time and error.
3. Alert rows referencing a transition and reconciliation run.

Make alert uniqueness reference `transition_id`, `source`, `match_group_key`, `candidate_parent_sku` and algorithm version as required. The repair process should read the run ledger, not infer completion from alert rows.

### 3.9 [P1] CellarTracker suppression reasons should not live only on snapshot resolutions

Part B proposes adding suppression reasons to both resolution tables or a side table. CellarTracker resolutions are tied to `(import_id, source_row_number)` in the latest accepted snapshot. A later snapshot creates new evidence rows and does not automatically carry the old resolution into the active view.

Putting a reason only on `cellartracker_product_resolutions` would duplicate one group decision across rows and would not provide a durable group-level instruction across snapshots.

#### Recommendation

- Use a source-group decision table for durable suppression intent, keyed by source and a stable group identity.
- Store the original source identity fields needed to detect a later normalisation change.
- Define how the decision applies to a later CellarTracker snapshot containing the same group.
- Keep row resolutions as the application of the decision to one accepted snapshot, not the sole record of owner intent.
- Treat release offers and CellarTracker separately if their persistence models differ.

### 3.10 [P1] The historical-suppression policy misses the original problem

Part B says historical suppressions with no reason are listed once at low priority and never treated as an actionable live alert. The original gap is specifically that an old suppression may become stale when a wine becomes tradeable.

Preventing auto-link is correct. Preventing a live review alert altogether can still hide the opportunity the feature was created to surface.

#### Recommendation

- Run a one-time baseline review of historical suppressions before enabling live reconciliation, or
- allow newly listed historical `unknown` groups to raise a review-only alert marked `reason unknown`.

Do not auto-link them. Do not silently demote a newly live opportunity solely because the old UI failed to store a reason.

### 3.11 [P1] The `match_method` migration is broader than necessary

Part B proposes separating `match_algorithm` and `decision_origin`, then includes both `match_method` constraint migrations in scope.

The existing `match_method` already records the matching algorithm adequately for this change. `local_exact` remains valid when the origin is background reconciliation. An additive `decision_origin` column can record `owner_run`, `manual` or `sweep_reconciliation` without replacing existing values or changing their constraints.

Replacing or renaming `match_method` would affect current views, UI labels, audit triggers and generated types without adding a required capability.

#### Recommendation

- Keep `match_method` as the existing algorithm field.
- Add `decision_origin` additively to resolutions and audit events.
- Backfill existing automatic methods as `owner_run` and manual decisions as `manual` only if that inference is safe and documented.
- Use `sweep_reconciliation` only as the new origin.
- Avoid changing the existing method constraints unless a genuinely new algorithm is added.

### 3.12 [P2] Several scope and acceptance statements need correction

- Part A says records arrive in all three matched sources. There are three non-catalogue sources, but only release offers and CellarTracker use owner matching.
- Part B says suppression reasons land in Part A or Part B, while Part A explicitly lists them as out of scope. Assign them to Part B.
- `is_bbx_eligible` needs one exact database predicate. `private.products / private.skus` is ambiguous when product and SKU lifecycle states differ.
- `landing-page latency within the current pages' range` is not a measurable acceptance threshold. Record the current baseline and set a numeric budget.
- Part A retains an exact filtered total for pagination. State that this counts the complete filtered result, not the visible page.
- A date bucket is not a safe listing episode identity because two genuine episodes can occur within the same bucket.
- `review_later` needs a `review_after` time or a separate manual reopen rule.
- The documents use em dashes throughout, contrary to the repository writing instructions.

## 4. Recommended decisions

### 4.1 Part A

Proceed after these changes:

1. Replace the estimated summary RPC with an implementable count design.
2. Define old-state and query-parameter redirect mappings.
3. Add the common fields needed for errors and ordering, or simplify the queue rules.
4. Specify the CellarTracker detail data source.
5. Set a numeric performance budget.

These are bounded changes. They do not require resolving Part B.

### 4.2 Part B

Recommended direction:

1. Start with release-offer reconciliation unless a separate CellarTracker sell-side case is approved.
2. Use `became_listed` at `(parent_sku, format_code)` grain for release-offer opportunities.
3. Define a detection-to-surface service target before choosing the transition producer.
4. Store durable transitions, reconciliation-run status and alerts separately.
5. Keep all automatic links disabled during shadow mode.
6. Store durable group-level suppression reasons, with source-specific persistence rules.
7. Add `decision_origin` without replacing `match_method`.

## 5. Revised implementation gates

### Part A gate

Part A is ready to implement only when:

- the summary count semantics are executable as written;
- every old URL state has a defined redirect;
- queue ordering fields exist in the view contract;
- CellarTracker panel queries are defined;
- access tests cover views and functions;
- a data-branch baseline and numeric latency budget are recorded.

### Part B design gate

Part B is ready to plan only when:

- each source has a stated owner decision and downstream effect;
- the trigger and transition grain are fixed;
- the detection latency target and producer are chosen;
- transition, run-ledger and alert schemas are fixed;
- suppression persistence across CellarTracker snapshots is defined;
- partial-run and repair behaviour are deterministic;
- shadow-mode exit criteria are numeric.

### Part B automatic-link gate

Automatic linking remains disabled until:

- shadow proposals have been compared with owner decisions;
- the minimum sample size is set in advance;
- the false-positive ceiling is set in advance;
- all false positives are explained by a corrected rule or excluded source class;
- undo and audit provenance are verified;
- a partial or ambiguous production failure can be recovered without resending an uncertain write.

## 6. Conclusion

The second draft is substantially better than the original. Part A now has a sound boundary and needs a short contract-cleanup pass. Part B correctly exposes its open questions, but it still treats two source workflows as one and describes live alerting on top of a daily detector. Those decisions should be resolved before the reconciliation schema is designed in detail.
