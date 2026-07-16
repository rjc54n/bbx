# Phase 1 — The Persistent Scan Store (plain-language explainer)

This document explains, in simple terms, what Phase 1 is, why we want it, and
how it behaves — with worked examples. No code here; it's the shared mental
model before we build.

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

So there is no memory. We can't answer questions like:

- "Has this wine been sitting unsold for three weeks, or did it appear today?"
- "This ask is £600 — is that a genuine drop, or has it always been £600?"
- "What did this case trade at over the last few months?"

A store gives us all of that for free, because it simply keeps what we already
fetch.

---

## The key idea: a store is a *log*, not a *cache*

This is the distinction that resolves the "won't it go stale?" worry.

- A **cache** tries to be a mirror of "what is true right now". Caches rot: the
  moment a wine sells or an ask changes, the cache is wrong.
- A **log** records "what we observed, and when". A log is **never wrong** — it's
  a history. "On 16 July at 02:00, SKU 20101261017 was listed at £680" stays
  true forever, even after the wine sells.

We store observations. When we need "what's true right now" for a decision, we
take a fresh look — see [Freshness](#freshness-how-we-avoid-acting-on-stale-prices)
below.

### Worked example — one wine over time

Each scan appends a row. Nothing is ever overwritten:

| observed_at       | sku          | ask  | market | last_tx | status  |
|-------------------|--------------|------|--------|---------|---------|
| 14 Jul 02:00      | 201012...017 | £720 | £900   | £810    | listed  |
| 15 Jul 02:00      | 201012...017 | £720 | £900   | £810    | listed  |
| 16 Jul 02:00      | 201012...017 | £680 | £900   | £810    | listed  |
| 17 Jul 02:00      | 201012...017 | —    | £900   | £810    | **gone**|

From this single history we can now read off, with **zero** extra API calls:

- **Days on market:** first seen 14 Jul, so it sat for 3+ days.
- **Price drop:** ask fell £720 → £680 on 16 Jul (a real, dated change).
- **Outcome:** it disappeared on 17 Jul — sold or delisted. That "gone" row is
  itself a signal (see liquidity below).

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
   considering). This refreshes ask / market / last-transaction for everything
   and appends a fresh snapshot to the store.

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
02:00  Daily sweep:   15,000 listings priced, snapshot written to store.
08:00  Hourly bot:    40 new listings today; 2 clear the arbitrage bar → Slack.
09:15  You open app:  loads instantly from the 02:00 snapshot.
                      Banner: "Prices as of 7h ago."
09:16  You click a wine: app re-checks THAT wine live (~1s) → shows
                      "still £680, confirmed just now."
```

Staleness bounds end up: ~1 hour for brand-new listings, ≤24 hours for the whole
book, and ~0 for anything you actually look at.

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
Live re-check: ask is now £950 (the £680 seller sold; next seller is dearer).
App shows:    "⚠ Price changed since last scan: £680 → £950. No longer a bargain."
```

You were never at risk of bidding on the old number, because the detail view
always re-prices before you can act.

---

## What the store unlocks (beyond instant loading)

Once history accumulates, these become simple queries rather than new API work:

- **Days on market** and **first-seen** date per listing.
- **Ask-change tracking** — the dedup logic (currently a hand-rolled JSON file)
  becomes "compare today's ask to yesterday's row".
- **Liquidity signal** — how often a wine actually trades or turns over on BBX. A
  30%-under-market wine that never sells is a trap, not a bargain; the store can
  tell them apart.
- **A better "fair value"** — instead of trusting a single `market_price` of
  unknown age, compare the ask to a rolling median of recent observed
  transactions, and flag when `market_price` and `last_bbx_transaction` disagree
  wildly (a sign the market number is stale).

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

- **Storage:** start simple — SQLite synced to the S3 bucket we already use, or
  DuckDB/parquet on the same bucket. One table of observations, append-only.
- **Writers:** the hourly bot and the daily sweep both append their snapshots.
- **Readers:** the web app (Phase 2) and any analysis.
- **Retention:** keep raw observations; the log is the asset. Revisit only if it
  ever gets genuinely large (years of daily 15k-row snapshots is still modest).

The prerequisite — sweeping the *whole* book past Algolia's 1,000-hit cap — is
already done (see [README: Pagination cap and facet sharding](../README.md#pagination-cap-and-facet-sharding)).
