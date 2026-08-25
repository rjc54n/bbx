# Response to the independent reviews, 20 August 2026

This document responds to the three reviews commissioned on 20 August 2026:

- [Independent implementation review](INDEPENDENT-REVIEW-2026-08-20.md)
- [Response-time review](PERFORMANCE-REVIEW-2026-08-20.md)
- [Repository health review](REPOSITORY-HEALTH-2026-08-20.md)

It records which findings we accept, where we differ, what we verified for
ourselves, and the order in which we intend to act. The plan is approved to
proceed subject to the implementation constraints set out below, which are folded
in throughout. It is a plan for review, not a completed change log. No code or
data has been changed yet.

## Summary position

We accept the reviews. They are accurate where we can check them, and their
central framing is correct: the recent work is a sound **canonical presentation
record** for biddable wines, not a source-neutral golden record, and that is an
acceptable state for a prototype provided it is labelled honestly. Nothing in the
reviews calls for a redesign. The work list is two real correctness faults, one
real analytics performance path, and a set of hygiene items.

We independently reproduced the two priority-one correctness faults from source
before accepting them (see next section). That gives us confidence in the
findings we could not cheaply reproduce read-only — the performance timings and
the database adviser counts — and we are treating those as reliable.

## What we verified ourselves

The reviews are careful to state that they did not exercise the signed-in
deployed application. We take that caveat seriously: the catalogue fault below is
exactly the kind of defect that local unit tests passed straight over. Our
acceptance gate for these fixes will therefore be a signed-in smoke check, not a
green local test run alone.

### Finding P1-1, owner prices do not reach the catalogue — confirmed

`fetchCatalogue.ts` enriches catalogue rows from `release_price_anchor_view`,
which holds imported anchors only. The owner-aware view is
`resolved_release_anchor_view`. The catalogue was never repointed onto it.

The owner-anchor migration's own header comment claims that "the catalogue
arbitrage, favourites and the wine card all reflect the owner price", but only
`release_price_market_view` and `wine_card_format_view` were actually repointed.
The claim in the migration comment and in the specification is real drift, not a
documentation nicety. The applied migration file will not be edited; the drift is
corrected in the specification and README separately, and the corrective
behaviour lands in a new migration.

### Finding P1-2, tax basis is discarded — confirmed

`owner_release_anchors` stores `tax_basis` (`in_bond`, `duty_paid`, `unknown`),
but `resolved_release_anchor_view` never selects the column, so every downstream
ask-versus-release and bid-versus-release metric is computed without regard to
tax treatment.

We add one observation the reviews do not draw out: **these two faults interact.**
Because the catalogue currently reads the imported view, it never sees owner
anchors at all, so today the tax-basis exposure is confined to the wine card and
scenarios. The moment we fix P1-1 and the catalogue starts reading owner anchors,
we activate the tax-basis risk on the catalogue as well. The two fixes must ship
together. The reviews' recommended order already pairs them; we are keeping that
pairing for this reason.

## Response to each finding

Priority labels are the reviews' own. "Our response" states what we intend to do.

| Finding | Source | Our response | Notes |
|---|---|---|---|
| Owner release prices do not reach the catalogue | Impl P1 | Accept in full | Repoint `fetchCatalogue.ts` to `resolved_release_anchor_view` and use that view everywhere an owner price should appear; return `anchor_status`; regression test across catalogue, favourites, wine card, scenarios and release-price detail |
| Tax basis discarded before comparisons | Impl P1 | Accept, in-bond-only | Enforce in-bond at all four layers — form, server action, RPC and a database constraint (via new migration) — rather than threading `tax_basis` through four views for a one-record prototype. The current live owner row is already in bond. Add rejection tests for non-in-bond input. Revisit when a real duty-paid workflow exists |
| Scenario queries use a costly layered view plus exact counts | Impl P1 / Perf | Accept the direction | Two steps. (1) Stop the broad query before it executes when filters are empty — a post-execution warning does not help response time. (2) Do not remove the exact count without replacing the pagination contract: use `has_more`, cursor pagination or a clearly labelled estimate |
| Out-of-range pages not reliably clamped | Impl P2 | Accept | Clamp from returned count; apply to scenario, release-price and CellarTracker routes |
| No protected `loading.tsx` / navigation feedback | Impl / Perf | Accept, promote earlier | Biggest perceived-speed lever and cheap; we rank it above some database work. Treated as navigation feedback, not a database performance fix |
| Approximate counts look exact | Impl P2 / Perf | Accept | Prefix estimates with `~` or "About"; reserve exact wording for maintained counts |
| Three owner lookups per navigation | Perf | Accept | React `cache` deduplicates only the layout and page checks. To reach one lookup per render, also remove the `app_owners` query from the proxy. Keep server data-access checks and RLS authoritative |
| Documentation drift (spec status, web README routes, "saved queries" naming) | Impl P2 / Repo | Accept | Add an implemented-vs-planned status table; correct the route table and access boundary; call the prototype "saved queries" until versioning and an output contract exist |
| Wine page assembles seven sources in TypeScript | Impl P3 / Perf | Keep for now | Agree with the reviews: do not build the consolidated read model until precedence rules settle |
| No web / Python pull-request CI | Repo | Accept, high priority | Our green Actions runs are scheduled production jobs, not PR checks, so application code currently merges unvalidated. Add required web and Python PR jobs. Self-host Geist before the production build becomes a required check, or accept that CI keeps an external font-download dependency |
| Four high-severity npm advisories | Repo | Accept, with care | Update on a branch with a signed-in smoke test. Do not run a blind `npm audit fix` — it would pull a Next.js bump |
| Mutable function search path; leaked-password protection off | Repo | Accept | Quick, real security wins |
| Non-reproducible build (Geist font over network) | Repo | Accept | Self-host with `next/font/local` |
| 46 `SECURITY DEFINER` functions; 23 unindexed foreign keys; 5 unused indexes | Repo | Accept as triage, not as a bug list | The reviews say the same. We will triage from measured workloads and delete paths, not index all 23 mechanically |
| Generalise the public-view security test | Repo | Accept | Compare all app-owned public views against an explicit exception list so a new view cannot silently omit invoker security |

### Where we differ from the reviews

We do not disagree with any finding. We differ on **scope** in two places, in both
cases choosing less work than the maximal option the reviews offer:

- **Tax basis.** We will restrict owner writes to in-bond rather than carry
  `tax_basis` through `resolved_release_anchor_view`,
  `release_price_market_view`, `wine_card_format_view` and
  `wine_scenario_view`. The reviews present in-bond-only as the "smallest safe
  fix", so this is within their recommendation. Threading a field through four
  views is more surface than a prototype with a single live owner anchor
  warrants.
- **Foreign-key indexes.** We will treat the 23 unindexed foreign keys as a
  review list driven by real plans and delete/update paths, not as 23 changes to
  make. Again the reviews explicitly endorse this restraint.

Everything else is accepted at the scope described.

## Agreed implementation constraints

The following constraints are accepted and govern how the plan is executed. They
supplement, and where stricter override, the finding table above.

- **Ship P1-1 and the in-bond restriction together.** Use
  `resolved_release_anchor_view` everywhere an owner price should appear.
- **Enforce in-bond at every layer.** The form, the server action, the RPC and a
  database constraint must all reject non-in-bond input, not just the RPC. The
  current live owner row is already in bond, so no data migration of existing
  rows is required.
- **Test conflicting imported and owner prices across all five surfaces:**
  catalogue, favourites, wine card, scenarios and release-price detail.
- **Do not edit previously applied migration files.** Database changes go in a
  new migration. Specification and README corrections are made separately, as
  their own change.
- **Regenerate Supabase TypeScript types** after any database-contract change.
- **Do not remove the exact scenario count without replacing the pagination
  contract.** Acceptable replacements are `has_more`, cursor pagination, or a
  clearly labelled estimate.
- **The empty-filter guard must stop the broad query before it executes.** A
  warning shown after the query has run does not improve response time and does
  not satisfy this constraint.
- **One owner lookup per render requires removing the proxy `app_owners` query.**
  React `cache` alone only deduplicates the layout and page checks. Server
  data-access checks and row-level security remain authoritative.
- **Loading states are feedback, not a performance fix.** They are added early
  but are not counted against the analytics database targets.
- **A materialised analytics view, if chosen, needs its refresh behaviour defined
  first** — for both imports and owner edits — before it is built. A lean ordinary
  view or RPC may be the simpler first step.
- **Keep the canonical presentation model.** No generic facts framework and no
  source-neutral identity work as part of these fixes.
- **Keep changes reviewable as separate commits** where practical: application
  changes, migration changes and documentation updates apart.

## Planned order of work

Both the implementation review and the repository-health review independently
converge on nearly the same order. We adopt it with one adjustment: protected
loading states move earlier, because they are the cheapest large win for
user-visible responsiveness.

1. **Correctness pair.** Fix P1-1 and P1-2 together in a new migration plus the
   application change, with in-bond enforced at form, server action, RPC and
   database constraint. Add the cross-surface regression test over catalogue,
   favourites, wine card, scenarios and release-price detail, plus rejection
   tests for non-in-bond input. Regenerate Supabase types. The specification and
   README corrections are a separate change; the applied migration is not edited.
2. **Perceived speed.** Add a protected-area `loading.tsx` and route skeletons
   for scenarios, wine and release prices, as navigation feedback.
3. **Change validation.** Add required web (`npm ci`, lint, test, build) and
   Python (`pytest`) pull-request jobs, keeping database validation separate.
   Self-host Geist before the build step becomes required, or record that CI
   retains the external font-download dependency.
4. **Analytics read path.** First stop the empty-filter scenario query before it
   executes, and replace the exact count with a `has_more`, cursor or
   clearly-labelled-estimate pagination contract. Then, only if a materialised
   read model is chosen, define its import and owner-edit refresh behaviour
   before building it; a lean ordinary view or RPC may come first. Indexes are
   chosen from real plans.
5. **Smaller correctness and clarity.** One owner lookup per render — including
   removing the proxy `app_owners` query, not only the React `cache` wrap; page
   clamping across the three affected routes; approximate-count wording.
6. **Security and dependencies.** Fix the mutable function search path and enable
   leaked-password protection; then update the four flagged dependencies on a
   branch behind a signed-in smoke test.
7. **Documentation.** Reconcile the wine-record specification (implemented versus
   planned status table), the web README route table and access boundary, and
   the "saved queries" naming.
8. **Ongoing triage.** Foreign-key indexes, unused indexes and the
   `SECURITY DEFINER` function list, worked from measured workloads rather than
   in one pass.

## Acceptance gates

Gates are separated per work item, and local validation is never described as
deployed verification:

- **Release-price correctness** — signed-in cross-surface checks: catalogue,
  favourites, wine card, scenarios and release-price detail all show an owner
  price that differs from the import.
- **In-bond restriction** — rejection tests confirm non-in-bond input is refused
  at form, server action, RPC and database-constraint layers.
- **Loading states** — navigation feedback observed on the deployed protected
  routes before the server response arrives.
- **Analytics** — fresh database timings against representative data, including
  the empty-filter path, taken after the change.
