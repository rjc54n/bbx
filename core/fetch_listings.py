# core/fetch_listings.py
# ----------------------------------------------
# A helper to fetch "New to BBX" listings via Algolia's multi-index queries endpoint.

import requests
import json
import time
import random
import streamlit as st
from pathlib import Path

# 1) API credentials and endpoints (from your production script)
ALGOLIA_APP_ID  = st.secrets["ALGOLIA_APP_ID"]
ALGOLIA_API_KEY = st.secrets["ALGOLIA_API_KEY"]
# Use the same index as your production extractor
ALGOLIA_INDEX   = "prod_product"
# Algolia host for DSN (search) operations
ALGOLIA_URL     = f"https://{ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries"
# Headers for Algolia requests
HEADERS = {
    "x-algolia-application-id": ALGOLIA_APP_ID,
    "x-algolia-api-key": ALGOLIA_API_KEY,
    "Content-Type": "application/json"
}

# 2) Paging parameters
HITS_PER_PAGE = 100  # same as production
MAX_PAGES     = 500  # upper bound; loop breaks early if no more hits


def fetch_listings(
    days_label: str,
    case_format: str | None = None
) -> list[dict]:  # days_label: e.g. "1 Day", "2 Days", "3 Days", "7 Days"

    """
    Fetches all listings marked "New to BBX" within the window specified by `days_label`.
    `days_label` must be one of "1 Day", "2 Days", "3 Days", or "7 Days".
    Optionally filters by `case_format` (e.g. "6 x 75 cl").

    Returns a list of raw hit-dicts from Algolia.
    """
    all_records: list[dict] = []

    # Iterate pages until no more hits or reach MAX_PAGES
    for page in range(MAX_PAGES):
        # Build the facet filters string
        filters = [
            "stock_origin:'BBX'",                # only BBX stock
            f"new_to_bbx:'{days_label}'"         # lookback window using days_label
        ]
        if case_format:
            filters.append(f"format:'{case_format}'")
        filter_str = " AND ".join(filters)

        # Build raw params string as in production
        raw_params = (
            f"hitsPerPage={HITS_PER_PAGE}"  # results per page
            f"&page={page}"                 # page index
            f"&filters={filter_str}"        # filters
        )

        # Construct multi-query payload
        payload = {"requests": [{
            "indexName": ALGOLIA_INDEX,
            "params": raw_params
        }]}

        # Send POST to Algolia DSN multi-index endpoint
        response = requests.post(
            ALGOLIA_URL,
            headers=HEADERS,
            data=json.dumps(payload)
        )

        # Stop and raise if non-200
        if response.status_code != 200:
            break

        # Parse hits from JSON
        data = response.json()
        results = data.get("results", [])
        hits = results[0].get("hits", []) if results else []

        # Exit loop early if no hits
        if not hits:
            break

        # Accumulate hits
        all_records.extend(hits)

        # Throttle requests
        time.sleep(random.uniform(0.5, 1.0))

    return all_records
