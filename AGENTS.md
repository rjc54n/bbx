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
- **Delete throwaway database objects (verification schemas, temp tables) the
  moment they are done with.** A leftover `perfcheck`-style schema on
  production is both clutter and a sign the rule above was bent.

## Recovering the production instance after an incident

The project runs on a free-tier Supabase instance with no I/O or memory
headroom. Learned from the 28 August 2026 outage
([docs/DEPLOYMENT-INCIDENT-2026-08-28.md](docs/DEPLOYMENT-INCIDENT-2026-08-28.md)):

- **A restart is not a recovery.** A green dashboard / `ACTIVE_HEALTHY` health
  endpoint says nothing about whether the instance has recovered working
  capacity. After any instance-level incident, confirm it: a trivial query
  returns in milliseconds, recent checkpoint `write`/`sync` timings in the
  logs are back to normal, and the disk-I/O metric has come down. Re-check a
  few hours later.
- **Treat ~02:00–05:00 UTC as a must-be-healthy window.** The daily physical
  backup runs near 03:00 UTC and cannot be moved on the free plan; on the
  working hypothesis for the 28 August outage it can compound an
  already-degraded instance. If the instance looks degraded in the evening,
  restart it before 02:00 UTC. Do not start diagnostic or verification work in
  that window.
- **If the instance is degraded, capture state before restarting** —
  `pg_stat_activity`, connection counts, `SELECT now()` latency, and the
  dashboard CPU / memory / disk-IO values. A restart wipes `pg_stat_*` and the
  high-resolution metrics, which is why the 28 August root cause stayed a
  hypothesis.
- **Postgres GUCs are not incident-response tools.** Changing `wal_compression`
  or any parameter under load, without a hypothesis that predicts the specific
  symptom, just adds a variable.

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
