# core/fetch_listings.py
# ----------------------------------------------
# Shared helper to fetch BBX listings from Algolia.
# This module:
# - DOES NOT read environment variables
# - DOES NOT use Streamlit or st.secrets
# - ONLY uses the Algolia credentials passed in as arguments
#
# Pagination cap and sharding
# ---------------------------
# The prod_product index truncates any single query at 1,000 hits
# (10 pages x 100 hitsPerPage; larger hitsPerPage is clamped to 100).
# The full BBX book is ~15k listings, so a broad query CANNOT be paged
# in full. When a filter set exceeds the cap, we shard it by facet
# (region, then colour, then price band, then vintage), recursing only
# into shards that are still over the cap, plus one NOT-query per level
# to catch records missing the facet entirely. Results are de-duplicated
# by objectID.
#
# Politeness: every request is followed by a small jittered sleep, and
# 429/5xx responses are retried with exponential backoff. Sharding is
# lazy — narrow queries (e.g. "new in last N days") never shard and cost
# the same handful of requests they always did.

import json
import logging
import time
import random
import requests
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlencode


# ------------------------------------------------------------
# Constants (pure configuration, no secrets involved)
# ------------------------------------------------------------

DEFAULT_ALGOLIA_INDEX = "prod_product"
DEFAULT_HITS_PER_PAGE = 100
DEFAULT_MAX_PAGES = 500

# The index refuses to return hits beyond this many per filter set.
PAGINATION_CAP = 1000

# Facet helpers
COLOUR_MAP = {
    "Red": "colour:'Red'",
    "White": "colour:'White'",
    "Rosé": "colour:'Rosé'",
}

PRICE_FACET_FIELD = "prices.price_per_case"
BOTTLE_FACET_FIELD = "purchase_options.bottle_order_unit"

# Facet dimensions used to shard over-cap queries, in splitting order.
# Region first (80 values, mostly small), then colour, price band, vintage.
SHARD_DIMENSIONS = ["region", "colour", PRICE_FACET_FIELD, "vintage"]

# Politeness knobs
REQUEST_JITTER = (0.2, 0.5)      # seconds slept after every request
MAX_RETRIES = 3                  # attempts per request on 429/5xx
BACKOFF_BASE = 2.0               # seconds; doubles per retry


# ------------------------------------------------------------
# Low-level HTTP
# ------------------------------------------------------------

def _build_algolia_url_and_headers(
    algolia_app_id: str,
    algolia_api_key: str,
) -> Tuple[str, Dict[str, str]]:
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


def _algolia_query(
    algolia_app_id: str,
    algolia_api_key: str,
    params: str,
    index_name: str = DEFAULT_ALGOLIA_INDEX,
    request_timeout: int = 20,
) -> Dict:
    """
    Execute one Algolia query and return the first result object.

    Retries with exponential backoff on 429/5xx; raises on other failures.
    Sleeps a small jittered interval after every request so callers never
    hammer the endpoint regardless of how they loop.
    """
    url, headers = _build_algolia_url_and_headers(algolia_app_id, algolia_api_key)
    payload = {"requests": [{"indexName": index_name, "params": params}]}

    for attempt in range(MAX_RETRIES):
        response = requests.post(
            url, headers=headers, data=json.dumps(payload), timeout=request_timeout
        )
        time.sleep(random.uniform(*REQUEST_JITTER))

        if response.status_code == 200:
            return response.json()["results"][0]

        if response.status_code == 429 or response.status_code >= 500:
            wait = BACKOFF_BASE * (2 ** attempt)
            logging.warning(
                f"Algolia returned {response.status_code}; retrying in {wait:.0f}s "
                f"(attempt {attempt + 1}/{MAX_RETRIES})"
            )
            time.sleep(wait)
            continue

        # Fail loudly: a bad/expired key must not look like "no results".
        raise RuntimeError(
            f"Algolia query failed with status {response.status_code}: "
            f"{response.text[:500]}"
        )

    raise RuntimeError(
        f"Algolia query failed after {MAX_RETRIES} attempts (last status "
        f"{response.status_code})."
    )


# ------------------------------------------------------------
# Filter builders (pure functions)
# ------------------------------------------------------------

def _escape_facet_value(value: str) -> str:
    """Escape single quotes in a facet value for the Algolia filter syntax."""
    return value.replace("'", "\\'")


def _build_price_filter(price_bands: Optional[List[str]]) -> Optional[str]:
    """
    Build an Algolia facet filter string for the selected price bands.
    Example output: "(prices.price_per_case:'£100-£200' OR prices.price_per_case:'£200-£300')"
    """
    if not price_bands:
        return None

    parts = [f"{PRICE_FACET_FIELD}:'{_escape_facet_value(b)}'" for b in price_bands]
    return "(" + " OR ".join(parts) + ")"


def _build_bottle_filter(bottle_format: Optional[str]) -> Optional[str]:
    """
    Build a filter for bottle format when the user selects "Bottle".
    """
    if bottle_format == "Bottle":
        return f"{BOTTLE_FACET_FIELD}:'Bottle'"
    return None


def _build_not_filter(facet_field: str, values: List[str]) -> List[str]:
    """
    Build filter clauses matching records that have NONE of the given
    values for a facet — i.e. the records a facet-sharded sweep would miss.
    """
    return [f"NOT {facet_field}:'{_escape_facet_value(v)}'" for v in values]


# ------------------------------------------------------------
# Paged fetch (single filter set, subject to the pagination cap)
# ------------------------------------------------------------

def _fetch_with_filters(
    algolia_app_id: str,
    algolia_api_key: str,
    filter_clauses: List[str],
    index_name: str = DEFAULT_ALGOLIA_INDEX,
    hits_per_page: int = DEFAULT_HITS_PER_PAGE,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> List[Dict]:
    """
    Fetch every page for one filter set. Retrieves at most PAGINATION_CAP
    hits — callers with broader queries must shard (see _fetch_sharded).
    """
    all_records: List[Dict] = []
    filter_str = " AND ".join(filter_clauses)

    for page in range(max_pages):
        # urlencode: facet values may contain '&', spaces, or unicode that
        # would otherwise corrupt the query string.
        params = urlencode({
            "hitsPerPage": hits_per_page,
            "page": page,
            "filters": filter_str,
        })
        result = _algolia_query(
            algolia_app_id, algolia_api_key, params, index_name
        )
        hits = result.get("hits", [])
        if not hits:
            break
        all_records.extend(hits)
        if len(hits) < hits_per_page:
            # Short page = last page; skip the confirming empty request.
            break

    return all_records


def _count_and_facets(
    algolia_app_id: str,
    algolia_api_key: str,
    filter_clauses: List[str],
    facet_fields: List[str],
    index_name: str = DEFAULT_ALGOLIA_INDEX,
) -> Tuple[int, Dict[str, Dict[str, int]]]:
    """
    Cheap hitsPerPage=0 query returning (nbHits, facet value counts) for a
    filter set. Used to decide whether and how to shard.
    """
    filter_str = " AND ".join(filter_clauses)
    params = urlencode({
        "hitsPerPage": 0,
        "filters": filter_str,
        "facets": json.dumps(facet_fields),
        "maxValuesPerFacet": 1000,
    })
    result = _algolia_query(algolia_app_id, algolia_api_key, params, index_name)
    return result.get("nbHits", 0), result.get("facets") or {}


# ------------------------------------------------------------
# Sharded fetch (handles filter sets larger than the pagination cap)
# ------------------------------------------------------------

def _fetch_sharded(
    algolia_app_id: str,
    algolia_api_key: str,
    filter_clauses: List[str],
    shard_dims: List[str],
    collected: Dict[str, Dict],
    index_name: str = DEFAULT_ALGOLIA_INDEX,
    hits_per_page: int = DEFAULT_HITS_PER_PAGE,
    known_count: Optional[int] = None,
) -> None:
    """
    Recursively fetch a filter set, splitting by facet whenever it exceeds
    the pagination cap. Results accumulate into `collected` keyed by
    objectID (which also de-duplicates across overlapping shards).

    known_count: this shard's size as reported by the parent's facet counts.
    When it is safely under the cap we skip the count query entirely —
    the count is only needed to decide whether (and how) to split further.
    """
    if known_count is not None and known_count <= PAGINATION_CAP:
        hits = _fetch_with_filters(
            algolia_app_id, algolia_api_key, filter_clauses,
            index_name=index_name, hits_per_page=hits_per_page,
        )
        for hit in hits:
            object_id = hit.get("objectID")
            if object_id is not None:
                collected[object_id] = hit
        return

    nb_hits, facets = _count_and_facets(
        algolia_app_id, algolia_api_key, filter_clauses, shard_dims[:1], index_name
    )

    if nb_hits == 0:
        return

    if nb_hits <= PAGINATION_CAP or not shard_dims:
        if nb_hits > PAGINATION_CAP:
            logging.warning(
                f"Filter set {filter_clauses} has {nb_hits} hits but no shard "
                f"dimensions remain; truncating at {PAGINATION_CAP}."
            )
        hits = _fetch_with_filters(
            algolia_app_id, algolia_api_key, filter_clauses,
            index_name=index_name, hits_per_page=hits_per_page,
        )
        for hit in hits:
            object_id = hit.get("objectID")
            if object_id is not None:
                collected[object_id] = hit
        return

    # Over the cap: split by the first shard dimension with usable counts.
    facet_field = shard_dims[0]
    counts = facets.get(facet_field) or {}

    if not counts:
        # Facet unusable here (no values under this filter set) — try the next.
        _fetch_sharded(
            algolia_app_id, algolia_api_key, filter_clauses, shard_dims[1:],
            collected, index_name, hits_per_page,
        )
        return

    logging.info(
        f"Sharding {nb_hits} hits by '{facet_field}' ({len(counts)} values) "
        f"under filters {filter_clauses}"
    )

    for value, value_count in counts.items():
        sub_filters = filter_clauses + [
            f"{facet_field}:'{_escape_facet_value(value)}'"
        ]
        _fetch_sharded(
            algolia_app_id, algolia_api_key, sub_filters, shard_dims[1:],
            collected, index_name, hits_per_page,
            known_count=value_count,
        )

    # Records with no value for this facet match none of the shards above.
    covered = sum(counts.values())
    if covered < nb_hits:
        not_filters = filter_clauses + _build_not_filter(facet_field, list(counts))
        _fetch_sharded(
            algolia_app_id, algolia_api_key, not_filters, shard_dims[1:],
            collected, index_name, hits_per_page,
        )


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
    max_pages: int = DEFAULT_MAX_PAGES,  # kept for API compatibility
) -> List[Dict]:
    """
    High-level helper to fetch BBX listings from Algolia.

    Parameters
    ----------
    algolia_app_id : str
        Your Algolia application ID.
    algolia_api_key : str
        Your Algolia search API key (NOT the admin key).
    days_label : str or None
        Value of the `new_to_bbx` facet to filter by, e.g. 'Last 7 days'.
        Pass None or '' for all BBX listings (triggers a sharded sweep).
    colour_choice : str
        'Any', 'Red', 'White', 'Rosé'. 'Any' means no colour filter.
    price_bands : list[str] or None
        Price band facet values to filter by. None or [] means no price filter.
    bottle_format : str or None
        Currently only 'Bottle' is special-cased. None means no bottle filter.

    Returns
    -------
    list[dict]
        A list of Algolia hit dictionaries, complete even when the result
        set exceeds the index's 1,000-hit pagination cap.
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

    # "Any" means no colour filter at all. (Previously this was implemented as
    # the union of Red/White/Rosé, which silently excluded any listing whose
    # colour facet was missing or had another value.)
    if colour_choice != "Any":
        colour_filter = COLOUR_MAP.get(colour_choice)
        if colour_filter:
            base_filters.append(colour_filter)

    # Don't shard on dimensions the caller has already pinned down.
    shard_dims = [
        d for d in SHARD_DIMENSIONS
        if not (d == "colour" and colour_choice != "Any")
        and not (d == PRICE_FACET_FIELD and price_bands)
    ]

    collected: Dict[str, Dict] = {}
    _fetch_sharded(
        algolia_app_id, algolia_api_key, base_filters, shard_dims,
        collected, index_name, hits_per_page,
    )

    return list(collected.values())
