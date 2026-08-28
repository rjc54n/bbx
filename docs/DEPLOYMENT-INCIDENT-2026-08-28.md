# Deployment incident, 28 August 2026

This is the second production incident in 24 hours, and it is a direct
consequence of the first. The
[27 August incident](DEPLOYMENT-INCIDENT-2026-08-27.md) was declared resolved
on the evening of the 27th after a project restart put the Supabase dashboard
back to green. It was not resolved. The database instance stayed degraded
overnight, and roughly nine hours later — around the time the routine nightly
backup ran — it went from "slow" to "unreachable." Production — the web app,
the API, auth and storage — was effectively down from the early hours of the
28th until a second restart at 07:21 UTC.

All times below are UTC. The timeline and the ruled-out causes are established
from the project's own Postgres logs and post-recovery inspection of the live
database. The causal mechanism tying it all together is a **working
hypothesis**, not a confirmed root cause — see that section below for what
could not be checked.

## What happened, in order

1. **27 Aug 17:41–17:44** — Postgres was restarted to recover from the 27
   August incident (`database system was shut down at 2026-08-27 17:41:05`,
   then `ready to accept connections` at 17:44:17). The dashboard health
   endpoint went green and the incident was treated as closed.

2. **27 Aug ~18:00 onward** — the instance was not actually healthy. From
   18:00 the logs show a continuous stream of `canceling statement due to
   statement timeout`, trivial catalog queries (`SELECT pg_database_size(...)`)
   taking 15–40 seconds, checkpoints writing a handful of buffers in 15–270
   seconds, and `autovacuum worker took too long to start; canceled` /
   `autovacuum worker started without a worker entry`. This pattern is
   consistent with an instance starved of disk I/O rather than a specific slow
   query. It continued unattended through the night.

3. **28 Aug 01:16 and 04:35** — two Postgres configuration reloads from
   another working session changed `wal_compression` (`off` → `on`, then
   `on` → `zstd`). This was an attempt to relieve the instance. It was the
   wrong lever, changed under load with no supporting hypothesis, and had no
   measurable effect.

4. **28 Aug ~03:09** — the routine daily physical base backup began
   (`pg_backup_start`, which alone took 27 seconds because it forces a
   checkpoint). A base backup is a full sequential read of the data volume
   shipped to object storage — a sustained I/O load, running here against an
   already-degraded instance.

5. **28 Aug 03:09–07:20** — the degradation deepened to the point of
   unreachability. `pg_database_size('postgres')` took 82.9 seconds at 03:46.
   Every subsystem that needs the disk or a connection starved: the
   checkpointer, autovacuum, the dashboard's size widgets, and — the symptom
   that made it look like a multi-service outage — the connection pooler's
   auth lookup
   (`SELECT * FROM pgbouncer.get_auth('supabase_storage_admin')` took 41
   seconds at 07:16). With auth lookups timing out, no service could open a
   new connection, so the Management API health check reported `db`, `auth`
   and `storage` all `UNHEALTHY` ("Failed to connect to database"). That was
   one underlying failure strangling the shared auth path, not three
   independent service failures.

6. **28 Aug ~06:57** — the owner noticed the outage (dashboard showing the
   database backend unhealthy) and diagnosis began.

7. **28 Aug 07:21:10** — a second restart. The backup had long since
   finished, I/O contention cleared, and the instance came back healthy and
   has stayed healthy since (≈10 idle connections, no stuck queries).

## What was ruled out (established)

Directly checked against the recovered instance, all negative:

- **No out-of-memory event, no crash.** The 07:21 restart was deliberate, not
  crash recovery; there are no OOM / signal / `terminating` lines in the logs.
- **No bad or unapplied migration.** `migration list` shows local and remote
  identical through `20260827130000`; the new matviews exist in `public`.
- **No table bloat worth the name.** Worst case `private.products` at 24 MB of
  waste, bloat factor 2.3; everything else KB to low single-MB.
- **No dead-tuple backlog.** Zero dead rows on every table post-recovery.
- **No disk-space problem.** Database 374 MB, WAL 128 MB, disk 34% used.
- **No runaway replication slot, no pg_cron job, no connection exhaustion**
  (≈10 of 60 connections in use, all idle, after recovery).
- **No mis-tuned configuration.** Postgres is the stock Supabase ~1 GB profile
  (`shared_buffers` 224 MB, `work_mem` 2 MB, `max_connections` 60). The only
  non-default settings are the `wal_compression` change from step 3 and
  aggressive per-role statement timeouts (`anon` 3 s, `authenticated` 8 s)
  from an earlier hardening session — neither of which explains the symptom.

## Working hypothesis (not confirmed)

The best-supported explanation, consistent with every symptom and every
ruled-out cause above, is a **disk-I/O starvation spiral** that the 27 August
incident started and the 17:44 restart did not clear:

1. A free-tier Supabase instance is understood to have a small baseline
   disk-throughput allowance with a burst budget on top; sustained heavy I/O
   depletes the budget and throttles the instance toward baseline. The 27
   August incident's workload — two concurrent `perfcheck` verification runs,
   200-second catalogue-wide equivalence scans, and the initial build of the
   new catalogue materialized views — is exactly that kind of load.
2. A restart clears stuck connections but would not refill an I/O budget;
   that only recovers while the instance is near idle, and it never was (the
   dashboard was left open polling, Vercel kept serving traffic, PostgREST
   kept reconnecting). So the instance stayed throttled.
3. The nightly base backup (~03:09) added a sustained full-volume read on top
   of an instance with no margin, pushing it from "slow" to "unreachable" and
   making the degradation self-sustaining until the 07:21 restart.

### Why this is a hypothesis and not established

- **The free-tier disk-I/O budget is not exposed** on the dashboard or the
  Management API, so its depletion and recovery could not be observed
  directly. The dashboard's "Disk IO 99%" reading is suggestive but its exact
  accounting is undocumented.
- **The overnight process, memory and per-query state is gone** — the 07:21
  restart wiped `pg_stat_*` and the metrics history at that resolution. What
  tipped the instance from degraded-but-limping into unreachable (the backup,
  a PostgREST schema-cache reload loop, memory pressure, or some combination)
  cannot now be separated.
- The chain is inference from symptom shape and timing correlation, not from
  a metric that shows the mechanism.

### What would confirm or refute it

- If it recurs: capture `pg_stat_activity`, `pg_stat_bgwriter`, connection
  counts and `SELECT now()` latency **before** restarting, and note the
  dashboard CPU / memory / disk-IO values at that moment.
- Watch the disk-IO metric across a normal night (healthy instance, backup
  running) to establish what "backup overlap" looks like when it is a
  non-event, as a baseline to compare a bad night against.
- Watch the first daily sweep that runs with the new materialized read model
  (see rule 6) — if its `REFRESH` alone drives disk-IO to saturation, that
  strengthens the I/O-budget reading and identifies the recurring risk.

## Why the impact was this severe

- **A green dashboard was accepted as proof of recovery.** The Supabase
  control plane reporting healthy, and the health endpoint returning
  `ACTIVE_HEALTHY`, says nothing about whether the instance has recovered
  working capacity. Nobody re-checked query latency or checkpoint timings
  after the 27 August restart, and nobody looked again that evening.
- **It failed unattended, overnight, in the one window that guarantees a
  heavy background job.** The degradation began at 18:00 and had nine hours
  to get worse before the ~03:00 backup, after which it was fully unreachable.
  By the time it was noticed the outage was ~13 hours old.
- **There is no headroom to fail into.** One ~1 GB instance runs Postgres,
  PostgREST, GoTrue, Storage, Supavisor, the metrics exporter and pg_net. A
  transient I/O spike on a healthy instance is absorbed; the same spike on a
  degraded instance has nowhere to go.

## Rules adopted from this

1. **A restart is not a recovery.** After any instance-level incident, confirm
   the instance has recovered *working capacity*, not just that a health
   endpoint is green: run a trivial query and check it returns in
   milliseconds, check the most recent checkpoint's `write`/`sync` timings in
   the logs, and watch the disk-I/O metric come back down. Re-check again a
   few hours later, and always before the nightly backup window.

2. **Treat ~02:00–05:00 UTC as a must-be-healthy window.** The daily physical
   backup runs around 03:00 UTC and cannot be moved on the free plan. If the
   instance looks degraded at any point in the evening, restart it before
   02:00 UTC rather than letting it limp into the backup. Do not start
   diagnostic or verification work in that window.

3. **No verification, timing or equivalence workload against the production
   instance, ever.** This is now the root of two consecutive incidents. Use a
   Supabase data branch (see
   [PERFORMANCE-DATA-BRANCH-VALIDATION.md](PERFORMANCE-DATA-BRANCH-VALIDATION.md))
   or a throwaway project. If neither is available, the change waits.

4. **Delete throwaway database objects the moment they are done with.** The
   `perfcheck` schema from the 27 August verification sat on production for a
   full day and was still there during this incident. A leftover verification
   schema is both clutter and a signal that rule 3 was bent.

5. **Postgres GUCs are not incident-response tools.** Changing
   `wal_compression` (or any parameter) under load, without a hypothesis that
   predicts the specific symptom, just adds a variable to an already-confused
   picture.

6. **Make the sweep's read-model refresh cheap enough to overlap the backup
   safely.** The daily sweep must run in BBX's low-traffic overnight window
   (it makes thousands of third-party API calls; running it in their business
   hours is not acceptable), and GitHub Actions drifts it unpredictably across
   00:00–05:00 UTC, so overlap with the ~03:00 backup is structural and cannot
   be scheduled away. The mitigation is to shrink the sweep's I/O footprint:
   - benchmark a plain `REFRESH MATERIALIZED VIEW` against the current
     `REFRESH ... CONCURRENTLY` on this data size (~69k / ~50k rows) — a plain
     rebuild is often cheaper, and the brief `ACCESS EXCLUSIVE` lock is
     acceptable for a single-owner tool at 03:00;
   - consider refreshing the catalogue matviews on a lighter cadence than
     every sweep;
   - confirm `commit_sweep` writes only real diffs, not every row every night
     (every unnecessary write is WAL the backup then has to ship).
   Note that as of this incident the sweep has never once run with the new
   materialized read model — PR #10 merged after the 27 August sweep, and the
   28 August sweep did not run. Its steady-state cost is unmeasured; watch the
   first real run.

## The spend question

This was a preventable incident, not steady-state load exceeding the tier —
the sweep and backup have coexisted on the free plan for weeks without
trouble. Free tier remains viable **if** the discipline above holds:
no verification load against production, and prompt restarts when the instance
looks degraded.

What the free tier does not give is margin. If the working hypothesis is
right, any future incident that leaves the instance degraded overnight risks
reproducing this spiral through the nightly backup, because there is no
headroom to absorb both at once. A paid compute tier (Micro → Small is
~$15/month and doubles RAM to 2 GB, with a higher disk-I/O baseline) buys that
margin. Whether it is worth it is a judgement call about how much operator
attention the discipline realistically gets — not a technical necessity.

## What this wasn't

Model capability was not the driver. The diagnosis needed patient log
reading and ruling hypotheses out one at a time against live inspection
(disk space, bloat, dead tuples, memory, connections, replication, config —
all eliminated before I/O starvation emerged as the best-supported
explanation), which is reasoning effort well spent. The expensive part was
the incident itself: a wrong "it's fixed" call on the 27th, made on weak
evidence, that turned a contained problem into a ~13-hour one.
