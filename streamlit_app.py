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
# Phases:
#   1) Fetch listings from Algolia
#   2) Batched REST pricing + preliminary filtering
#   3) GraphQL enrichment + case‐format sanity‐check + next‐lowest discount + debug trail + clean display

st.set_page_config(page_title="BBX Bargain Hunter", layout="wide")
st.title("BBX Fine Wine Bargain Hunter")

# --- Sidebar: Filter Parameters ---
st.sidebar.header("Filter Parameters")
min_pct_market   = st.sidebar.slider("Min % discount vs market", 0, 100, 15)
min_pct_last     = st.sidebar.slider("Min % discount vs last transaction", 0, 100, 15)
max_price        = st.sidebar.number_input("Max price per case (£)", min_value=0.0, value=500.0)
lookback_choice  = st.sidebar.radio("Days to look back on BBX", [1, 2, 3, 7], index=0)
lookback_label   = f"{lookback_choice} Day" if lookback_choice == 1 else f"{lookback_choice} Days"
case_fmt         = st.sidebar.selectbox("Case format", ["Any", "6 x 75 cl", "12 x 75 cl", "3 x 75 cl"])
min_pct_next     = st.sidebar.slider("Min % discount vs next lowest listing", 0, 100, 15)
show_debug       = st.sidebar.checkbox("Show debug logs", value=False)

# --- Main Action ---
if st.sidebar.button("Run Bargain Hunter"):

    # Phase 1: Fetch listings (no case filter at this stage)
    with st.spinner("Fetching listings from BBX..."):
        listings = fetch_listings(days_label=lookback_label, case_format=None)
    st.success(f"Fetched {len(listings)} listings")

    # Phase 2: Batched REST pricing & preliminary filtering
    st.info("Fetching pricing and applying preliminary filters in batches...")
    BATCH_SIZE  = 24
    prelim      = [
        (v, str(v["parent_sku"]), v.get("format") or v.get("case_size"))
        for v in listings if v.get("parent_sku")
    ]
    total_batches = (len(prelim) + BATCH_SIZE - 1) // BATCH_SIZE
    batch_bar      = st.progress(0)
    rest_candidates = []
    debug2          = []

    for b in range(total_batches):
        start = b * BATCH_SIZE
        batch = prelim[start:start + BATCH_SIZE]
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
            for _, sku, fmt in batch:
                debug2.append({"sku": sku, "format": fmt, "reason": f"batch REST error: {e}", "passed": False})
            batch_bar.progress((b + 1) / total_batches)
            continue

        for v, sku, fmt in batch:
            rec     = {"sku": sku, "format": fmt}
            entries = data.get(sku) or []
            if not entries:
                debug2.append({**rec, "reason": "no REST data", "passed": False})
                continue

            entry      = entries[0]
            raw_ask    = entry.get("least_listing_price")
            raw_mkt    = entry.get("market_price")
            raw_last   = entry.get("last_bbx_transaction")
            rec.update({"raw_ask": raw_ask, "raw_mkt": raw_mkt, "raw_last": raw_last})

            try:
                ask_price    = float(raw_ask)
                market_price = float(raw_mkt)
            except:
                debug2.append({**rec, "reason": "invalid ask/market", "passed": False})
                continue

            if ask_price <= 0 or market_price <= 0:
                debug2.append({**rec, "reason": "ask or market ≤ 0", "passed": False})
                continue

            pct_market = round((market_price - ask_price) / market_price * 100, 1)
            pct_last   = None
            try:
                last_tx = float(raw_last)
                if last_tx > 0:
                    pct_last = round((last_tx - ask_price) / last_tx * 100, 1)
            except:
                pct_last = None

            fails = (
                pct_market < min_pct_market,
                ask_price   > max_price,
                pct_last is not None and pct_last < min_pct_last,
            )
            if any(fails):
                reasons = []
                if fails[0]:
                    reasons.append(f"mkt {pct_market}% < {min_pct_market}%")
                if fails[1]:
                    reasons.append(f"price £{ask_price} > £{max_price}")
                if fails[2]:
                    reasons.append(f"last {pct_last}% < {min_pct_last}%")
                debug2.append({
                    **rec,
                    "pct_market": pct_market,
                    "pct_last":   pct_last,
                    "reason":     "; ".join(reasons),
                    "passed":     False
                })
                continue

            v.update({
                "price_per_case":       ask_price,
                "market_price":         market_price,
                "last_tx":              last_tx,
                "pct_discount_market":  pct_market,
                "pct_discount_last":    pct_last
            })
            rest_candidates.append(v)
            debug2.append({
                **rec,
                "pct_market": pct_market,
                "pct_last":   pct_last,
                "reason":     "passed",
                "passed":     True
            })

        batch_bar.progress((b + 1) / total_batches)

    st.success(f"Pricing complete: {len(rest_candidates)} candidates")

    if show_debug:
        st.subheader("Phase 2 Debug")
        st.dataframe(pd.DataFrame(debug2))

    # Phase 3: GraphQL enrichment + debug3 trail
    st.info("Checking for other sellers and applying final filters...")
    gql_bar        = st.progress(0)
    final_list     = []
    debug3         = []
    total_rest     = len(rest_candidates)

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

            # --- Case‐format extraction and sanity‐check ---
            # Build a proper case‐format string from the Algolia hit
            if isinstance(v.get("format"), str) and " x " in v.get("format"):
                computed_fmt = v["format"]
            elif v.get("case_size") and v.get("bottle_volume"):
                computed_fmt = f"{v['case_size']} x {v['bottle_volume']}"
            else:
                computed_fmt = None

            rec3["computed_case_format"] = computed_fmt

            # Only enforce if user selected a specific format
            if case_fmt != "Any" and computed_fmt != case_fmt:
                rec3.update(passed=False, reason=f"case format {computed_fmt!r} != {case_fmt!r}")
                debug3.append(rec3)
                continue

            # Gather all variant prices from GraphQL
            prices = []
            for variant in variants:
                try:
                    amt = (variant["product"]
                                    ["custom_prices"]
                                    ["price_per_case"]
                                    ["amount"]
                                    ["value"])
                    prices.append(float(amt))
                except:
                    pass
            rec3["prices_raw"] = prices.copy()

            if not prices:
                rec3.update(passed=False, reason="no variant prices")
                debug3.append(rec3)
                continue

            # Keep REST ask separate
            ask_price = v["price_per_case"]

            # Sort GraphQL prices and find the first price > ask_price
            sorted_prices = sorted(prices)
            next_prices   = [p for p in sorted_prices if p > ask_price]
            next_lowest   = next_prices[0] if next_prices else None
            rec3.update(lowest=ask_price, next_lowest=next_lowest)

            # Compute pct_next vs ask_price / next_lowest
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

            raw_path = v.get("product_url") or v.get("product_path") or ""
            if raw_path.startswith("http"):
                bbx_url = raw_path
            else:
                bbx_url = f"https://www.bbr.com{raw_path}"

            final_list.append({
                "name": v["name"],
                "vintage": v["vintage"],
                "region": v["region"],
                "case_format": computed_fmt,
                "ask_price": ask_price,
                "market_price": v["market_price"],
                "last_tx": v["last_tx"],
                "next_lowest_price": next_lowest,
                "pct_discount_market": v["pct_discount_market"],
                "pct_discount_last": v["pct_discount_last"],
                "pct_discount_next": pct_next,
                "bbx_url": bbx_url
            })

        except Exception as e:
            rec3.update(passed=False, reason=f"GraphQL error: {e}")
            debug3.append(rec3)

    st.success(f"Found {len(final_list)} opportunities after final filtering")

    if show_debug:
        st.subheader("Phase 3 Debug")
        st.dataframe(pd.DataFrame(debug3))

    # --- Final display ---
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
                f"- % vs last tx: {wine['pct_discount_last']}%\n"
                f"- % vs next: {wine['pct_discount_next'] or 'N/A'}%"
            )
            st.markdown(f"[View on BBX]({wine['bbx_url']})")
            st.write("---")
    else:
        st.info("No listings match the given criteria.")
