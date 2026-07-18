# BBX Arbitrage Tools

Tools for finding below-market fine wine on the BBX (Berry Bros. & Rudd) trading exchange:

1. **Streamlit Web App** — interactive dashboard for exploring listings, applying discount thresholds, and viewing opportunities.
2. **Automated Arbitrage Scanner (GitHub Actions)** — headless batch process that runs hourly, evaluates BBX listings, and sends a Slack notification with opportunities. Uses S3 to persist notification state so the same alert is not sent repeatedly.

Both are thin wrappers over a single shared pipeline (`core/pipeline.py`), so behaviour is identical across UI, CLI, and CI.

---

## How the scan works

Three phases, ordered cheapest-first:

1. **Algolia discovery** — facet-filtered search of the public `prod_product` index (`stock_origin:'BBX'`, optional `new_to_bbx` window, colour, price band, format).
2. **REST pricing** — batched lookups against `getBiddableCprStock` returning ask (`least_listing_price`), `market_price`, and `last_bbx_transaction`; records failing the market/last-transaction discount thresholds are dropped here.
3. **GraphQL order book** — for survivors only, fetch all live variant listings to find the next-lowest competing ask and apply the final threshold.

Threshold semantics: `pct_market` is always enforced; `pct_last` and `pct_next` are enforced only when computable (a wine with no last transaction or no competing seller passes on `pct_market` alone).

### Pagination cap and facet sharding

The `prod_product` index truncates any single query at **1,000 hits** (10 pages × 100; larger `hitsPerPage` is clamped). The full BBX book is ~15,000 listings, so a broad query (e.g. "All BBX") cannot be paged in full by one filter set.

`fetch_listings` handles this by **sharding**: when a filter set exceeds the cap it splits by facet (region → colour → price band → vintage), recursing only into shards still over the cap, with a `NOT` query per level to catch records missing the facet, and de-duplication by `objectID`. Sharding is lazy — narrow queries (the hourly bot's "new in last 1 day") never shard and cost the same ~3 requests they always did.

Politeness is built in: a jittered sleep after every request, exponential backoff on `429`/`5xx`, short-page early exit, and reuse of parent facet counts so under-cap shards skip their own count query. A full-book sweep is a few hundred requests over ~3 minutes.

---

## Repository structure

```text
bbx/
  apps/
    streamlit_app/streamlit_app.py   # UI wrapper
    arbitrage_bot/run_arbitrage.py   # CLI/CI wrapper + Slack + dedup
  core/
    pipeline.py            # shared 3-phase scan funnel (ScanConfig, run_scan)
    fetch_listings.py      # Algolia fetch helper
    fetch_bbx_variants.py  # GraphQL order-book helper
    slack.py               # Slack webhook helper
    notification_state.py  # dedup rules + S3/local state persistence
  data/
    payload.json           # GraphQL payload template
  tests/                   # pytest unit tests (dedup, discount maths, sharding)
  docs/
    PHASE1.md              # plain-language explainer for the planned scan store
  .github/workflows/arbitrage.yml
```

---

## Configuration and secrets

### Algolia (all environments)

- `ALGOLIA_APP_ID`
- `ALGOLIA_API_KEY`

Streamlit reads these from `.streamlit/secrets.toml`; the bot reads environment variables.

### Slack (bot only)

- `SLACK_WEBHOOK`

### S3 state persistence (bot dedup)

- `S3_BUCKET`, `S3_STATE_KEY` (plus `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`)

When the S3 variables are unset, state falls back to a local file at `data/arbitrage_state.json` (gitignored).

---

## Running

### Streamlit web app

```bash
streamlit run apps/streamlit_app/streamlit_app.py
```

Requires `.streamlit/secrets.toml`.

### Arbitrage scanner (CLI)

```bash
export ALGOLIA_APP_ID="..."
export ALGOLIA_API_KEY="..."
export SLACK_WEBHOOK="..."
python apps/arbitrage_bot/run_arbitrage.py
```

### Arbitrage scanner (GitHub Actions)

Runs hourly 08:00–23:00 UTC via `.github/workflows/arbitrage.yml`, with a concurrency guard, unit tests before each run, and a Slack alert if the job itself fails.

### Tests

```bash
pip install -r requirements-dev.txt
python -m pytest tests/ -q
```

---

## Deduplication logic

Implemented in `core/notification_state.py`:

1. New SKU → notify.
2. Ask improved → notify.
3. Ask unchanged & older than `REMINDER_INTERVAL_DAYS` → notify (reminder).
4. Otherwise → suppress.

---

## Roadmap

- **Phase 0 (done)** — shared pipeline, dead-code removal, tests, hardened CI.
- **Phase 0.5 (done)** — facet-sharded fetch so full-book scans get past
  Algolia's 1,000-hit cap (prerequisite for the full-book sweep below).
- **Phase 0.75 (done)** — reliability pass: notification state is persisted only
  after a confirmed Slack send (dry runs never persist; storage errors fail the
  job); three-way order-book classification (sole / competing / unavailable, with
  ties counted as zero headroom); scan-coverage metrics + REST retries with a
  coverage floor that fails the run rather than alerting on partial data; sharding
  complement always queried (safe for multi-valued facets); hourly cron moved off
  `:00`.
- **Phase 1A (planned)** — entity model: define product / SKU / seller-offer;
  decide offer-level identity for the candidate subset vs SKU-level availability
  for the full book; validate against captured API responses.
- **Phase 1B (planned)** — persistent scan store: an append-only **changelog**
  (`observation_events`) plus `scan_runs` metadata (so "unchanged" is
  distinguishable from "not observed"), `current_state`, and `products`. Backend:
  free-tier **Supabase (Postgres)** via the Supavisor pooler, with local
  **SQLite** for dev/tests only. See [`docs/PHASE1.md`](docs/PHASE1.md) for a
  plain-language explainer with worked examples.
- **Phase 2 (planned)** — rewrite the web app as a fast reader over the store,
  with saved searches, watchlists, and per-wine detail/history pages.
