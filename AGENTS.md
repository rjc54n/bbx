# Agent instructions for this repository

Read this before making changes. It records operational rules learned from
real incidents in this repo, not general advice — each one cost real time or
caused a real production problem when it wasn't followed.

For what the project does and how it's structured, start with
[README.md](README.md) and [apps/web/README.md](apps/web/README.md). For
design decisions, specs, and dated reviews, see the index at
[docs/README.md](docs/README.md).

## Database deployment

**Merging to `main` is not the same as deploying the database.** Merging a PR
deploys the Next.js app to Vercel immediately. It does **not** apply pending
Supabase migrations — that is a separate, deliberate step:

```bash
supabase db push --linked
```

(The CLI only needs Docker for local `db start` / `test db`, not for `push`.)

Before treating any schema change as shipped, or before merging a PR that
depends on new migrations matching new app code, check what's actually
applied:

```bash
supabase migration list --linked
```

A migration's `remote` column blank means it isn't live yet. Never infer
"deployed" from "merged" — confirm each separately. This exact gap took the
CellarTracker page down in production on 27 August 2026; see
[docs/DEPLOYMENT-INCIDENT-2026-08-27.md](docs/DEPLOYMENT-INCIDENT-2026-08-27.md).

## Working against the production database

- **Never retry a request against production after an ambiguous failure**
  (connection timeout, HTTP/2 framing error, empty reply — anything that
  doesn't prove the server never ran it), especially if it's schema-mutating.
  Check server-side state first (a cheap, read-only query against
  `pg_stat_activity` or equivalent) before deciding whether to resend.
- **Prefer the `supabase` CLI over hand-rolled `curl` calls** to the
  Management API for any production database work — it's already installed
  and linked to this project, and is more reliable.
- **Before running row-equivalence or timing verification that needs real
  data, check whether a Supabase data branch is available** and use it
  instead of the live database. If none is available, that's a deliberate,
  stated trade-off, not a default reached by not asking.
- Ship database-migration-sized changes as independently deployable slices —
  one migration, pushed and smoke-tested, before the next — rather than
  batching several into one PR merged and deployed atomically.

## Domain facts worth knowing before touching pricing logic

- The pipeline finds **candidates for human review**, not executed trades.
  Pragmatic tolerances are correct here; do not over-engineer for perfect
  precision at the expense of clarity or speed.
- The BBX "guide price" (`market_price`) *is* the Liv-ex price, scaled
  linearly by format volume. It is not an independent check against Liv-ex —
  treating it as one double-counts the same signal.
- Arbitrage pricing (ask / market / next-lowest / label) is resolved per
  `(parent_sku, format_code)`, never from `entries[0]` of a REST response,
  which is an arbitrary format. A magnum's price must never be attributed to
  a case, or vice versa.
- `prod_biddable` is a separate ~52k-record Algolia index from the full BBX
  book, with its own per-record change stamp — do not assume it shares
  cadence or completeness with the general catalogue search index.

## Working with the project owner

- Confirm architecture, UX, and default-behaviour decisions **before**
  building, not just before merging. Approval of a migration or a plan is not
  the same as approval of the UX/design choices inside it — ask explicitly
  when a decision has more than one reasonable answer.
- Default to committing small, low-risk fixes straight to `main`. Reach for a
  branch and PR only when there's a stated reason (a large or risky change,
  or the owner asks for review) — and get explicit permission first.
