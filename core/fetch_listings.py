# core/fetch_listings.py
# ----------------------------------------------

import os
import json
import time
import random
import requests

# Streamlit is optional
try:
    import streamlit as st
except ImportError:
    st = None


# ------------------------------------------------------------
# 1) Safe secret resolution — NEVER run at import time
# ------------------------------------------------------------

def _resolve_algolia_credentials():
    """
    Return (ALGOLIA_APP_ID, ALGOLIA_API_KEY) using:
    1) Environment variables (always highest priority)
    2) Streamlit secrets only if no env vars and Streamlit exists
    """
    app_id = os.environ.get("ALGOLIA_APP_ID")
    api_key = os.environ.get("ALGOLIA_API_KEY")

    if app_id and api_key:
        return app_id, api_key

    if st is not None:
        try:
            secrets = st.secrets
            app_id = app_id or secrets.get("ALGOLIA_APP_ID")
            api_key = api_key or secrets.get("ALGOLIA_API_KEY")
        except Exception:
            pass

    if not app_id or not api_key:
        raise RuntimeError(
            "Algolia credentials not found in environment variables or Streamlit secrets."
        )

    return app_id, api_key


# ------------------------------------------------------------
# Configuration that depends on secrets must be resolved lazily
# ------------------------------------------------------------

def _build_algolia_headers_and_url():
    app_id, api_key = _resolve_algolia_credentials()

    url = f"https://{app_id}-dsn.algolia.net/1/indexes/*/queries"
    headers = {
        "x-algolia-application-id": app_id,
        "x-algolia-api-key": api_key,
        "Content-Type": "application/json",
    }
    return url, headers


ALGOLIA_INDEX = "prod_product"
HITS_PER_PAGE = 100
MAX_PAGES = 500


# ------------------------------------------------------------
# Facets
# ------------------------------------------------------------

COLOUR_MAP = {
    "Red":   "colour:'Red'",
    "White": "colour:'White'",
    "Rosé":  "colour:'Rosé'",
}

PRICE_FACET_FIELD = "prices.price_per_case"
BOTTLE_FACET_FIELD = "purchase_options.bottle_order_unit"


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

def _build_price_filter(price_bands):
    if not price_bands:
        return None
    parts = [f"{PRICE_FACET_FIELD}:'{band}'" for band in price_bands]
    return "(" + " OR ".join(parts) + ")"


def _build_bottle_filter(fmt):
    return f"{BOTTLE_FACET_FIELD}:'Bottle'" if fmt == "Bottle" else None


def _fetch_with_filters(filter_clauses):
    algolia_url, headers = _build_algolia_headers_and_url()

    all_records = []
    filter_str = " AND ".join(filter_clauses)

    for page in range(MAX_PAGES):
        raw_params = f"hitsPerPage={HITS_PER_PAGE}&page={page}&filters={filter_str}"

        payload = {"requests": [
            {"indexName": ALGOLIA_INDEX, "params": raw_params}
        ]}

        response = requests.post(
            algolia_url,
            headers=headers,
            data=json.dumps(payload),
            timeout=20
        )

        if response.status_code != 200:
            break

        data = response.json()
        hits = data.get("results", [{}])[0].get("hits", [])

        if not hits:
            break

        all_records.extend(hits)
        time.sleep(random.uniform(0.3, 0.7))

    return all_records


# ------------------------------------------------------------
# Public API
# ------------------------------------------------------------

def fetch_listings(days_label, colour_choice="Any", price_bands=None, bottle_format=None):
    base_filters = ["stock_origin:'BBX'"]

    if days_label:
        base_filters.append(f"new_to_bbx:'{days_label}'")

    bf = _build_bottle_filter(bottle_format)
    if bf:
        base_filters.append(bf)

    pf = _build_price_filter(price_bands)
    if pf:
        base_filters.append(pf)

    # Specific colour → one query
    if colour_choice != "Any":
        cf = COLOUR_MAP.get(colour_choice)
        filters = base_filters + ([cf] if cf else [])
        return _fetch_with_filters(filters)

    # Any colour → union of three
    combined = {}
    for cf in COLOUR_MAP.values():
        filters = base_filters + [cf]
        for hit in _fetch_with_filters(filters):
            combined[hit["objectID"]] = hit

    return list(combined.values())
