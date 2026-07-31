# BBX Arbitrage Tools

Tools for finding below-market fine wine on the BBX (Berry Bros. & Rudd)
trading exchange and managing private cellar evidence:

1. **Streamlit Web App** — interactive dashboard for exploring listings, applying discount thresholds, and viewing opportunities.
2. **Automated Arbitrage Scanner (GitHub Actions)** — headless batch process that runs hourly, evaluates BBX listings, and sends a Slack notification with opportunities. Uses S3 to persist notification state so the same alert is not sent repeatedly.
3. **Next.js and Supabase application** — the current catalogue reader plus
   owner-only BBR cellar, CellarTracker and historic release-price datasets.

The Streamlit application and hourly scanner are thin wrappers over the shared
`core/pipeline.py` scan pipeline. The Next.js application is a separate reader
and private-data workflow over Supabase.

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
    daily_sweep/run_sweep.py         # full biddable-universe snapshot
    web/                             # Next.js catalogue and private cellar app
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
    ROADMAP-2026-07.md               # current product roadmap
    CELLARTRACKER-IMPLEMENTATION.md  # fourth dataset implementation
    CODEBASE-REVIEW-2026-07-31.md    # current defects and maintenance order
  supabase/
    migrations/                      # deployed database schema history
    tests/                           # database access and behaviour tests
  .github/workflows/arbitrage.yml
  .github/workflows/daily_sweep.yml
  .github/workflows/database-migrations.yml
```

---

## Configuration and secrets

### Algolia (all environments)

- `ALGOLIA_APP_ID`
- `ALGOLIA_API_KEY`

Streamlit reads these from `.streamlit/secrets.toml`; the bot reads environment variables.
The Next.js application also reads them from its server environment for the
owner-only release-price and CellarTracker matching pages. Do not prefix either
variable with `NEXT_PUBLIC_`.

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

### Next.js application

See [`apps/web/README.md`](apps/web/README.md) for environment variables,
owner bootstrap, local development and release checks.

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

The Next.js checks run separately:

```bash
cd apps/web
npm run lint
npm test
npm run build
```

The database migration workflow runs on relevant pull requests and pushes to
`main`. The repository does not currently run the Python or web checks on pull
requests. The scheduled scanner and sweep run the Python tests before their
production jobs. See
[`docs/CODEBASE-REVIEW-2026-07-31.md`](docs/CODEBASE-REVIEW-2026-07-31.md)
for the recommended CI split and the current maintenance backlog.

---

## Deduplication logic

Implemented in `core/notification_state.py`:

1. New SKU → notify.
2. Ask improved → notify.
3. Ask unchanged & older than `REMINDER_INTERVAL_DAYS` → notify (reminder).
4. Otherwise → suppress.

---

## Roadmap

The dated implementation roadmap is
[`docs/ROADMAP-2026-07.md`](docs/ROADMAP-2026-07.md). Current implementation
notes include:

- [`docs/PHASE3-4-IMPLEMENTATION.md`](docs/PHASE3-4-IMPLEMENTATION.md) for the
  persistent catalogue and scanner;
- [`docs/PHASE5-IMPLEMENTATION.md`](docs/PHASE5-IMPLEMENTATION.md) for private
  cellar holdings;
- [`docs/PHASE7-IMPLEMENTATION.md`](docs/PHASE7-IMPLEMENTATION.md) for historic
  release prices; and
- [`docs/CELLARTRACKER-IMPLEMENTATION.md`](docs/CELLARTRACKER-IMPLEMENTATION.md)
  for CellarTracker import, matching and comparison.
