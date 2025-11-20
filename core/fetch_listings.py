# core/fetch_listings.py
# ----------------------------------------------
# A helper to fetch "New to BBX" listings via Algolia's multi-index queries endpoint.

# -*- coding: utf-8 -*-

import requests
import json
import time
import random
import streamlit as st

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

# 3) Colour facet mapping (UI label -> Algolia filter clause)
COLOUR_MAP = {
    "Red":   "colour:'Red'",
    "White": "colour:'White'",
    "Rosé":  "colour:'Rosé'",
}


def _fetch_with_filters(filter_clauses):
    """
    Internal helper to fetch all pages for a given list of filter clauses.
    Respects Algolia's pagination limit (about 1,000 hits per query).
    """
    all_records = []
    filter_str = " AND ".join(filter_clauses)

    for page in range(MAX_PAGES):
        raw_params = (
            "hitsPerPage={hits}&page={page}&filters={filters}".format(
                hits=HITS_PER_PAGE,
                page=page,
                filters=filter_str,
            )
        )

        payload = {
            "requests": [{
                "indexName": ALGOLIA_INDEX,
                "params": raw_params,
            }]
        }

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

        # Throttle requests a little
        time.sleep(random.uniform(0.5, 1.0))

    return all_records


def fetch_listings(days_label, case_format=None, colour_choice="Any"):
    """
    Fetches all listings marked "New to BBX" within the window specified by `days_label`.
    `days_label` must be one of "1 Day", "2 Days", "3 Days", or "7 Days".

    Optional parameters:
      - case_format: filter by case format (e.g. "6 x 75 cl").
      - colour_choice: "Any", "Red", "White", or "Rosé".

    Returns a list of raw hit-dicts from Algolia.
    """

    # Base filters common to all variants
    base_filters = [
        "stock_origin:'BBX'",           # only BBX stock
        "new_to_bbx:'{days}'".format(days=days_label),   # lookback window
    ]
    if case_format:
        base_filters.append("format:'{fmt}'".format(fmt=case_format))

    # If a specific colour is chosen, apply it directly and do a single query.
    if colour_choice and colour_choice != "Any":
        colour_filter = COLOUR_MAP.get(colour_choice)
        filter_clauses = list(base_filters)
        if colour_filter:
            filter_clauses.append(colour_filter)
        return _fetch_with_filters(filter_clauses)

    # "Any" colour: query each colour bucket separately and union results.
    combined_by_id = {}

    for label, colour_filter in COLOUR_MAP.items():
        filter_clauses = list(base_filters)
        filter_clauses.append(colour_filter)
        hits = _fetch_with_filters(filter_clauses)

        for h in hits:
            obj_id = h.get("objectID")
            if obj_id is not None:
                combined_by_id[obj_id] = h

    return list(combined_by_id.values())
