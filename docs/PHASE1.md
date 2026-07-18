# Phase 1 — The Persistent Scan Store (plain-language explainer)

This document explains, in simple terms, what Phase 1 is, why we want it, and
how it behaves — with worked examples. No code here; it's the shared mental
model before we build.

> **Where this sits (revised sequencing).** An independent review reordered the
> roadmap, and we adopted it:
>
> - **Phase 0.75 — reliability (done).** Delivery correctness (persist only after
>   a confirmed Slack send; dry runs never persist; storage errors fail the job),
>   three-way order-book classification, scan-coverage metrics + REST retries,
>   sharding-complement fix, cron moved off `:00`.
> - **Phase 1A — entity model (next).** Pin down product / SKU / seller-offer;
>   decide the "offer identity for candidates only, SKU availability for the full
>   book" split; validate the model against *captured* real API responses before
>   writing storage code.
> - **Phase 1B — storage.** Postgres (via the Supavisor pooler), the tables
>   below, idempotency, complete-scan `gone` semantics, backups.
> - **Phase 2 — reader UI** over confirmed capabilities.
>
> This doc describes the *store* (Phase 1A/1B). Read it knowing the entity
> caveats in [What the store unlocks](#what-the-store-unlocks--and-what-it-does-not)
> are the part 1A must nail down first.

---

## The one-sentence version

Today the tools **look up** prices live every time and then throw the answers
away. Phase 1 **writes every price we see to a log**, so the app can show
history, spot changes, and load instantly — while still checking live prices at
the moment you're about to act.

---

## Why we want it

Right now:

- The **hourly bot** only looks at wines that are *new to BBX today*. That's the
  whole point of it — it's a new-listing alert service.
- The **web app** scans live when you press a button, shows you a list, and
  forgets everything when you close the tab.

So there is no memory. A store gives us memory by keeping what we already fetch.

How far that memory reaches depends on **what we observe** — and that varies by
question (the full breakdown is in
[What the store unlocks](#what-the-store-unlocks--and-what-it-does-not)):

- "When did we first see this SKU, and is it still in the book?" — **yes**, from
  the daily full-book sweep (SKU availability as *we observed* it).
- "This ask is £600 — is that a genuine drop, or has it always been the ask we
  saw?" — **yes**, as an observed-ask changelog.
- "Has this *specific seller's offer* been sitting unsold for three weeks?" /
  "What did this case actually trade at over recent months?" — **only partially,
  and only for watched wines.** These need seller-offer identity and true
  transaction data, which live in the GraphQL order book; we capture that just
  for the candidate / watchlist subset, not the whole book. Not "for free".

---

## The key idea: a store is a *log*, not a *cache*

This is the distinction that resolves the "won't it go stale?" worry.

- A **cache** tries to be a mirror of "what is true right now". Caches rot: the
  moment a wine sells or an ask changes, the cache is wrong.
- A **log** records "what *we observed*, and when". An immutable row records what
  the collector reported at that time — "at the 16 July 02:00 scan, SKU
  20101261017 was listed at £680". That statement stays accurate as a record of
  our observation, even after the offer is gone. (It is *not* a claim that the
  price was £680 at every moment, nor that we observed every change.)

We store observations. When we need "what's true right now" for a decision, we
take a fresh look — see [Freshness](#freshness-how-we-avoid-acting-on-stale-prices)
below.

### Worked example — one wine, as *we observed* it

We append a row only when something **changes between scans** (see
[Store changes, not snapshots](#store-changes-not-snapshots-what-keeps-it-small)
below). Nothing is ever overwritten:

| observed_at       | sku          | ask  | market | last_tx | status         |
|-------------------|--------------|------|--------|---------|----------------|
| 14 Jul 02:00      | 201012...017 | £720 | £900   | £810    | seen           |
| 16 Jul 02:00      | 201012...017 | £680 | £900   | £810    | seen           |
| 17 Jul 02:00      | 201012...017 | —    | £900   | £810    | **not seen**   |

There's **no 15 Jul row** — but read that carefully: a row's absence means "no
observed change since the row above" **only if a complete scan actually ran on 15
July**. If the 15 July scan failed or was skipped, absence means "we didn't
look", not "unchanged" — which is exactly why the store records every scan in
`scan_runs` (see [schema](#schema-needs-scan-metadata-to-be-trustworthy)). From
this history, and only against completed scans, we can read off with zero extra
API calls:

- **SKU availability observed by us:** the SKU first appeared on 14 Jul and was
  no longer in the book by 17 Jul. (This is *availability*, not an individual
  seller's "days on market" — the offer behind the ask can change without the ask
  changing. See [what the store does not support](#what-the-store-unlocks--and-what-it-does-not).)
- **Observed ask change:** the ask we saw fell £720 → £680 between the 14 Jul and
  16 Jul scans.
- **Disappearance:** the SKU was not seen on 17 Jul. That is a signal worth
  investigating — but it does *not* by itself prove a sale (it may have been
  withdrawn).

None of this is knowable today, because today we keep nothing.

---

## Two speeds of scanning ("tiered scanning")

We don't need one giant scan doing everything. We split by purpose:

1. **Hourly — new listings only (unchanged).**
   Narrow: "new to BBX in the last day". Goes deep (Algolia + REST + GraphQL),
   feeds Slack alerts. ~3 Algolia requests per run. This is exactly what the bot
   does now; Phase 1 just also writes its results to the store.

2. **Daily — the full-book sweep (new).**
   Once a day, overnight: walk the *entire* ~15,000-listing book with Algolia +
   REST only (no GraphQL — that's only needed for candidates we're seriously
   considering). This re-prices everything, then **compares each wine to its
   last-known state and writes only what changed** — see below.

Why this split matters for **not annoying BBR**:

- The expensive, page-loading GraphQL call stays rare (candidates only).
- The full sweep is REST pricing in batches of 24 — about **640 calls once a
  day**, overnight. That's comparable to a person browsing the site for a while,
  not a firehose.
- The interactive app reads the **store**, so clicking around the UI costs BBR
  nothing. Paradoxically, this makes us *quieter* than an app that hits the live
  API on every button press.

### Worked example — a day in the life

```
02:00  Daily sweep:   15,000 listings priced; ~600 changed vs yesterday,
                      so ~600 rows appended (not 15,000).
08:00  Hourly bot:    40 new listings today; 2 clear the arbitrage bar → Slack.
09:15  You open app:  loads instantly from the store's latest-known state.
                      Banner: "Prices as of 7h ago."
09:16  You click a wine: app re-checks THAT wine live (~1s) → shows
                      "still £680, confirmed just now."
```

Staleness bounds end up: ~1 hour for brand-new listings, ≤24 hours for the whole
book, and ~0 for anything you actually look at.

---

## Store changes, not snapshots (what keeps it small)

We do **not** save a full copy of all 15,000 listings every day. We save a row
only when a wine is **new**, has **changed** (ask / market / last-transaction), or
has **gone**. Each sweep diffs against the last-known state and writes just the
difference.

Why this matters — the numbers:

- **Full daily snapshots:** 15,000 rows/day → ~5.5 million rows/year → roughly
  1–1.5 GB. That overruns a 500 MB free database in about four months.
- **Change-based logging:** fine wine barely moves day-to-day, so a typical
  sweep changes a few percent of listings — a few hundred rows/day, not 15,000.
  That's comfortably under 500 MB for **years**.

It's also better data design regardless of size: your price history is a clean
changelog, not 99% identical rows. This is the concrete meaning of "log, not
cache" — the log records *transitions*, and a wine with no new row simply hasn't
changed since its last one.

---

## Freshness: how we avoid acting on stale prices

The store is for **browsing and history**. It is never the last word before you
spend money. The pattern (borrowed from flight-search sites):

1. **Browse from the store** — instant, with an honest "as of Xh ago" label on
   every row.
2. **Verify live on interaction** — when you open a wine, or when a row is about
   to matter, re-hit the REST pricing endpoint for just that SKU (or the ~50
   rows currently on screen: two batched calls, a couple of seconds) and show
   *current* vs *stored*.

So the cache is never *relied upon* for a purchase — only for discovery,
ranking, and history. The live check happens exactly when it's worth doing.

### Worked example — a stale row caught

```
Store says:   SKU ...017 — ask £680, 18% under market   (from 02:00)
You click it at 14:30.
Live re-check: ask is now £950 (the £680 offer is gone; next offer is dearer).
App shows:    "⚠ Price changed since last scan: £680 → £950. No longer a bargain."
```

(Note we say the offer is *gone*, not *sold* — SKU-level data can't tell a sale
from a withdrawal. See [What the store unlocks](#what-the-store-unlocks--and-what-it-does-not).)

You were never at risk of bidding on the old number, because the detail view
always re-prices before you can act.

---

## What the store unlocks — and what it does *not*

This is the most important correction to an earlier draft of this doc. What the
store can prove depends entirely on **what entity we observe**, and the daily
full-book sweep observes **SKU-level reference pricing** (`least_listing_price`,
`market_price`, `last_bbx_transaction`), not individual seller offers.

**Supportable from SKU-level history (the daily sweep):**

- **SKU availability history** — when a SKU first appeared in the book and when
  it stopped appearing. (Not the same as an individual offer's lifetime — see
  below.)
- **Observed reference-price changes** — the dated changelog of ask / market /
  last-transaction as *observed at each scan*.
- **Ask-change dedup** — the current hand-rolled JSON state becomes "compare this
  scan's ask to the last stored row".
- **A better "fair value"** — compare the ask to a rolling series of *observed*
  reference prices, and flag when `market_price` and `last_bbx_transaction`
  disagree wildly (a stale-market signal).

**NOT supportable from SKU-level data (needs stable seller-offer IDs):**

- **Seller-offer days-on-market** — the cheapest ask can hold at £680 while the
  *seller behind it* changes; SKU-level pricing can't see that turnover.
- **Sold vs. withdrawn** — a SKU leaving the book, or an ask ticking up, does not
  prove a sale; the offer may have been cancelled.
- **True liquidity / turnover** — repeated trades at the same price are invisible.
- **Transaction history** — `last_bbx_transaction` is only the *latest value seen
  at scan time*; trades between scans, and repeat trades at one price, are lost.

Getting the second group requires **seller-offer identity**, which lives in the
**GraphQL order book** — and that is the crux of the design tension below.

### The tension: politeness vs. offer-level tracking

Offer identity is only in GraphQL, and the daily sweep is deliberately
**REST-only** to stay polite (running GraphQL page-loads on all ~15k SKUs daily
is exactly the load we agreed not to generate). So we cannot have both full-book
coverage *and* offer-level liquidity at daily cadence.

Planned resolution (decided in Phase 1A, not now): track **offer-level identity
only for the narrow candidate / watchlist set** — those already pay for a GraphQL
call — and keep **SKU-level availability** for the full book. Broad liquidity and
"days on market" claims are scoped to that subset, and the full-book claims are
reduced to availability + observed-reference-price history as above.

---

## What Phase 1 is *not*

- **Not** a live mirror of BBX. It lags by design; that's fine because we
  re-check before acting.
- **Not** a reason to hammer BBR. The full sweep is once daily and REST-only; the
  GraphQL page-load call stays candidate-only.
- **Not** a UI change yet. Phase 1 is plumbing. The web-app rewrite (Phase 2)
  sits *on top* of this store and should come after it — building a new UI over
  today's on-demand scanning would just inherit the "everything is slow and
  forgotten" problem.

---

## Rough shape (for when we build it)

### Storage backend: Supabase (Postgres), with a local SQLite fallback

We'll use the existing **free-tier Supabase** project as the production store,
and fall back to a **local SQLite file** when no database URL is configured —
mirroring the S3-or-local pattern `notification_state.py` already uses:

- `DATABASE_URL` set → Supabase Postgres (production, GitHub Actions).
- `DATABASE_URL` unset → local SQLite file (dev and the offline test suite).

The two share a schema, but **not every query path is identical**: production
uses Postgres window functions, concurrency, and rolling medians that SQLite
does not reproduce faithfully. So SQLite is scoped to **local dev and small
adapter tests**; anything analytical is tested against Postgres, not assumed
equivalent because it passed on SQLite.

Connection detail that will otherwise bite us: **GitHub Actions is IPv4-only,
while Supabase's direct database endpoint is IPv6 on the free plan.** The writers
must connect through the **Supavisor session pooler** (the IPv4-reachable
connection string), not a bare direct `DATABASE_URL`.

**Why Supabase over SQLite-on-S3**, given Phase 2 is a networked web app:

- Postgres is queryable **over the network** from wherever the app runs
  (Streamlit Cloud, Vercel, …). SQLite-on-S3 forces every reader and writer to
  download the whole file, mutate it, and re-upload — the same
  read-modify-write-the-whole-file pattern as today's `arbitrage_state.json`,
  which only gets worse as the file grows.
- Concurrent writes (hourly bot + daily sweep) and reads (the app) just work,
  with no file-locking dance.
- Indexes on `(sku, observed_at)` make "history for this wine" and "latest
  state" fast at millions of rows; analytical SQL (rolling-median fair value,
  days-on-market via window functions) is Postgres's home turf.

**Free-tier caveats, both handled:**

- **500 MB database limit** — a non-issue once we store changes not snapshots
  (see above); a local SQLite fallback also keeps dev/test off the quota.
- **Projects pause after ~1 week of insufficient activity** — the daily sweep
  and hourly bot both write regularly, which should keep it active; but Supabase
  defines "sufficient activity" loosely, so we add an explicit tiny keepalive
  query rather than *assume* the writes qualify.
- A Postgres connection string becomes one more CI/Streamlit secret — minor, and
  no worse than the AWS creds already present. Lock-in is low: it's plain
  Postgres, so `pg_dump` moves it anywhere.

### Schema (needs scan metadata to be trustworthy)

A change-only log is only meaningful if we also record **which scans ran**. "No
row for SKU X on 15 July" means "unchanged" *only if a complete scan succeeded
on 15 July* — otherwise it means "we didn't look". So scan bookkeeping is a
first-class table, not an afterthought:

- **`scan_runs`** — one row per scan: scope, started_at, finished_at, expected /
  queried / priced / failed counts, coverage, and status. Everything else joins
  back to this so gaps are explicit. (The pipeline now returns exactly these
  counts via `ScanOutcome.coverage` et al.)
- **`observation_events`** — append-only changelog, each row linked to the
  `scan_runs` id that produced it (sku, observed_at, ask, market, last_tx,
  status).
- **`current_state`** — latest known state per SKU (or per offer, for the
  candidate subset) for fast reads without scanning the whole changelog.
- **`products`** — slow-changing descriptive fields (name, vintage, region,
  format).
- **Idempotency constraints** so a retried or concurrent writer cannot append
  duplicate events for the same (scan, entity).

Two rules that follow from the entity discussion above:

- Only a **complete full-book scan** may emit `gone` for a SKU — and preferably
  only after **two consecutive misses**, to absorb a single flaky scan.
  "Complete" here has **two independent parts** that must both hold, tracked as
  separate `scan_runs` fields:
  - **Discovery completeness** — Algolia returned the *whole* book. Today
    `fetch_listings` silently truncates if shard dimensions are exhausted above
    the 1,000-hit cap; before a writer consumes it, `fetch_listings` must expose
    this (raise / `discovery_complete=False`) and cross-check root `nbHits`
    against unique records collected. **(Open — Phase 1B prerequisite.)**
  - **Pricing coverage** — REST priced enough of the discovered SKUs
    (`ScanOutcome.coverage`, already implemented). A SKU absent from a scan with
    incomplete discovery must **not** count as a miss.
- Offer-level rows exist only for the **candidate / watchlist subset** that gets
  GraphQL; the full book is SKU-level availability.

### Writers / readers / retention

- **Writers:** the hourly bot and the daily sweep, each diffing against
  `current_state` and appending only changes, tagged with a `scan_runs` id.
- **Readers:** the web app (Phase 2) and any analysis.
- **Retention:** keep raw events; the changelog is the asset. Add backups
  (`pg_dump`) once real history accumulates.

The prerequisite — sweeping the *whole* book past Algolia's 1,000-hit cap — is
already done (see [README: Pagination cap and facet sharding](../README.md#pagination-cap-and-facet-sharding)).
