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

    # Convert bottle format mode into the parameter used by fetch_listings:
    #   None    -> All formats
    #   "Bottle" -> restrict to bottle-orderable listings
    format_filter = None if bottle_mode == "All Formats" else "Bottle"

    with st.spinner("Fetching listings from BBX..."):
        listings = fetch_listings(
            days_label=lookback_label,         # None means All BBX
            colour_choice=colour_choice,       # Algolia colour facet
            price_bands=price_band_choices,    # Algolia price facet
            bottle_format=format_filter        # "Bottle" or None
        )

    st.success(f"Fetched {len(listings)} listings")

    if show_debug:
        st.subheader("Phase 1 Debug")
        st.write("Example hit keys:", list(listings[0].keys()) if listings else "No hits")
        st.write("Total listings from Algolia:", len(listings))

    # ----------------------------
    # Phase 2: REST pricing and preliminary filters
    # ----------------------------
    st.info("Fetching pricing and applying preliminary filters in batches...")

    # We only send listings that have a parent_sku, because that is the key
    # the REST pricing API expects.
    BATCH_SIZE = 24
    prelim = [
        (v, str(v["parent_sku"]), v.get("format") or v.get("case_size"))
        for v in listings
        if v.get("parent_sku")
    ]

    total_batches   = (len(prelim) + BATCH_SIZE - 1) // BATCH_SIZE
    batch_bar       = st.progress(0)
    rest_candidates = []   # listings that pass REST-level filters
    debug2          = []   # debug rows for Phase 2

    for b in range(total_batches):
        start = b * BATCH_SIZE
        batch = prelim[start:start + BATCH_SIZE]

        # batch is a list of tuples: (hit_dict, sku, format_str)
        _, skus, fmts = zip(*batch)
        sku_list = ",".join(skus)

        try:
            resp = requests.post(
                REST_URL,
                headers=REST_HEADERS,
                json=[{"account_id": "", "product_codes": sku_list, "is_biddable": True}],
                timeout=10
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            # If the REST call fails for this batch, record the error for each SKU
            for _, sku, fmt in batch:
                debug2.append({
                    "sku": sku,
                    "format": fmt,
                    "reason": f"batch REST error: {e}",
                    "passed": False
                })
            batch_bar.progress((b + 1) / max(total_batches, 1))
            continue

        # Process each item in the batch using the REST response
        for v, sku, fmt in batch:
            rec     = {"sku": sku, "format": fmt}
            entries = data.get(sku) or []

            if not entries:
                debug2.append({**rec, "reason": "no REST data", "passed": False})
                continue

            entry    = entries[0]
            raw_ask  = entry.get("least_listing_price")
            raw_mkt  = entry.get("market_price")
            raw_last = entry.get("last_bbx_transaction")
            rec.update({"raw_ask": raw_ask, "raw_mkt": raw_mkt, "raw_last": raw_last})

            # Convert REST prices to floats
            try:
                ask_price    = float(raw_ask)
                market_price = float(raw_mkt)
            except Exception:
                debug2.append({**rec, "reason": "invalid ask/market", "passed": False})
                continue

            if ask_price <= 0 or market_price <= 0:
                debug2.append({**rec, "reason": "ask or market <= 0", "passed": False})
                continue

            # Compute discount vs market
            pct_market = round((market_price - ask_price) / market_price * 100, 1)

            # Discount vs last transaction is optional because last_tx may be missing
            pct_last = None
            last_tx  = None
            try:
                last_tx_val = float(raw_last)
                if last_tx_val > 0:
                    last_tx    = last_tx_val
                    pct_last   = round((last_tx_val - ask_price) / last_tx_val * 100, 1)
            except Exception:
                pct_last = None

            # Apply preliminary threshold filters.
            # Note: price ceiling is now controlled by the Algolia price facet,
            # so we do not check ask_price against a max_price here.
            fails = (
                pct_market < min_pct_market,
                pct_last is not None and pct_last < min_pct_last,
            )

            if any(fails):
                reasons = []
                if fails[0]:
                    reasons.append(f"mkt {pct_market}% < {min_pct_market}%")
                if fails[1]:
                    reasons.append(f"last {pct_last}% < {min_pct_last}%")
                debug2.append({
                    **rec,
                    "pct_market": pct_market,
                    "pct_last":   pct_last,
                    "reason":     "; ".join(reasons),
                    "passed":     False
                })
                continue

            # Attach the numeric fields to the Algolia hit dict so later phases
            # (GraphQL enrichment and display) can use them.
            v.update({
                "price_per_case":      ask_price,
                "market_price":        market_price,
                "last_tx":             last_tx,
                "pct_discount_market": pct_market,
                "pct_discount_last":   pct_last
            })
            rest_candidates.append(v)

            debug2.append({
                **rec,
                "pct_market": pct_market,
                "pct_last":   pct_last,
                "reason":     "passed",
                "passed":     True
            })

        batch_bar.progress((b + 1) / max(total_batches, 1))

    st.success(f"Pricing complete: {len(rest_candidates)} candidates")

    if show_debug:
        st.subheader("Phase 2 Debug")
        st.dataframe(pd.DataFrame(debug2))

    # ----------------------------
    # Phase 3: GraphQL enrichment
    # ----------------------------
    st.info("Checking for other sellers and applying final filters...")

    gql_bar    = st.progress(0)
    final_list = []
    debug3     = []
    total_rest = len(rest_candidates)

    for idx, v in enumerate(rest_candidates, start=1):
        gql_bar.progress(idx / max(total_rest, 1))
        sku   = v.get("parent_sku")
        rec3  = {"sku": sku}
        path  = v.get("product_path", v.get("product_url", "")).lstrip('/')

        try:
            gql_data  = fetch_bbx_listing_variants(sku, path, Path("data/payload.json"))
            data_node = gql_data.get("data", {}).get("products")
            items     = data_node.get("items", []) if data_node else []
            rec3["item_count"] = len(items)

            if not items:
                if show_debug:
                    st.subheader(f"Raw GraphQL response for {sku}")
                    st.json(gql_data)
                rec3.update(passed=False, reason="no products in GraphQL")
                debug3.append(rec3)
                continue

            variants = items[0].get("variants", [])
            rec3["variant_count"] = len(variants)

            # --- Case format extraction and sanity check ---
            # Note: we no longer filter by case format here, because the UI
            # only distinguishes "Bottle" vs "All formats" at Algolia level.
            if isinstance(v.get("format"), str) and " x " in v.get("format"):
                computed_fmt = v["format"]
            elif v.get("case_size") and v.get("bottle_volume"):
                computed_fmt = f"{v['case_size']} x {v['bottle_volume']}"
            else:
                computed_fmt = None

            rec3["computed_case_format"] = computed_fmt

            # Gather all variant prices from GraphQL
            prices = []
            for variant in variants:
                try:
                    amt = (
                        variant["product"]
                               ["custom_prices"]
                               ["price_per_case"]
                               ["amount"]
                               ["value"]
                    )
                    prices.append(float(amt))
                except Exception:
                    # If a variant does not have a well-formed price, skip it
                    pass
            rec3["prices_raw"] = prices.copy()

            if not prices:
                rec3.update(passed=False, reason="no variant prices")
                debug3.append(rec3)
                continue

            # Ask price from Phase 2
            ask_price = v["price_per_case"]

            # Sort GraphQL prices and find the first price greater than ask_price.
            sorted_prices = sorted(prices)
            next_prices   = [p for p in sorted_prices if p > ask_price]
            next_lowest   = next_prices[0] if next_prices else None
            rec3.update(lowest=ask_price, next_lowest=next_lowest)

            # Compute discount vs next lowest listing (if one exists)
            pct_next = None
            if next_lowest is not None:
                pct_next = round((next_lowest - ask_price) / next_lowest * 100, 1)
                rec3["pct_next"] = pct_next
                if pct_next < min_pct_next:
                    rec3.update(passed=False, reason=f"pct_next {pct_next}% < {min_pct_next}%")
                    debug3.append(rec3)
                    continue

            rec3.update(passed=True)
            debug3.append(rec3)

            # Build a usable BBX URL from the product path
            raw_path = v.get("product_url") or v.get("product_path") or ""
            if raw_path.startswith("http"):
                bbx_url = raw_path
            else:
                bbx_url = f"https://www.bbr.com{raw_path}"

            final_list.append({
                "name":                 v["name"],
                "vintage":              v["vintage"],
                "region":               v["region"],
                "case_format":          computed_fmt,
                "ask_price":            ask_price,
                "market_price":         v["market_price"],
                "last_tx":              v["last_tx"],
                "next_lowest_price":    next_lowest,
                "pct_discount_market":  v["pct_discount_market"],
                "pct_discount_last":    v["pct_discount_last"],
                "pct_discount_next":    pct_next,
                "bbx_url":              bbx_url,
            })

        except Exception as e:
            rec3.update(passed=False, reason=f"GraphQL error: {e}")
            debug3.append(rec3)

    st.success(f"Found {len(final_list)} opportunities after final filtering")

    if show_debug:
        st.subheader("Phase 3 Debug")
        st.dataframe(pd.DataFrame(debug3))

    # ----------------------------
    # Final display
    # ----------------------------
    if final_list:
        for wine in final_list:
            st.markdown(f"### {wine['name']} ({wine['vintage']}, {wine['region']})")
            st.markdown(
                f"- Case format: {wine['case_format']}\n"
                f"- Ask price: £{wine['ask_price']}\n"
                f"- Market price: £{wine['market_price']}\n"
                f"- Last transaction: £{wine['last_tx'] or 'N/A'}\n"
                f"- Next lowest: £{wine['next_lowest_price'] or 'N/A'}\n"
                f"- % vs market: {wine['pct_discount_market']}%\n"
                f"- % vs last tx: {wine['pct_discount_last']}\n"
                f"- % vs next: {wine['pct_discount_next'] or 'N/A'}%"
            )
            st.markdown(f"[View on BBX]({wine['bbx_url']})")
            st.write("---")
    else:
        st.info("No listings match the given criteria.")