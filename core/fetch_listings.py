# core/fetch_listings.py
# ----------------------------------------------
# Helper functions to fetch BBX listings from Algolia.
#
# This module hides the details of how we build Algolia filter strings and
# handle pagination, so callers only need to pass simple choices like:
#   - days_label       ("1 Day", "3 Days", "7 Days", or None for "All BBX")
#   - colour_choice    ("Any", "Red", "White", "Rosé")
#   - price_bands      (list of BBX price band labels)
#   - bottle_format    (None or "Bottle")
#
# Public function:
#   fetch_listings(days_label, colour_choice="Any", price_bands=None, bottle_format=None)
#
# It returns a list of Algolia "hit" dictionaries.
#
# This module is used from:
#   - The Streamlit UI
#   - The CLI arbitrage bot
#   - GitHub Actions
#
# So configuration handling must work in all three contexts:
#   1) Environment variables (preferred)
#   2) Streamlit secrets when running under Streamlit
#
# We never hard code secrets in the code.

# -*- coding: utf-8 -*-

import os
import json
import time
import random

import requests

# Streamlit is optional. The CLI and GitHub Actions do not rely on it.
# We import it defensively and set `st` to None if it is not available.
try:
    import streamlit as st  # type: ignore
except ImportError:
    st = None


# --------------------------------------------------
# 1) Configuration and secret handling
# --------------------------------------------------

def _get_secret(key: str, *, allow_empty: bool = False) -> str:
    """
    Resolve a configuration value in a way that works across environments.

    Resolution order:
      1) Environment variable with this name.
      2) Streamlit secrets (only if Streamlit is importable and secrets exist).

    Parameters
    ----------
    key : str
        The name of the environment variable or Streamlit secret.
    allow_empty : bool
        If False (default), empty strings are treated as "not set" and we
        continue to the next source or raise an error.
        If True, empty strings are accepted.

    Returns
    -------
    str
        The resolved value.

    Raises
    ------
    RuntimeError
        If the key cannot be resolved from env vars or Streamlit secrets.
    """
    # 1) Environment variables take precedence everywhere.
    val = os.environ.get(key)
    if val is not None:
        if allow_empty or val != "":
            return val

    # 2) Fallback to Streamlit secrets only if Streamlit is available.
    if st is not None:
        try:
            # st.secrets behaves like a mapping. We avoid indexing directly
            # to prevent triggering StreamlitSecretNotFoundError unnecessarily.
            secrets_dict = st.secrets
            if key in secrets_dict:
                val = secrets_dict[key]
                if allow_empty or val != "":
                    return val
        except Exception:
            # If anything goes wrong with Streamlit secrets (for example no
            # secrets.toml, missing runtime), we treat that as "not found"
            # and fall through to the error below.
            pass

    # At this point nothing provided a usable value.
    raise RuntimeError(
        f"Missing required configuration value for {key}. "
        f"Set it as an environment variable or in Streamlit secrets.toml."
    )


# App ID and API key can come from:
#   - Environment variables (ALGOLIA_APP_ID, ALGOLIA_API_KEY)
#   - Streamlit secrets, if present
ALGOLIA_APP_ID = _get_secret("ALGOLIA_APP_ID")
ALGOLIA_API_KEY = _get_secret("ALGOLIA_API_KEY")

# We query the same index as your offline scripts.
ALGOLIA_INDEX = "prod_product"

# DSN (distributed search network) endpoint used by the website.
ALGOLIA_URL = f"https://{ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries"

# Standard headers required by Algolia.
HEADERS = {
    "x-algolia-application-id": ALGOLIA_APP_ID,
    "x-algolia-api-key": ALGOLIA_API_KEY,
    "Content-Type": "application/json",
}

# Pagination parameters.
# Algolia limits how many results you can get in one query (usually about 1,000).
# We fetch pages of 100 hits until there are no more hits or we hit MAX_PAGES.
HITS_PER_PAGE = 100
MAX_PAGES = 500   # safety upper bound; loop usually breaks much earlier


# --------------------------------------------------
# 2) Facet mappings (UI label -> Algolia filter clause)
# --------------------------------------------------

# Colour facet: the values here must match Algolia's "colour" facet.
COLOUR_MAP = {
    "Red": "colour:'Red'",
    "White": "colour:'White'",
    "Rosé": "colour:'Rosé'",
}

# Price facet:
# The BBX website uses a string facet called "prices.price_per_case" with
# labels like "up to £200", "£200-£499.99", and so on.
PRICE_FACET_FIELD = "prices.price_per_case"

# Bottle format facet:
# The website uses a facet like purchase_options.bottle_order_unit:'Bottle'
BOTTLE_FACET_FIELD = "purchase_options.bottle_order_unit"


# --------------------------------------------------
# 3) Helpers to build filter clauses
# --------------------------------------------------

def _build_price_filter(price_bands):
    """
    Convert a list of price band labels into a single Algolia filter string.

    Example input:
        ["up to £200", "£200-£499.99"]

    Example output:
        "(prices.price_per_case:'up to £200' OR prices.price_per_case:'£200-£499.99')"

    If price_bands is empty or None, we return None and no price filter is applied.
    """
    if not price_bands:
        return None

    clauses = []
    for band in price_bands:
        # Each band becomes a simple facet equality on the price facet field.
        # The labels must exactly match BBX's facet values.
        clause = "{field}:'{val}'".format(field=PRICE_FACET_FIELD, val=band)
        clauses.append(clause)

    if not clauses:
        return None

    # If there is more than one selected band, we OR them together inside brackets.
    # This lets Algolia match any of the selected bands.
    return "(" + " OR ".join(clauses) + ")"


def _build_bottle_filter(bottle_format):
    """
    Convert a bottle_format choice into an Algolia filter.

    - If bottle_format is "Bottle":
          we filter to purchase_options.bottle_order_unit:'Bottle'
    - If bottle_format is None or any other value:
          we return None and do not add any format restriction.
    """
    if bottle_format == "Bottle":
        return "{field}:'Bottle'".format(field=BOTTLE_FACET_FIELD)
    return None


def _fetch_with_filters(filter_clauses):
    """
    Core low-level function that actually talks to Algolia.

    Parameters
    ----------
    filter_clauses : list of strings
        Each string is a single Algolia filter expression, for example:
            "stock_origin:'BBX'"
            "new_to_bbx:'3 Days'"
            "(prices.price_per_case:'up to £200' OR prices.price_per_case:'£200-£499.99')"
            "colour:'Red'"

        These clauses will be joined with " AND " to form the final `filters` parameter.

    Returns
    -------
    list of dict
        A list of Algolia "hit" dictionaries.
    """
    all_records = []

    # Join the individual filter clauses with AND.
    filter_str = " AND ".join(filter_clauses)

    for page in range(MAX_PAGES):
        # Build the query string for this page.
        raw_params = (
            "hitsPerPage={hits}&page={page}&filters={filters}".format(
                hits=HITS_PER_PAGE,
                page=page,
                filters=filter_str,
            )
        )

        # Algolia expects a "multi-index" payload even if we only query one index.
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

        # If Algolia returns a non-200 response, we stop rather than looping forever.
        if response.status_code != 200:
            break

        data = response.json()
        results = data.get("results", [])
        hits = results[0].get("hits", []) if results else []

        # When there are no more hits, we break out of the paging loop.
        if not hits:
            break

        all_records.extend(hits)

        # Throttle slightly so we do not hammer the API.
        time.sleep(random.uniform(0.5, 1.0))

    return all_records


# --------------------------------------------------
# 4) Public entry point used by the Streamlit app and arbitrage bot
# --------------------------------------------------

def fetch_listings(days_label, colour_choice="Any", price_bands=None, bottle_format=None):
    """
    Fetch listings from Algolia, using the same filters as the Streamlit UI.

    Parameters
    ----------
    days_label : str or None
        - If a string (for example "1 Day", "3 Days", "7 Days"):
              we apply `new_to_bbx:'{days_label}'` so only "New to BBX" listings
              within that lookback window are returned.
        - If None:
              we do not apply the new_to_bbx filter and instead search all BBX.

    colour_choice : str
        One of:
            "Any"   -> no colour restriction; we query Red, White, and Rosé
                       separately and merge the results.
            "Red"   -> add colour:'Red'
            "White" -> add colour:'White'
            "Rosé"  -> add colour:'Rosé'

    price_bands : list of str
        Zero or more of:
            "up to £200",
            "£200-£499.99",
            "£500-£999.99",
            "£1000-£2499.99",
            "£2500-£4999.99",
            "£5000 and up"
        If the list is empty or None, no price facet is applied.

    bottle_format : str or None
        - "Bottle" -> apply purchase_options.bottle_order_unit:'Bottle'
        - None     -> no bottle-format filter (all formats included)

    Returns
    -------
    list of dict
        A list of Algolia hit dictionaries matching the chosen filters.
    """

    # Base filters that always apply to this app:
    #   stock_origin:'BBX' ensures we only see BBX stock, not retail.
    base_filters = ["stock_origin:'BBX'"]

    # Optional "New to BBX" filter:
    # If days_label is given, restrict to the "New to BBX" facet,
    # otherwise (All BBX) we do not include this clause.
    if days_label:
        base_filters.append("new_to_bbx:'{days}'".format(days=days_label))

    # Optional bottle format filter (for example Bottle only).
    bottle_filter = _build_bottle_filter(bottle_format)
    if bottle_filter:
        base_filters.append(bottle_filter)

    # Optional price band facet.
    price_filter = _build_price_filter(price_bands)
    if price_filter:
        base_filters.append(price_filter)

    # ------------------------------
    # Colour handling
    # ------------------------------
    # We treat colour in two modes:
    #   1) Specific colour ("Red", "White", "Rosé"):
    #        -> we add the relevant colour facet and do a single query.
    #   2) "Any":
    #        -> we query each colour bucket separately and merge by objectID.
    #           This helps us get more than 1,000 total hits as long as
    #           each individual colour bucket stays under its own 1,000 cap.
    # ------------------------------

    # Case 1: a specific colour was chosen.
    if colour_choice and colour_choice != "Any":
        colour_filter = COLOUR_MAP.get(colour_choice)
        filter_clauses = list(base_filters)
        if colour_filter:
            filter_clauses.append(colour_filter)
        return _fetch_with_filters(filter_clauses)

    # Case 2: "Any" colour selected.
    # We will fetch Red, White, and Rosé separately and combine them.
    combined_by_id = {}

    for label, colour_filter in COLOUR_MAP.items():
        filter_clauses = list(base_filters)
        filter_clauses.append(colour_filter)

        hits = _fetch_with_filters(filter_clauses)

        # Store each hit in a dict keyed by objectID to avoid duplicates
        # (a listing should not appear under more than one colour, but this
        #  is a cheap safety measure).
        for h in hits:
            obj_id = h.get("objectID")
            if obj_id is not None:
                combined_by_id[obj_id] = h

    # Return the de duplicated combined list of hits.
    return list(combined_by_id.values())
