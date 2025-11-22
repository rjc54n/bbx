# core/fetch_listings.py
# ----------------------------------------------
# Shared helper to fetch "New to BBX" listings from Algolia.
# This module:
# - DOES NOT read environment variables
# - DOES NOT use Streamlit or st.secrets
# - ONLY uses the Algolia credentials passed in as arguments

import json
import time
import random
import requests
from typing import List, Dict, Optional


# ------------------------------------------------------------
# Constants (pure configuration, no secrets involved)
# ------------------------------------------------------------

DEFAULT_ALGOLIA_INDEX = "prod_product"
DEFAULT_HITS_PER_PAGE = 100
DEFAULT_MAX_PAGES = 500

# Facet helpers
COLOUR_MAP = {
    "Red": "colour:'Red'",
    "White": "colour:'White'",
    "Rosé": "colour:'Rosé'",
}

PRICE_FACET_FIELD = "prices.price_per_case"
BOTTLE_FACET_FIELD = "purchase_options.bottle_order_unit"


# ------------------------------------------------------------
# Internal helpers (no side effects beyond HTTP calls)
# ------------------------------------------------------------

def _build_algolia_url_and_headers(
    algolia_app_id: str,
    algolia_api_key: str,
) -> (str, Dict[str, str]):
    """
    Build the Algolia DSN URL and headers for authenticated search requests.
    """
    url = f"https://{algolia_app_id}-dsn.algolia.net/1/indexes/*/queries"
    headers = {
        "x-algolia-application-id": algolia_app_id,
        "x-algolia-api-key": algolia_api_key,
        "Content-Type": "application/json",
    }
    return url, headers


def _build_price_filter(price_bands: Optional[List[str]]) -> Optional[str]:
    """
    Build an Algolia facet filter string for the selected price bands.
    Example output: "(prices.price_per_case:'£100-£200' OR prices.price_per_case:'£200-£300')"
    """
    if not price_bands:
        return None

    parts = [f"{PRICE_FACET_FIELD}:'{band}'" for band in price_bands]
    return "(" + " OR ".join(parts) + ")"


def _build_bottle_filter(bottle_format: Optional[str]) -> Optional[str]:
    """
    Build a filter for bottle format when the user selects "Bottle".
    Currently your Algolia data seems to use a 'Bottle' value for this facet.
    """
    if bottle_format == "Bottle":
        return f"{BOTTLE_FACET_FIELD}:'Bottle'"
    return None


def _fetch_with_filters(
    algolia_app_id: str,
    algolia_api_key: str,
    filter_clauses: List[str],
    index_name: str = DEFAULT_ALGOLIA_INDEX,
    hits_per_page: int = DEFAULT_HITS_PER_PAGE,
    max_pages: int = DEFAULT_MAX_PAGES,
    request_timeout: int = 20,
) -> List[Dict]:
    """
    Core low-level fetcher. Executes paged Algolia queries using the provided filters.

    IMPORTANT:
    - This function expects VALID Algolia credentials.
    - It does not know or care where they came from.
    """
    algolia_url, headers = _build_algolia_url_and_headers(
        algolia_app_id=algolia_app_id,
        algolia_api_key=algolia_api_key,
    )

    all_records: List[Dict] = []
    filter_str = " AND ".join(filter_clauses)

    for page in range(max_pages):
        # Build the Algolia query-string style params
        raw_params = (
            f"hitsPerPage={hits_per_page}"
            f"&page={page}"
            f"&filters={filter_str}"
        )

        payload = {
            "requests": [
                {
                    "indexName": index_name,
                    "params": raw_params,
                }
            ]
        }

        response = requests.post(
            algolia_url,
            headers=headers,
            data=json.dumps(payload),
            timeout=request_timeout,
        )

        if response.status_code != 200:
            # You may want to log or raise in production; for now we just break.
            break

        data = response.json()
        hits = data.get("results", [{}])[0].get("hits", [])

        if not hits:
            # No more pages
            break

        all_records.extend(hits)

        # Small random sleep to avoid hammering Algolia
        time.sleep(random.uniform(0.3, 0.7))

    return all_records


# ------------------------------------------------------------
# Public API
# ------------------------------------------------------------

def fetch_listings(
    algolia_app_id: str,
    algolia_api_key: str,
    *,
    days_label: Optional[str],
    colour_choice: str = "Any",
    price_bands: Optional[List[str]] = None,
    bottle_format: Optional[str] = None,
    index_name: str = DEFAULT_ALGOLIA_INDEX,
    hits_per_page: int = DEFAULT_HITS_PER_PAGE,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> List[Dict]:
    """
    High-level helper to fetch "New to BBX" listings from Algolia.

    Parameters
    ----------
    algolia_app_id : str
        Your Algolia application ID (e.g. 'IR8IZWC7D2').
    algolia_api_key : str
        Your Algolia search API key (NOT the admin key).
    days_label : str or None
        Value of the `new_to_bbx` facet to filter by, e.g. 'Last 7 days'.
        Pass None or '' if you do not want this filter.
    colour_choice : str
        'Any', 'Red', 'White', 'Rosé' etc. 'Any' means union of the three colours.
    price_bands : list[str] or None
        List of price band facet values to filter by. None or [] means no price filter.
    bottle_format : str or None
        Currently only 'Bottle' is special-cased. None means no bottle filter.
    index_name : str
        Algolia index name. Defaults to 'prod_product'.
    hits_per_page : int
        Number of hits per page for the Algolia query.
    max_pages : int
        Maximum number of pages to fetch.

    Returns
    -------
    list[dict]
        A list of Algolia hit dictionaries.
    """

    # Base filters always applied
    base_filters: List[str] = ["stock_origin:'BBX'"]

    if days_label:
        base_filters.append(f"new_to_bbx:'{days_label}'")

    bottle_filter = _build_bottle_filter(bottle_format)
    if bottle_filter:
        base_filters.append(bottle_filter)

    price_filter = _build_price_filter(price_bands)
    if price_filter:
        base_filters.append(price_filter)

    # Case 1: Specific colour -> single query
    if colour_choice != "Any":
        colour_filter = COLOUR_MAP.get(colour_choice)
        filters = base_filters + ([colour_filter] if colour_filter else [])

        return _fetch_with_filters(
            algolia_app_id=algolia_app_id,
            algolia_api_key=algolia_api_key,
            filter_clauses=filters,
            index_name=index_name,
            hits_per_page=hits_per_page,
            max_pages=max_pages,
        )

    # Case 2: Any colour -> union of the three colours
    combined: Dict[str, Dict] = {}

    for colour_filter in COLOUR_MAP.values():
        filters = base_filters + [colour_filter]

        hits = _fetch_with_filters(
            algolia_app_id=algolia_app_id,
            algolia_api_key=algolia_api_key,
            filter_clauses=filters,
            index_name=index_name,
            hits_per_page=hits_per_page,
            max_pages=max_pages,
        )

        # De-duplicate by objectID
        for hit in hits:
            object_id = hit.get("objectID")
            if object_id is not None:
                combined[object_id] = hit

    return list(combined.values())

