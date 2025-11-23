# BBX Arbitrage Tools

This repository contains two related tools used to analyse BBX (Berry Bros. & Rudd) marketplace listings:

1. **Streamlit Web App**
   Interactive dashboard for exploring listings, applying discount thresholds, and viewing opportunities.

2. **Automated Arbitrage Scanner (GitHub Actions)**
   Headless batch process that runs on a schedule, evaluates BBX listings using REST and GraphQL enrichment, and sends a Slack notification with opportunities.
   The bot uses S3 to persist notification state and avoid sending the same alert repeatedly.

Both systems share the same Algolia fetch logic so behaviour is consistent across UI, CLI, and CI.

---

## Repository structure

```text
bbx/
  apps/
    streamlit_app/
      streamlit_app.py
    arbitrage_bot/
      run_arbitrage.py
  core/
    fetch_listings.py
    fetch_bbx_variants.py
    enrichment.py
    filters.py
    slack.py
    notification_state.py
  data/
    payload.json
  .github/
    workflows/
      arbitrage.yml
```

---

## Configuration and secrets

### Algolia

Required in all environments:

- ALGOLIA_APP_ID
- ALGOLIA_API_KEY

### REST & GraphQL

Streamlit uses secrets. The arbitrage bot imports REST/GraphQL configuration from core modules.

### Slack

- SLACK_WEBHOOK

### S3 state persistence (deduplication)

- Bucket: `kapeeshtestbucket`
- Key: `bbx/arbitrage_state.json`

Environment variables:

- S3_BUCKET
- S3_STATE_KEY

Local fallback: `data/arbitrage_state.json`

---

## Streamlit web app

Run:

```bash
streamlit run apps/streamlit_app/streamlit_app.py
```

Requires `.streamlit/secrets.toml`.

---

## Arbitrage scanner (CLI)

```bash
export ALGOLIA_APP_ID="..."
export ALGOLIA_API_KEY="..."
export SLACK_WEBHOOK="..."
python apps/arbitrage_bot/run_arbitrage.py
```

---

## Arbitrage scanner (GitHub Actions)

Uses environment variables for Algolia, Slack, and S3.
Runs hourly via `.github/workflows/arbitrage.yml`.

---

## Deduplication logic

Implemented in `core/notification_state.py`.

Rules:

1. New SKU -> notify.
2. Ask improved -> notify.
3. Ask unchanged & older than REMINDER_INTERVAL_DAYS -> notify.
4. Otherwise -> suppress.

State stored in S3 during GitHub Actions.

---

## Versioning

Tag recommended stable points:

```bash
git tag -a v0.2.0 -m "BBX arbitrage: S3-backed dedup + shared fetch_listings"
git push origin v0.2.0
```

---

## Summary

- Shared Algolia layer.
- Streamlit UI.
- Scheduled arbitrage bot with S3 persistence.
- Clean, inspectable JSON state.
