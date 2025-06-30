# Bargain Hunter Filter & Enrichment Script v1.1
# Purpose: Identify standout BBX listings for long-term value or personal consumption
# Criteria:
# - 25%+ discount vs market value
# - 25%+ discount vs last transaction price
# - 25%+ discount vs next lowest listing (if exists)
# - 75cl bottles only (standard format)

import pandas as pd
import logging
from pathlib import Path
from core.fetch_bbx_variants import fetch_bbx_listing_variants

# --- CONFIGURATION ---
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR.parent / "data"
INPUT_CSV = DATA_DIR / "bbx_new_enriched.csv"
OUTPUT_CSV = DATA_DIR / "bbx_bargain_opportunities.csv"
PAYLOAD_PATH = DATA_DIR / "payload.json"

# --- USER-ADJUSTABLE THRESHOLDS ---
DISCOUNT_THRESHOLD_MARKET = 0.10        # % discount
DISCOUNT_THRESHOLD_LAST_TX = 0.10        # % discount
DISCOUNT_THRESHOLD_NEXT_LISTING = 0.10        # % discount
TARGET_FORMAT = "6 x 75 cl"      # Only standard cases
MIN_VALID_PRICE = 50             # Filter out £0 or suspicious prices
MAX_VALID_PRICE = 500            # Filter out expensive cases
# --- FORMAT NORMALISATION ---
def format_case_string(raw_format):
    try:
        parts = raw_format.split("-")           # Example: "12-00750"
        case_qty = int(parts[0])                # "12"
        volume_cl = int(parts[1]) // 10         # "00750" becomes 75
        return f"{case_qty} x {volume_cl} cl"
    except Exception:
        return raw_format or "Unknown format"   # Fallback if something fails

# --- READ INPUT CSV ---
df = pd.read_csv(INPUT_CSV)

# --- FILTER & EVALUATE ---
opportunities = []

for _, row in df.iterrows():
    ask = row.get("least_listing_price", 0)
    market = row.get("market_price", 0)
    last_tx = row.get("last_bbx_transaction", 0)
    raw_fmt = row.get("format", "")
    sku = row.get("parent_sku", "")
    name = row.get("name", "")
    qty = row.get("qty_available", "N/A")
    product_url = row.get("product_url", "").lstrip("/")

    # --- Normalise format ---
    fmt = format_case_string(raw_fmt)
    row["format"] = fmt  # Replace for later output

    # --- Basic filters ---
    if ask < MIN_VALID_PRICE or ask > MAX_VALID_PRICE or fmt != TARGET_FORMAT:
        continue
    # --- Quick pre-check: skip if not at least threshold below market ---
    if market <= 0 or ask <= 0:
        continue
    if (market - ask) / market < DISCOUNT_THRESHOLD_MARKET:
        continue  # Not a compelling enough discount, skip before API call


    try:
        # --- Fetch listing variants from BBX ---
        variant_data = fetch_bbx_listing_variants(sku, product_url, PAYLOAD_PATH)
        variants = variant_data["data"]["products"]["items"][0].get("variants", [])
        prices = sorted([
            v["product"]["custom_prices"]["price_per_case"]["amount"]["value"]
            for v in variants if v.get("product")
        ])

        next_lowest = prices[1] if len(prices) > 1 else None

        # --- Discount checks ---
        discounts = {
            "vs_market": (market - ask) / market if market > 0 else 0,
            "vs_last_tx": (last_tx - ask) / last_tx if last_tx > 0 else 0,
            "vs_next_lowest": (next_lowest - ask) / next_lowest if next_lowest else 0
        }

        if (
            discounts["vs_market"] >= DISCOUNT_THRESHOLD_MARKET and
            (last_tx == 0 or discounts["vs_last_tx"] >= DISCOUNT_THRESHOLD_LAST_TX) and
            (next_lowest is None or discounts["vs_next_lowest"] >= DISCOUNT_THRESHOLD_NEXT_LISTING)
        ):
            row["discount_vs_market"] = round(discounts["vs_market"] * 100, 1)
            row["discount_vs_last_tx"] = (
                round(discounts["vs_last_tx"] * 100, 1) if last_tx > 0 else "N/A"
            )
            row["discount_vs_next_lowest"] = (
                round(discounts["vs_next_lowest"] * 100, 1) if next_lowest else "N/A"
            )
            row["next_lowest_listing"] = next_lowest

            print(f"📦 {name} | {fmt} | Qty: {qty} | Ask: £{ask}")
            print(f"   Discount: {row['discount_vs_market']}% vs market £{market} | "
                  f"{row['discount_vs_last_tx']}% vs last tx £{last_tx} | "
                  f"{row['discount_vs_next_lowest']}% vs next listing £{next_lowest if next_lowest else 'N/A'}")

            opportunities.append(row)

    except Exception as e:
        logging.error(f"❌ Error fetching variants for SKU {sku}: {e}")

# --- EXPORT ---
pd.DataFrame(opportunities).to_csv(OUTPUT_CSV, index=False)
print(f"\n✅ Done! Value opportunities saved to:\n{OUTPUT_CSV}")