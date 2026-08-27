# Deployment incident, 27 August 2026

This records what went wrong deploying the catalogue materialised read-model
change ([PR #10](https://github.com/rjc54n/bbx/pull/10)), so the same mistakes
are not repeated. The change itself was correct and is now live and verified
faster; this document is about how getting it there cost more time, more
tokens, and one avoidable production incident than it should have.

## What happened, in order

1. The migration and web-app changes were built, reviewed against production
   data in an isolated `perfcheck` schema, and merged to `main`. CI was green.
2. Verifying a late fix (the release-anchor `MATERIALIZED` CTE) required
   re-running the `perfcheck` script. The first attempt's HTTP response to the
   Supabase Management API failed ambiguously (a connection timeout). Rather
   than checking whether that attempt was still executing server-side, a
   second attempt was sent. Both ran concurrently, disagreeing over the same
   throwaway schema objects, for several minutes before being noticed.
3. That contention held locks long enough that PostgREST's own schema-cache
   reload query started timing out, which put the live API layer into a
   reconnect loop and produced real 503s on production traffic
   (`Unhealthy` in the Supabase dashboard). This was fixed with a project
   restart — safe, but avoidable.
4. Once the app was confirmed healthy, the PR was merged. Merging deployed the
   new web app code to Vercel immediately. **It did not apply the new database
   migrations** — nobody had checked whether merging to `main` does that, and
   it doesn't; Supabase migrations are applied separately, with
   `supabase db push`. For a window, the deployed app was running code that
   queried views and materialised views that did not exist yet.
5. This surfaced as `/cellartracker` timing out and crashing for a real user.
   The fix was `supabase db push --linked`, which applies cleanly without
   Docker (Docker is only needed for local `db start` / `test db`, not `push`).

Steps 2–3 and step 4 are two independent failures. Both were avoidable, and
both are cheap to prevent going forward.

## Root causes

**An unverified assumption about deployment.** The plan's acceptance gate was
"CI green, `perfcheck` all PASS, merge." Nobody confirmed what merging
actually does to the database. `supabase migration list --linked` would have
shown the answer for free, at planning time, before any code was written.

**Retrying against production after an ambiguous failure.** A network-level
error (timeout, HTTP/2 framing error, empty reply) from a request that may
have reached the server is not the same as a failure that clearly didn't. The
correct response is to check server-side state with a cheap, read-only,
non-schema-touching query before deciding whether to resend — never to resend
a schema-mutating script on the assumption the first attempt failed cleanly.
This was the direct cause of both the original retry-loop incident earlier in
the same session and the concurrent-run incident that restarted the project;
the lesson from the first was not applied to the second.

**Verification ran directly against the live database.** Every incident
tonight traces back to testing — proving row-equivalence, timing queries —
against production, because that's where the real data is. A Supabase data
branch (a disposable, real copy of production) would have made every one of
these incidents impossible, because none of that testing would have touched
the live system. This was raised as a question at the start of the work
("does a dedicated project make branching easier?") and not pursued.

**Hand-rolled tooling instead of the installed CLI.** All production database
access used a manually constructed `curl` call to the Supabase Management API
(reading a token from Keychain, hand-escaping SQL into JSON). The `supabase`
CLI was already installed and already linked to this project, and turned out
to be the more reliable path for the one action that mattered most
(`db push`). The curl approach was also more prone to tripping the
environment's permission checks than the equivalent CLI subcommand.

## Rules adopted from this

1. **Merge is not deploy.** Merging a PR to `main` deploys the web app to
   Vercel; it does not apply Supabase migrations. Applying migrations to
   production is a distinct, deliberate step: `supabase db push --linked`
   (no Docker required). Before calling any database-schema change "shipped,"
   confirm which of these has actually happened.
2. **Never retry a mutating request against production after an ambiguous
   failure.** Timeout, framing error, and empty reply are not proof the
   server didn't act on the request. Check first (a cheap, read-only,
   non-mutating query against `pg_stat_activity` or equivalent); only resend
   once the prior attempt is confirmed gone.
3. **Check for a data-branching option before running any row-equivalence or
   timing verification that needs real data.** Prefer a disposable branch
   over touching the live database. If branching isn't available on the
   project's plan, that's a deliberate, stated trade-off going in — not a
   default arrived at by not asking.
4. **Prefer the `supabase` CLI over hand-rolled Management-API calls** for
   production database work. Check what's already installed and linked
   before reaching for `curl`.
5. **Ship read-model-sized changes as independently deployable slices** —
   one migration, pushed and smoke-tested, before layering the next — rather
   than batching several migrations and app changes into one PR merged and
   deployed atomically. This shrinks blast radius and would have caught the
   deploy-mechanism gap on the first, smallest slice instead of after the
   full batch.

## What this wasn't

Model capability was not the driver of the cost here. The expensive parts of
this session were retries and incident recovery, not reasoning depth on the
mechanical steps (migration boilerplate, test-file edits, JSON-escaped curl
payloads) — a smaller/cheaper model making the same retry-after-ambiguous-
failure mistake would have been just as disruptive, only cheaper per call.
Where deeper reasoning earned its cost was reading an `EXPLAIN` plan to find a
1,018× nested-loop misestimation, and reversing an earlier, untested
assumption after measuring it was wrong. That split — high-effort reasoning
for planning, anomaly diagnosis, and deploy/merge gating; a cheaper tier for
scaffolding once the plan is set — is worth deliberately choosing next time,
rather than running one model for the whole task.
