import streamlit as st
import pandas as pd
import requests
import random
from pathlib import Path

from core.fetch_listings import fetch_listings
from core.fetch_bbx_variants import fetch_bbx_listing_variants
from core.filters import apply_bargain_filters
from core.enrichment import REST_URL, REST_HEADERS

# --------------------------------------------------
# Streamlit App: BBX Fine Wine Bargain Hunter
# --------------------------------------------------
# High-level flow:
#   1) Fetch filtered listings from Algolia (colour, price bands, bottle format, new/all BBX)
#   2) Fetch REST pricing & apply preliminary discount filters
#   3) Enrich with GraphQL (case sanity check + next-lowest discount)
#   4) Display opportunities

st.set_page_config(page_title="BBX Bargain Hunter", layout="wide")
st.title("BBX Fine Wine Bargain Hunter")

# --------------------------------------------------
# Sidebar: Algolia-driven filters (Phase 1)
# --------------------------------------------------

st.sidebar.header("Search Scope")

# 1) Scope toggle: New to BBX vs All BBX.
#    - New: requires selecting a lookback window (1,2,3,7 days)
#    - All: the lookback filter is not applied to Algolia.
scope_mode = st.sidebar.radio(
    "Listing scope",
    ["New to BBX", "All BBX"],
    index=0
)

if scope_mode == "New to BBX":
    lookback_choice = st.sidebar.radio(
        "Days to look back",
        [1, 2, 3, 7],
        index=0
    )
    lookback_label = f"{lookback_choice} Day" if lookback_choice == 1 else f"{lookback_choice} Days"
else:
    # In “All BBX” mode we pass None to fetch_listings
    lookback_choice = None
    lookback_label  = None

# 2) Colour facet (Algolia string facet)
colour_choice = st.sidebar.radio(
    "Colour",
    ["Any", "Red", "White", "Rosé"],
    index=0,
    horizontal=True
)

# 3) Price band facet — replaces "Max price per case"
#    These must exactly match BBX’s UI strings, because Algolia treats them as facet values.
PRICE_BANDS = [
    "up to £200",
    "£200-£499.99",
    "£500-£999.99",
    "£1000-£2499.99",
    "£2500-£4999.99",
    "£5000 and up",
]

price_band_choices = st.sidebar.multiselect(
    "Price per case",
    PRICE_BANDS,
    default=[],
    help="BBX price bands. Leave empty for all prices."
)

# 4) Bottle format facet — replacing old case format filter.
#    "Bottle" corresponds to the Algolia facet: purchase_options.bottle_order_unit:'Bottle'
#    "All Formats" = no format filter applied.
bottle_mode = st.sidebar.radio(
    "Format",
    ["All Formats", "Bottle"],
    index=0
)

# --------------------------------------------------
# Secondary filters (post-Algolia, applied in REST/GraphQL)
# --------------------------------------------------
st.sidebar.header("Discount Thresholds")

min_pct_market = st.sidebar.slider("Min % discount vs market", 0, 100, 15)
min_pct_last   = st.sidebar.slider("Min % discount vs last transaction", 0, 100, 15)
min_pct_next   = st.sidebar.slider("Min % discount vs next lowest listing", 0, 100, 15)

# Debug output
show_debug = st.sidebar.checkbox("Show debug logs", value=False)

# --------------------------------------------------
# Run button
# --------------------------------------------------

if st.sidebar.button("Run Bargain Hunter"):

    # ----------------------------
    # Phase 1: Algolia fetch
    # ----------------------------
    st.info("Fetching listings from BBX (Algolia)...")

    # Convert bottle format mode into the parameter used by fetch_listings
    # None  -> All formats
    # "Bottle" -> apply Algolia facet purchase_options.bottle_order_unit:'Bottle'
    format_filter = None if bottle_mode == "All Formats" else "Bottle"

    # Fetch listings using the new facet-driven parameters
    with st.spinner("Fetching listings from BBX..."):
        listings = fetch_listings(
            days_label=lookback_label,         # None means All BBX
            colour_choice=colour_choice,       # Algolia facet
            price_bands=price_band_choices,    # Algolia facet
            bottle_format=format_filter        # "Bottle" or None
        )

    st.success(f"Fetched {len(listings)} listings")

