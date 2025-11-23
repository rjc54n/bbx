# BBX Arbitrage Tools

This repo contains two related tools for BBX:

- A Streamlit front end for exploring "New to BBX" listings and discounts.
- An automated arbitrage scanner that runs hourly via GitHub Actions and posts summaries to Slack.

## Structure

- `apps/streamlit_app/streamlit_app.py` - Interactive UI for BBX "Bargain Hunter".
- `apps/arbitrage_bot/run_arbitrage.py` - Batch arbitrage scanner entrypoint (CLI and GitHub Actions).
- `core/fetch_listings.py` - Shared Algolia fetch helper (no Streamlit or env dependencies).
- `core/fetch_bbx_variants.py` - GraphQL helper for BBX variants.
- `core/enrichment.py` - REST pricing endpoints and headers.
- `core/slack.py` - Slack webhook helper.

## Configuration

There are two configuration paths.


### Streamlit (local or Streamlit Cloud)

`streamlit_app.py` expects the following keys in `st.secrets`:

- `ALGOLIA_APP_ID`
- `ALGOLIA_API_KEY`
- `REST_URL`, `REST_HEADERS` (from BBX internal API)
- `GRAPHQL_URL`, `GRAPHQL_HEADERS` (if not hard coded elsewhere)

### CLI and GitHub Actions

The arbitrage scanner does not read `st.secrets`. It expects environment variables:

- `ALGOLIA_APP_ID`
- `ALGOLIA_API_KEY`
- `SLACK_WEBHOOK`

GitHub Actions maps these from repository secrets in `.github/workflows/arbitrage.yml`.

## Running locally

Streamlit UI:

```bash
streamlit run apps/streamlit_app/streamlit_app.py
