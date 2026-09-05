# Repository documentation audit, 5 September 2026

**Status:** repository-wide documentation audit completed against `main` on 5
September 2026. Slice 8 landed as `f2702bd` during the audit. The documentation
actions were then applied against that commit. This is a source and
repository-state review. It does not verify the deployed app or production
database.

---

## Assessment

The repository has enough documentation. The problem is lifecycle control,
not missing prose.

The operational rules, incident records and source contracts are useful and
mostly trustworthy. The weak point is that plans remain written in the future
tense after parts of them ship. The documentation index then repeats some of
those old statuses. A developer can therefore read an accurate design and an
incorrect implementation state in the same document.

The lean response is:

1. Correct the status block at the top of the small number of affected living
   documents.
2. Add a short implementation ledger where a document mixes shipped and
   planned work.
3. Keep dated reviews, phase plans and incident reports in place as history.
4. Replace the July roadmap with a short current roadmap when the next product
   priority is chosen. Do not continuously update the July document.

Moving files into an archive, merging old papers or rewriting all phase plans
would add work without improving the next engineering decision.

---

## Findings that can misdirect current work

### P1: BBR history status changed during the audit

The audit began while Slice 8 was uncommitted. It landed on `main` as
`f2702bd`, after Slices 0 to 7 had landed through commits `f8e8e99` to
`8b6010e`. The functional specification and implementation plan gained the
right close-out scope, but retained contradictory opening statuses and an
unsupported deployment claim.

The action pass now makes the four BBR product documents agree: Slices 0 to 8
are implemented on `main`, Slices 9 and 10 are deferred, and Slice 11 was
removed. It does not call the app deployed because live state was not
reverified during this audit.

Affected documents:

- `BBR-HOLDINGS-HISTORY-EPIC.md`
- `BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md`
- `BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md`
- `BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md`
- `README.md`
- `apps/web/README.md`
- `docs/README.md`

The two BBR plan reviews remain valid as dated review evidence. Their old
release-gate verdicts are not the current implementation status.

### P1: The canonical wine record status is false

`WINE-RECORD-SPEC.md` says "No code yet". The canonical wine card, owner
release anchors and saved scenarios described in the document have shipped.
The `wine_locals` source-neutral identity remains planned. A 5 September
amendment also records the BBR-only ownership route behaviour.

The action pass did not split or redesign the model. It replaced the opening
status with a small ledger showing implemented and deferred sections.

### P1: The documentation index repeats known false states

`docs/README.md` calls the BBR implementation plan a no-code plan and says the
matching implementation has no code. Part A of matching is complete in the
repository and the BBR foundation is on `main`.

The index is the first file an agent is told to read, so these errors have more
impact than stale prose deep in a historical plan. The action pass corrected
the affected entries alongside the feature statuses.

### P2: The scenario plan has contradictory status lines

`PHASE8-scenario-query-engine.md` says the plan has not started. Its Phase 0
and Phase 1 sections say they are done or shipped, with the Phase 1 migration
and commit named. Phase 2 onward remains planned.

The action pass changed only the top status to "partly implemented" and named
Phase 2a as the next unbuilt phase. Its technical open questions do not require
an owner decision until that phase is selected for delivery.

### P2: There is no current product roadmap

`ROADMAP-2026-07.md` is useful product history and contains durable principles,
but it is not a current roadmap. It predates the scenario engine, unified
matching, release-email work and BBR holdings history. Root `README.md` still
calls it the current roadmap.

Keep the July file unchanged. Once the next priority is selected, add a short
dated roadmap that lists only active, next and deferred work. Avoid copying
the detailed implementation plans into it.

### P2: Old review findings can be mistaken for the backlog

The July and 20 August review documents are good point-in-time evidence. Their
counts and open-item lists are not a current issue tracker. Several findings
were later fixed, including application CI, local fonts, owner-anchor handling,
loading feedback and catalogue performance work.

Leave the reviews unchanged. Add no new response document. The index should
state that the review responses describe intent at their date and are not the
current backlog.

Two documented defects still appear live in the current source:

- `favourite_wine_view` counts linked release-offer rows without excluding
  owner-excluded evidence, so a Release chip can survive after its visible
  evidence is removed.
- CellarTracker still accepts `BeginConsume` and `EndConsume` value `9999` as
  a year, and its parser has no focused unit test.

These are engineering backlog items. They do not need a product decision.

### P3: A few entry-point descriptions are ageing

- Root `README.md` accurately describes the scanner and workflows, including
  the 08:17 to 23:17 UTC hourly schedule. The action pass corrected its labels
  for the July roadmap and review.
- `apps/web/README.md` is a sound setup and release guide. The action pass
  updated `/cellar/bbr` to the all-owned cellar and replaced the old matching
  route with `/matches`.
- `IMPORT-SOURCE-PROFILES.md` has a 31 July profile date even though its BBR
  recovered-export contract was updated on 5 September. The action pass split
  this into original-profile and last-verified dates.
- `CELLARTRACKER-IMPLEMENTATION.md` refers to a canonical BBR-held snapshot.
  The action pass changed this to BBR holdings history.

These are small status and wording fixes. None warrants a broader rewrite.

---

## Document register

### Current authority and operating instructions

| Document | Assessment | Action |
| --- | --- | --- |
| `AGENTS.md` | Current repository operating rules. It now includes the lean-design constraint and production incident controls. | Keep current when a new incident or repeated design failure changes how work should be done. |
| `apps/web/AGENTS.md` | Current Next.js version warning. | Keep. |
| `apps/web/CLAUDE.md` | Valid one-line pointer to the local agent rules. | Keep. |
| `ADR-001-single-owner-application.md` | Current accepted architecture decision. Current app ownership and RLS model still follow it. | Keep until the owner model changes. |
| `PERFORMANCE-DATA-BRANCH-VALIDATION.md` | Current safe procedure. It matches the dedicated workflow and prohibits production timing or equivalence tests. | Keep. Do not weaken the production boundary. |
| `DEPLOYMENT-INCIDENT-2026-08-27.md` | Valid incident record and source of current deployment rules. | Keep unchanged. |
| `DEPLOYMENT-INCIDENT-2026-08-28.md` | Valid incident record. It distinguishes established evidence from the disk-I/O hypothesis. | Keep unchanged. |
| `tests/fixtures/README.md` | Accurate provenance and limits for the Phase 1A API fixtures. | Keep with the fixtures. |

### Current entry points corrected by the action pass

| Document | Assessment | Action |
| --- | --- | --- |
| `README.md` | Scanner and workflow description is substantially current. Dated planning material is no longer labelled current. | Keep the abbreviated tree descriptive, not authoritative. |
| `apps/web/README.md` | Current development, authentication and deployment guide. BBR and matching route descriptions are corrected. | Update route descriptions with the feature that changes them. |
| `docs/README.md` | Useful index and lifecycle warning. False BBR, wine-record and matching statuses are corrected and this audit is linked. | Update entries with their feature status. |
| `IMPORT-SOURCE-PROFILES.md` | Current source contract, including recovered BBR exports. Original-profile and last-verified dates are now separate. | Retain individual sample dates. |

### Active product and engineering documents

| Document | Assessment | Action |
| --- | --- | --- |
| `BBR-HOLDINGS-HISTORY-EPIC.md` | Product intent remains valid. Status corrected during the action pass. | Keep as the user-story record. |
| `BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md` | Current product authority for snapshot roles, dates, ownership and price history. Status corrected during the action pass. | Retain as authority. |
| `BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md` | Useful constraints and original questions. Now labelled as pre-implementation analysis. | Keep as decision history. |
| `BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md` | Detailed design and implementation record. Opening and close-out status reconciled during the action pass. | Keep as the slice ledger and design record. |
| `WINE-RECORD-SPEC.md` | Useful mixed design record. Its opening now distinguishes implemented Parent-SKU work from deferred source-neutral identity. | Keep the compact status current when a numbered step ships. |
| `MATCHING-FUNCTIONAL-SPEC.md` | Part A is complete and now labelled accordingly. | Keep Part B separate. |
| `MATCHING-QUEUE-TRIAGE-SPEC.md` | Current record of the queue tiers, second-wine conflict and reverted coverage calculation. | Keep; consult the ledger before changing the metric. |
| `MATCHING-RECONCILIATION-SPEC.md` | Coherent unbuilt Part B design. It is correctly gated by product scope and latency decisions. | Keep deferred until the use case is prioritised. |
| `PHASE8-scenario-query-engine.md` | Current plan from Phase 2 onward. Its opening now records Phases 0 and 1 as implemented and Phase 2a as unscheduled. | Keep until the next roadmap decision. |
| `RELEASE-OFFER-INGESTION-SKILL.md` | Current draft contract grounded in Gmail evidence. No automated implementation exists. | Keep as a candidate feature, pending the three operating decisions below. |

### Implemented feature history

| Document | Assessment | Action |
| --- | --- | --- |
| `FAVOURITES-SPEC.md` | Valid build and decision history. Its release-evidence count defect still appears open. Other open points are optional product extensions. | Keep; move the defect to normal engineering backlog when one exists. |
| `CELLARTRACKER-IMPLEMENTATION.md` | Valid implemented-feature record. Its remaining-work section is still relevant but is not a current delivery plan. | Keep; correct the BBR wording and date any later verification. |
| `PHASE1.md` | Historical persistent-store proposal. Later implementation and incident documents take precedence. | Keep as history. |
| `PHASE1A-entity-model.md` | Historical API and entity validation with explicit fixture limits. | Keep as history. |
| `PHASE2-catalogue-browser.md` | Correctly marked implemented and explains where the saved-query design changed. | Keep as history. |
| `PHASE3-4-IMPLEMENTATION.md` | Detailed scanner and persistent-catalogue build record. It includes corrected deployment advice and measured caveats. | Keep as history, not as the current runbook. |
| `PHASE5-IMPLEMENTATION.md` | Valid original BBR and CellarTracker implementation history. Its new status note points BBR authority to the holdings-history specification. | Keep as history. |
| `PHASE7-IMPLEMENTATION.md` | Valid release-price implementation history. The favourite release-chip maintenance note still appears current. | Keep. |

### Dated reviews, decisions and test evidence

| Documents | Assessment | Action |
| --- | --- | --- |
| `DOCUMENTATION-AUDIT-2026-09-05.md` | This dated repository-wide review and action record. | Keep as the audit snapshot; use current feature documents for later status. |
| `BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-REVIEW.md`; `BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-SECOND-REVIEW.md` | Valid review history. Findings were answered by plan revisions and subsequent slices. | Keep unchanged and label as superseded gates in the index. |
| `MATCHING-FUNCTIONAL-SPEC-REVIEW.md`; `MATCHING-SPECS-SECOND-REVIEW.md` | Valid design-review history. Part A subsequently shipped; Part B remains gated. | Keep unchanged. |
| `RELEASE-OFFER-INGESTION-TEST-RUN-2026-09-03.md`; `RELEASE-OFFER-INGESTION-TEST-RUN-2-2026-09-03.md` | Valid supervised evidence. They correctly state that no database writes occurred. | Keep; close the named owner decisions if the feature proceeds. |
| `CODEBASE-REVIEW-2026-07-31.md`; `CODEBASE-REVIEW-2026-07-31-RESPONSE.md` | Valid dated review and 27 August recheck. The "12 open" result is not a current count. | Keep as history; do not use as the backlog. |
| `INDEPENDENT-REVIEW-2026-08-20.md`; `PERFORMANCE-REVIEW-2026-08-20.md`; `REPOSITORY-HEALTH-2026-08-20.md`; `REVIEW-RESPONSE-2026-08-20.md` | Valid review evidence and response at that date. Several accepted actions later shipped. | Keep as history; do not add another retrospective response. |
| `ROADMAP-2026-07.md` | Valid product rationale and July sequence. No longer current planning. | Retain as a dated roadmap and stop calling it current. |

Every tracked Markdown file in the repository is covered above.

---

## Views needed from the owner

### Needed to set the next roadmap

With Slice 8 closed, choose one next product theme. The current documents
contain three plausible branches:

- continue the scenario query engine from Phase 2;
- automate release-offer email ingestion; or
- build matching Part B to react when release evidence gains a live ask.

Recommendation: do not choose by document age. Pick the next real decision or
repeated manual task. Until then, mark all three deferred. This avoids three
simultaneous "active" plans.

### Needed only if release-email ingestion proceeds

The second supervised run leaves three real decisions. The lean defaults are:

1. Capture bulk back-vintage lists but route that shape around routine manual
   review.
2. Hold out the contradictory Ch. Margaux row rather than add a new flagged-row
   state for one case.
3. Handle the Prager invoice-in-reply shape manually until recurrence justifies
   a second extractor.

These decisions should be written into the ingestion specification before an
automation is built.

### Needed only if matching Part B proceeds

The document asks for scope and latency. The lean defaults are release offers
only and the daily sweep cadence. A faster transition feed should require
evidence that a daily delay loses useful opportunities.

### No owner view needed now

The following are recorded open questions but should not interrupt product
work:

- scenario materialisation and enum-option source;
- favourite navigation grouping and format-level favourites;
- CellarTracker parser tests and sentinel-year handling;
- the favourite release-chip defect; and
- moving historical documents into an archive directory.

The first two should wait for the feature that needs them. The next two are
small engineering backlog items. The last is filing work with no current
payback.

---

## Documentation close-out applied after Slice 8

The action pass made the following bounded changes:

1. Updated the status blocks in the four BBR history documents without making
   an unverified deployment claim.
2. Retained the plan amendment that defers Slices 9 and 10 and removes Slice
   11.
3. Updated the BBR and unified matching route wording in `apps/web/README.md`.
4. Corrected the BBR, wine-record, matching, roadmap and review entries in
   `docs/README.md`.
5. Stopped calling `ROADMAP-2026-07.md` and the July codebase review current in
   root `README.md`.
6. Corrected the source-profile dates, scenario-plan status, CellarTracker BBR
   description and Phase 5 supersession note.

No historical review was rewritten and no archive move was made. A new roadmap
still waits for the next product-priority decision.
