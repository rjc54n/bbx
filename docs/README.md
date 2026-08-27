# Documentation index

Most of these are dated, point-in-time documents, not living references —
check the date and status line at the top of each before trusting a specific
claim against current code. Where a doc's own status looks stale, that's
noted below rather than silently corrected, since confirming it properly
means checking against current code, not just the doc.

## Start here

- [`../README.md`](../README.md) — project overview, the scan pipeline, repo
  layout, configuration and running instructions.
- [`../apps/web/README.md`](../apps/web/README.md) — Next.js/Supabase app:
  local dev, checks, owner bootstrap, Vercel release.
- [`../AGENTS.md`](../AGENTS.md) — operational rules for anyone (human or
  agent) making changes here, distilled from real incidents.

## Design decisions and specs

Living-ish references for how things are meant to work. Still check them
against the current migrations/code for anything load-bearing.

- [ADR-001-single-owner-application.md](ADR-001-single-owner-application.md)
  — accepted decision record: this is a single-owner application, not
  multi-tenant.
- [WINE-RECORD-SPEC.md](WINE-RECORD-SPEC.md) — canonical wine record
  (`wine_ref` + owner facts) design. Marked "draft for review, no code yet"
  at last edit — confirm current status before relying on it.
- [FAVOURITES-SPEC.md](FAVOURITES-SPEC.md) — favourites functional spec.
  Marked "built and pushed" with the landing commits listed.
- [IMPORT-SOURCE-PROFILES.md](IMPORT-SOURCE-PROFILES.md) — observed CSV
  contracts for the BBR and CellarTracker import sources (source files
  themselves are private and stay outside git).
- [CELLARTRACKER-IMPLEMENTATION.md](CELLARTRACKER-IMPLEMENTATION.md) —
  CellarTracker import, matching and comparison. Explicitly says its
  deployment statements are dated observations to be checked against the
  live migration ledger before release.

## Roadmap

- [ROADMAP-2026-07.md](ROADMAP-2026-07.md) — product roadmap revised 31 July
  2026, framed around the project's actual purpose (running a drinking
  cellar; trading funds the drinking).

## Phase implementation history

A historical build log, phase by phase. Useful for *why* something is shaped
the way it is; not a reliable source for *whether* it shipped as described —
several predate the 20 August and 27 August review/incident docs below,
which found and corrected real drift between what phase docs claimed and
what the deployed code did.

- [PHASE1.md](PHASE1.md) — persistent scan store, plain-language explainer.
- [PHASE1A-entity-model.md](PHASE1A-entity-model.md) — entity model & API
  validation.
- [PHASE2-catalogue-browser.md](PHASE2-catalogue-browser.md) — catalogue
  browser plan, confirmed implemented (status line verified against current
  code 27 August 2026; saved queries shipped as the larger server-side
  "Saved Scenarios" feature rather than the browser-local version planned
  here).
- [PHASE3-4-IMPLEMENTATION.md](PHASE3-4-IMPLEMENTATION.md) — persistent
  catalogue and scanner.
- [PHASE5-IMPLEMENTATION.md](PHASE5-IMPLEMENTATION.md) — cellar holdings and
  history (BBR + CellarTracker).
- [PHASE7-IMPLEMENTATION.md](PHASE7-IMPLEMENTATION.md) — BBR release prices.

## Reviews and incident reports

Point-in-time snapshots. Read the date; do not assume a finding is still
open or still fixed without checking.

- [CODEBASE-REVIEW-2026-07-31.md](CODEBASE-REVIEW-2026-07-31.md) — defects
  and maintenance order as of 31 July 2026. See
  [CODEBASE-REVIEW-2026-07-31-RESPONSE.md](CODEBASE-REVIEW-2026-07-31-RESPONSE.md)
  for the 27 August 2026 check against current code: 2 of 14 items fixed, 12
  still open.
- [INDEPENDENT-REVIEW-2026-08-20.md](INDEPENDENT-REVIEW-2026-08-20.md),
  [PERFORMANCE-REVIEW-2026-08-20.md](PERFORMANCE-REVIEW-2026-08-20.md),
  [REPOSITORY-HEALTH-2026-08-20.md](REPOSITORY-HEALTH-2026-08-20.md) — three
  independent reviews commissioned 20 August 2026 (implementation
  correctness, response-time, and repository health respectively).
- [REVIEW-RESPONSE-2026-08-20.md](REVIEW-RESPONSE-2026-08-20.md) — the
  project's response to the three reviews above: what was accepted, what was
  disputed, and the resulting work plan.
- [DEPLOYMENT-INCIDENT-2026-08-27.md](DEPLOYMENT-INCIDENT-2026-08-27.md) —
  the catalogue-read-model deployment incident: root causes and the rules
  adopted from it (also folded into [`../AGENTS.md`](../AGENTS.md)).
