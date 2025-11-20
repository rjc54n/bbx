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
    "Content-Type": "application/json",
}

# 2) Paging parameters
HITS_PER_PAGE = 100  # same as production
MAX_PAGES     = 500  # upper bound; loop breaks early if no more hits

# 3) Colour facet mapping
# Adjust field name and values to match the actual Algolia index
COLOUR_MAP: dict[str, str] = {
    "Red":  "colour:'Red'",
    "White": "colour:'White'",
    "Rose": "colour:'Rosé'",
}


def _fetch_with_filters(filter_clauses: list[str]) -> list[dict]:
    """
    Internal helper to fetch all pages for a given list of filter clauses.
    Respects Algolia's pagination limit (about 1,000 hits per query).
    """
    all_records: list[dict] = []
    filter_str = " AND ".join(filter_clauses)

    for page in range(MAX_PAGES):
        raw_params = (
            f"hitsPerPage={HITS_PER_PAGE}"
            f"&page={page}"
            f"&filters={filter_str}"
        )

        payload = {"requests": [{
            "indexName": ALGOLIA_INDEX,
            "params": raw_params,
        }]}

        response = requests.post(
            ALGOLIA_URL,
            headers=HEADERS,
            data=json.dumps(payload),
            timeout=20,
        )

        if response.status_code != 200:
            break

        data = response.json()
        results = data.get("results", [])
        hits = results[0].get("hits", []) if results else []

        if not hits:
            break

        all_records.extend(hits)

        # If Algolia is enforcing a 1,000 hit limit, later pages will be empty
        # and we break out on the next loop.
        time.sleep(random.uniform(0.5, 1.0))

    return all_records


def fetch_listings(
    days_label: str,
    case_format: str | None = None,
    colour_choice: str = "Any",
) -> list[dict]:
    """
    Fetches all listings marked "New to BBX" within the window specified by `days_label`.
    `days_label`_

