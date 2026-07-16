import sys
from pathlib import Path

# -------------------------------------------------------------------
# Ensure project root is on sys.path so "core" package is importable
# when running `streamlit run apps/streamlit_app/streamlit_app.py`.
# -------------------------------------------------------------------
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import streamlit as st
import pandas as pd

from core.pipeline import ScanConfig, run_scan

# ---------------------------------------------
# Algolia credentials for the Streamlit front-end
# ---------------------------------------------
ALGOLIA_APP_ID = st.secrets["ALGOLIA_APP_ID"]
ALGOLIA_API_KEY = st.secrets["ALGOLIA_API_KEY"]

PAYLOAD_FILE = ROOT_DIR / "data" / "payload.json"

# --------------------------------------------------
# Streamlit App: BBX Fine Wine Bargain Hunter
# --------------------------------------------------
# Thin presentation layer over core.pipeline.run_scan:
#   1) Sidebar builds a ScanConfig
#   2) run_scan executes Algolia -> REST -> GraphQL with progress callbacks
#   3) Results and per-phase debug tables are displayed

st.set_page_config(page_title="BBX Bargain Hunter", layout="wide")
st.title("BBX Fine Wine Bargain Hunter")

# --------------------------------------------------
# Sidebar: search scope (Algolia facets)
# --------------------------------------------------

st.sidebar.header("Search Scope")

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
    lookback_label = None

colour_choice = st.sidebar.radio(
    "Colour",
    ["Any", "Red", "White", "Rosé"],
    index=0,
    horizontal=True
)

# Price band facet values must exactly match BBX's UI strings.
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

bottle_mode = st.sidebar.radio(
    "Format",
    ["All Formats", "Bottle"],
    index=0
)

# --------------------------------------------------
# Sidebar: discount thresholds
# --------------------------------------------------
st.sidebar.header("Discount Thresholds")

min_pct_market = st.sidebar.slider("Min % discount vs market", 0, 100, 15)
min_pct_last = st.sidebar.slider("Min % discount vs last transaction", 0, 100, 15)
min_pct_next = st.sidebar.slider("Min % discount vs next lowest listing", 0, 100, 15)

show_debug = st.sidebar.checkbox("Show debug logs", value=False)

# --------------------------------------------------
# Run
# --------------------------------------------------

if st.sidebar.button("Run Bargain Hunter"):

    config = ScanConfig(
        days_label=lookback_label,
        colour_choice=colour_choice,
        price_bands=price_band_choices or None,
        bottle_format=None if bottle_mode == "All Formats" else "Bottle",
        min_pct_market=float(min_pct_market),
        min_pct_last=float(min_pct_last),
        min_pct_next=float(min_pct_next),
    )

    st.info("Scanning BBX (Algolia → pricing → other sellers)...")

    phase_labels = {
        "rest": "Fetching pricing in batches...",
        "graphql": "Checking for other sellers...",
    }
    bars = {}

    def on_progress(phase: str, done: int, total: int):
        if phase not in bars:
            st.write(phase_labels.get(phase, phase))
            bars[phase] = st.progress(0)
        bars[phase].progress(done / max(total, 1))

    with st.spinner("Fetching listings from BBX..."):
        outcome = run_scan(
            ALGOLIA_APP_ID,
            ALGOLIA_API_KEY,
            config,
            payload_path=PAYLOAD_FILE,
            progress=on_progress,
        )

    st.success(
        f"Fetched {outcome.listings_count} listings — "
        f"{outcome.rest_pass_count} passed pricing filters — "
        f"{len(outcome.candidates)} final opportunities"
    )

    if show_debug:
        st.subheader("Phase 2 Debug (REST pricing)")
        st.dataframe(pd.DataFrame(outcome.debug_rest))
        st.subheader("Phase 3 Debug (GraphQL order book)")
        st.dataframe(pd.DataFrame(outcome.debug_gql))

    # ----------------------------
    # Final display
    # ----------------------------
    if outcome.candidates:
        for wine in outcome.candidates:
            st.markdown(f"### {wine['name']} ({wine['vintage']}, {wine['region']})")
            st.markdown(
                f"- Case format: {wine['case_format']}\n"
                f"- Ask price: £{wine['ask']}\n"
                f"- Market price: £{wine['mkt']}\n"
                f"- Last transaction: £{wine['last'] or 'N/A'}\n"
                f"- Next lowest: £{wine['next_lowest'] or 'N/A'}\n"
                f"- % vs market: {wine['pct_market']}%\n"
                f"- % vs last tx: {wine['pct_last'] if wine['pct_last'] is not None else 'N/A'}\n"
                f"- % vs next: {wine['pct_next'] if wine['pct_next'] is not None else 'N/A'}"
            )
            st.markdown(f"[View on BBX]({wine['url']})")
            st.write("---")
    else:
        st.info("No listings match the given criteria.")
