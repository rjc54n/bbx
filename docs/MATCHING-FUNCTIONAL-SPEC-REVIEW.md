# Review of wine matching functional specification

**Document reviewed:** `docs/MATCHING-FUNCTIONAL-SPEC.md`  
**Review date:** 30 August 2026  
**Review stance:** adversarial functional and technical review  
**Recommendation:** revise before implementation

## 1. Overall assessment

The proposed unified matching surface is a reasonable product direction. Matching is a recurring cross-source activity, so one discoverable work queue is easier to operate than two copied pages.

The specification is not ready for implementation. Its central reconciliation proposal conflates catalogue identity, BBX eligibility and a current live listing. It also applies the release-offer exact-match rule to CellarTracker, although CellarTracker now has a separate identity algorithm. The proposed `Newly biddable` state has no durable data model, retry contract or background actor model.

These are design issues rather than implementation details. Building the proposal as written could produce false priority alerts, miss valid CellarTracker matches, lose reconciliation work after a partial failure, or apply release anchors through unattended false matches.

This review covers the local repository. It does not confirm the currently deployed Supabase schema or production data.

## 2. Findings

### 2.1 [P0] Biddable, eligible and listed are treated as one state

The specification says that a wine becomes biddable when someone lists it. It also treats presence in `catalogue_view` as evidence that the wine is currently tradeable.

The repository has three distinct concepts:

| Concept | Current representation |
| --- | --- |
| Wide BBR catalogue identity | `prod_product`, used for candidate search |
| BBX-eligible universe | `prod_biddable`, mirrored into `private.products` and `private.skus` |
| Current live listing | `private.skus.is_listed`, surfaced by `catalogue_view.is_listed` |

`catalogue_view` contains unlisted formats. Its materialised source selects every non-gone SKU and exposes `is_listed` separately. The current matching review views calculate `is_biddable` by testing for any catalogue row, without checking `is_listed`. That existing field name is misleading and should not define the new workflow.

The specification also uses several incompatible descriptions of the trigger:

- entering the biddable set;
- someone listing the wine;
- becoming tradeable right now;
- appearing in `catalogue_view`.

Those events are not equivalent.

#### Recommendation

Define the business trigger before designing reconciliation:

- `became_eligible`: the Parent ID entered the `prod_biddable` universe;
- `became_listed`: at least one format changed from no live ask to a live ask;
- `received_live_bid`: at least one format acquired a bid, if this is the actual sell-side opportunity.

Use explicit fields such as `is_bbx_eligible`, `has_live_listing` and `has_live_bid`. Do not infer any of them from mere presence in `catalogue_view`.

### 2.2 [P0] The proposed exact-match rule is wrong for CellarTracker

Section 3.3 proposes comparing a normalised `private.products.name` and vintage with `source_match_key` for both matched sources.

CellarTracker no longer uses that identity rule. Its current first tier compares the generated `source_core_key` with `private.bbr_wine_core_key(...)`. That comparison includes source-specific producer and geography handling. It was introduced because CellarTracker and BBR put the same identity terms in different orders.

Using `source_match_key` in reconciliation would produce behaviour different from a manual CellarTracker match run. It would miss valid exact matches and could create a second definition of exactness for the same source.

#### Recommendation

Define a common reconciliation interface with source-specific implementations:

- Release offers use their existing exact name-and-vintage rule.
- CellarTracker uses `source_core_key` and `bbr_wine_core_key`.
- Each result records its source, algorithm and algorithm version.

The implementation may share orchestration, but it must not share an identity comparison that is only valid for one source.

### 2.3 [P0] The `Newly biddable` state has no durable model

The specification describes a new queue state, an acknowledgement action and protection against repeated alerts. It does not define where those facts are stored.

The existing resolution tables cannot represent the proposed workflow:

- An unresolved group has no resolution row.
- A suppressed group records suppression, not the candidate that caused a later alert.
- Neither records the triggering scan run or transition.
- Re-suppression cannot acknowledge one proposed Parent ID without changing the whole group.
- A crash after the sweep commit could lose the transition.
- The system cannot distinguish a repeated sweep from a genuine later relisting episode.

#### Recommendation

Add an explicit reconciliation record. Its identity and fields should include at least:

| Field | Purpose |
| --- | --- |
| `source` | Distinguishes release offers and CellarTracker |
| `match_group_key` | Identifies the source group within that source |
| `candidate_parent_sku` | Records the Parent ID that caused the alert |
| `transition_kind` | For example, `became_eligible` or `became_listed` |
| `scan_run_id` | Makes the trigger auditable and replayable |
| `algorithm` and `algorithm_version` | Preserves how the candidate was derived |
| `status` | For example, `open`, `linked`, `dismissed` or `stale` |
| `disposition_reason` | Explains dismissal or automatic action |
| timestamps | Supports ordering, ageing and operations |

Define whether a later delist and relist opens a new episode. A dismissal should apply to the proposed candidate, not silently become a permanent decision about the entire source group.

### 2.4 [P1] Sweep integration lacks retry and failure semantics

The sweep already records SKU `is_listed` changes as observation events. That is useful evidence, but it is not a complete parent-transition feed:

- A new listed SKU produces an `appeared` event rather than an `is_listed` field transition.
- One Parent ID may have several formats.
- A sweep can finish as `partial`.
- Source data commits before catalogue cache refresh.
- Cache refresh can fail after the source commit.
- The process can stop after committing the sweep but before reconciliation.

The specification does not say which sweep states permit reconciliation, how a failed run resumes, or how a later process identifies unprocessed transitions.

#### Recommendation

- Calculate parent-level transitions explicitly from before and after state.
- Persist each transition or a durable reconciliation watermark.
- Make reconciliation idempotent per scan run and candidate.
- Do not auto-link following a partial sweep until that behaviour has been shown to be safe.
- Add a periodic repair process for successful scan runs that have no completed reconciliation record.
- Alert when a sweep succeeds but reconciliation fails.

### 2.5 [P1] Background auto-linking needs a stricter safety bar

An exact and unique normalised key is not proof of wine identity. The normalisation removes punctuation, accents and vintage text. Uniqueness is also measured against the catalogue at one moment and can change as the catalogue expands.

The current exact tiers already auto-link during an owner-started match run. Moving that action into an unattended background process changes the operating risk. A false match can add a release anchor to cards and scenario results before the owner sees the candidate.

#### Recommendation

- Start reconciliation in shadow mode. Record proposals without applying links.
- Compare proposals with manually reviewed outcomes.
- Report proposal volume, ambiguity and false-positive rates.
- Permit automatic linking only for source-specific exact rules that have met an agreed evidence threshold.
- Keep suppressed groups review-only.
- Require the proposed Parent ID to be the Parent ID responsible for the qualifying transition.
- Provide a clear undo action and show reconciliation provenance in the UI.
- Consider requiring two consecutive successful sweeps if the upstream transition is shown to be noisy.

### 2.6 [P1] `sweep_reconciled` conflicts with existing database constraints

The proposal introduces `sweep_reconciled` as a match method. Both resolution tables restrict their allowed `match_method` values, and the two constraints are different.

Using one new method also combines two separate facts:

- how the identity was matched;
- what initiated the decision.

#### Recommendation

Separate `match_algorithm` from `decision_origin`. For example:

- `match_algorithm = local_exact`;
- `decision_origin = sweep_reconciliation`.

If the existing schema is retained, the scope must include both constraint migrations, audit events, generated database types and UI display labels.

### 2.7 [P1] `No catalogue match` may misrepresent historical decisions

The specification assumes that every suppressed group means the wine is genuine but absent from the catalogue. The current button says `Reject and suppress`. The owner may have used it for several reasons:

- no catalogue wine exists;
- several candidates are plausible;
- the evidence is insufficient;
- the decision should be deferred.

Relabelling every historical suppressed group as `No catalogue match` asserts a reason that was never stored.

#### Recommendation

Use `No suitable match` for existing records, or introduce explicit suppression reasons:

- `not_in_catalogue`;
- `ambiguous`;
- `insufficient_evidence`;
- `review_later`.

Require a reason for future suppression if later reconciliation depends on it. Automatically reopen only decisions whose stored reason makes the new catalogue transition relevant.

### 2.8 [P1] Performance claims are inaccurate

The document says the underlying views use estimated counts and that exact counts apply only to the visible page. Count mode is selected by the PostgREST query, not embedded in a database view. An exact count covers the complete filtered result even when the response returns one page.

The current CellarTracker page requests exact counts for its four queue totals. The release-offer page requests estimated headline counts but still asks for an exact filtered result count for pagination.

A union view can increase the cost of each count, particularly if source and state filters are not pushed into the underlying branches.

#### Recommendation

- Use `UNION ALL`, not `UNION`.
- Use `(source, match_group_key)` as the composite identity and final ordering tie-breaker.
- Decide which queue totals need to be exact.
- Test that source filters are pushed into the relevant union branch.
- Benchmark the union, each state filter and pagination on a Supabase data branch.
- Use `EXPLAIN (ANALYZE, BUFFERS)` with representative data before accepting the design.
- Avoid production timing work unless no data branch is available and that trade-off is recorded.

### 2.9 [P1] `Every scenario picks it up` is too broad

Release anchors exist at `(parent_sku, format_code)`. Matching links at Parent ID grain. Linking a source group to a Parent ID does not guarantee that the source evidence contains a valid release price for the format that has become listed.

Scenario rows are also per format. A newly listed magnum does not gain a release anchor merely because the linked evidence contains a six-bottle 75 cl case.

#### Recommendation

Replace the claim with:

> Linking makes valid in-bond release evidence available to matching `(parent_sku, format_code)` rows. Formats without matching release evidence remain unanchored.

Add acceptance tests for a Parent ID with several formats, including a newly listed format for which no release evidence exists.

### 2.10 [P1] The rollout is not independently deployable as written

Step 4 combines database state, sweep-runner behaviour and a new UI bucket. In this repository, application deployment and Supabase migration deployment are separate. Deploying runner code before its database dependencies would fail the nightly sweep.

#### Recommendation

Use this order:

1. Add reconciliation tables, private functions, constraints and views.
2. Replay migrations and database tests locally.
3. Push the migration and verify the remote migration ledger.
4. Deploy the UI reading the empty new state.
5. Deploy sweep integration in shadow mode.
6. Review observed proposals.
7. Enable automatic linking as a separate switch.

Each migration-sized change should remain an independently deployable slice.

## 3. Recommendations for the functional design

### 3.1 Define one canonical state vocabulary

The specification should define these terms once and use them consistently:

- Catalogue match: a source group is linked to a BBR Parent ID.
- BBX eligible: the Parent ID is present in the BBX-eligible universe.
- Listed: at least one format has a current live ask.
- Linked: the source group has a confirmed Parent ID resolution.
- Unresolved: the source group has no resolution.
- Suppressed: the owner has deferred the group for a stored reason.
- Excluded: the evidence is invalid and removed from downstream use.
- Reconciliation alert: a catalogue transition has created a new candidate for an unresolved or suppressed group.

Avoid using `biddable` unless it has one precise definition across the sweep, database and UI.

### 3.2 Define the work-queue state machine

The document should show the permitted transitions and the action that causes each one.

| Current state | Event | Result |
| --- | --- | --- |
| Unresolved | Source-specific exact candidate from qualifying transition | Open reconciliation alert or automatic link, depending on policy |
| Unresolved | Ambiguous candidate | Open reconciliation alert |
| Suppressed: not in catalogue | New candidate | Open reconciliation alert |
| Suppressed: ambiguous | Same candidate repeats | Remain suppressed unless policy says otherwise |
| Open reconciliation alert | Owner confirms | Linked and alert closed |
| Open reconciliation alert | Owner rejects candidate | Candidate dismissed; group returns to its prior resolution state |
| Linked | Eligibility or listing transition | No review item; audit only |
| Excluded | Any catalogue transition | No action |

Specify how mixed groups are treated when some source rows are linked, some suppressed and some unresolved.

### 3.3 Separate queue priority from resolution state

`Newly biddable` is a priority or alert condition, not a source resolution. It should not be added to the existing resolution status enum.

The unified view can expose both:

- resolution state: unresolved, linked or suppressed;
- reconciliation priority: none or open transition alert.

This avoids forcing one field to answer two different questions.

### 3.4 Preserve source context in the unified surface

The two sources have different review evidence. Release offers have offer dates, price text, tasting notes and source links. CellarTracker has producer, region, holding quantity and snapshot context.

The unified page should share its queue shell, filters and decision controls while retaining source-specific evidence panels. A lowest-common-denominator card would make review less reliable.

### 3.5 Clarify the default queue

`Needs review` is not defined precisely. It should state whether it includes:

- all unresolved groups;
- unresolved groups with suggestions only;
- open reconciliation alerts;
- mixed groups;
- failed matching groups;
- suppressed groups reopened by a transition.

Recommended default ordering:

1. Open reconciliation alerts with a live opportunity.
2. Exact or high-confidence candidates awaiting confirmation.
3. Other unresolved groups with suggestions.
4. Unresolved groups without suggestions.

The ordering should be stable by `priority`, event time, `source` and `match_group_key`.

## 4. Technical guard rails

### 4.1 Access control

- Keep background reconciliation functions in a private schema.
- Do not expose a privileged `SECURITY DEFINER` function through `public`.
- Preserve `security_invoker = true` on union views.
- Grant only the required operations.
- Test anonymous, authenticated non-owner and owner access.
- Do not rely on a client-provided `source` without validating it against a closed allowlist.

### 4.2 Identity and dispatch

- Use `(source, match_group_key)` everywhere. A bare group key is not globally unique.
- Dispatch through an explicit source adapter rather than dynamically constructing RPC names.
- Validate the Parent ID against the qualifying transition and local catalogue state.
- Retain source-specific exact algorithms.
- Store algorithm version with every automatic or proposed decision.

### 4.3 Idempotency and concurrency

- Add database uniqueness constraints for transition ingestion and open alerts.
- Make repeated processing of the same scan run a no-op.
- Lock or use conflict-safe inserts when two workers can process the same alert.
- Ensure confirm, dismiss and automatic-link operations close the alert atomically with the resolution change.
- Do not retry an ambiguous database failure without checking server-side state.

### 4.4 External services and transactions

- Do not call Algolia from inside a database transaction.
- Keep local exact reconciliation database-local and bounded.
- Treat external candidate search as a resumable stage with stored progress and errors.
- Preserve the existing limit on candidate counts.

### 4.5 Exclusions

- Filter excluded rows before queue counts, exact matching, candidate generation and reconciliation.
- Confirm whether group-level exclusion can leave a partial group through fingerprint differences.
- Test restoring an excluded record after a reconciliation alert has been created.

### 4.6 Observability

Record at least:

- qualifying transitions found;
- source groups inspected;
- proposals raised;
- ambiguous results;
- automatic links;
- owner confirmations and dismissals;
- retries and failures;
- oldest open alert;
- unreconciled successful scan runs.

Every automatic resolution should be traceable to its scan run, source algorithm and candidate evidence.

### 4.7 Performance

- Benchmark queries before adding the top-level navigation surface.
- Avoid several independent full-view counts per request.
- Consider one bounded queue-summary RPC if exact totals are required.
- Preserve server-side pagination.
- Select explicit columns rather than `select("*")` from the union contract.
- Regenerate database types after schema changes.

## 5. Required acceptance criteria

The specification should add testable acceptance criteria before implementation.

### 5.1 Functional matrix

Cover the cross-product of:

- release offers and CellarTracker;
- unresolved, linked, suppressed and excluded evidence;
- newly eligible, newly listed, delisted and relisted transitions;
- exact, ambiguous and no candidate outcomes;
- complete and partial sweeps;
- first execution and retry;
- one and several formats per Parent ID.

### 5.2 Minimum scenarios

1. A release-offer group receives one exact Parent ID candidate after a qualifying transition.
2. A CellarTracker group matches only through its source-specific core-key algorithm.
3. Two Parent IDs share the same normalised identity and neither is auto-linked.
4. A suppressed `not_in_catalogue` group is raised for review.
5. A suppressed `ambiguous` group is not reopened merely because the same candidate repeats.
6. An excluded group never enters reconciliation.
7. A linked group needs no owner action when it becomes eligible or listed.
8. A newly listed format has no release anchor when evidence exists only for another format.
9. A partial sweep creates no unattended link.
10. A process stops after sweep commit and completes reconciliation on retry without duplicate alerts or links.
11. A non-owner cannot read or mutate the unified queue.
12. Old routes preserve source and state filters when redirected.

### 5.3 Deployment gates

- Local migration replay passes.
- Database lint and access tests pass.
- Web tests, lint and build pass from `apps/web`.
- The linked migration ledger is verified after database deployment.
- The signed-in deployed route is smoke-tested separately from local validation.
- Shadow-mode evidence is reviewed before automatic linking is enabled.

## 6. Recommended answers to the specification's reviewer questions

### 6.1 Local identity

Keep local wine identity out of this phase. The current objective is queue consolidation and transition handling. Retaining `wine_ref` as a future seam is sufficient.

### 6.2 Reconciliation trigger

Use post-sweep transition reconciliation plus a periodic repair scan. Reprocessing the entire suppressed backlog every day is wasteful and ignores recorded owner decisions.

### 6.3 Automatic linking

Do not enable unattended automatic linking initially. Run shadow mode, then enable only source-specific exact matches that meet an agreed evidence threshold. Suppressed groups should remain review-only.

### 6.4 Positive confirmation for already linked groups

Do not add linked groups to the review queue merely to confirm automatic behaviour. Record the transition in the audit trail. Surface it only through operational history if needed.

### 6.5 BBR holdings

Keep BBR-holdings review out of scope until its decision model is defined. Adding a third source because the filter can accommodate it would broaden this phase without resolving the more immediate reconciliation issues.

### 6.6 Navigation

Use one top-level `/matches` page with source-filtered deep links from Release prices and My CellarTracker. Preserve the old routes as redirects. This matches the recurring cross-source operational task.

## 7. Recommended specification revisions

Before implementation, revise the specification to:

1. Replace the current biddability terminology with an explicit catalogue-state model.
2. State which transition creates priority work.
3. Retain source-specific exact-match algorithms.
4. Add the reconciliation data model and state machine.
5. Define failure, retry and partial-sweep behaviour.
6. Separate match algorithm from decision origin.
7. Store suppression reasons before using them to drive reconciliation.
8. Correct the performance and exact-count claims.
9. Narrow claims about downstream scenario effects to matching formats.
10. Add acceptance criteria and deployment gates.

Once those changes are made, the unified page, shared queue shell and source-filtered navigation can be evaluated independently of the higher-risk background reconciliation work.
