"""
================================================================================
BBX Arbitrage Detection & Slack Alerting Script (v1.1)
--------------------------------------------------------------------------------
Author: Richard Carvell
Purpose:
    This script identifies internal arbitrage opportunities within BBX listings,
    enriches selected entries with real-time competitive pricing data via the
    BBX GraphQL API, and calculates potential and adjusted profits.

    Opportunities are filtered based on price advantage vs. last transaction
    and market prices. Slack notifications are sent for each qualified listing.

Inputs:
    - CSV file of enriched BBX listings (output of new_listings.py)
    - GraphQL payload template (payload.json)

Outputs:
    - CSV of arbitrage-qualified listings (bbx_arbitrage_opportunities.csv)
    - Slack message for each opportunity

Dependencies:
    - pandas
    - requests
    - fetch_bbx_variants (internal BBX helper module)

Notes:
    - Adjusts profit expectations by comparing against competing BBX listings.
    - Designed to run hourly on Heroku or manually in development.
    - Payload file must be located in the /data directory.

Last Updated: 2025-06-28
================================================================================
"""


import pandas as pd
import logging
import requests
from pathlib import Path
from core.fetch_bbx_variants import fetch_bbx_listing_variants

# --- CONFIGURATION ---
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR.parent / "data"
INPUT_CSV = DATA_DIR / "bbx_new_enriched.csv"
OUTPUT_CSV = DATA_DIR / "bbx_arbitrage_opportunities.csv"
PAYLOAD_PATH = DATA_DIR / "payload.json"
SLACK_WEBHOOK_URL = "***REMOVED***"

# --- FORMAT HELPERS ---
def format_case_string(raw_format):
    try:
        parts = raw_format.split("-")
        case_qty = int(parts[0])
        volume_cl = int(parts[1]) // 10
        return f"{case_qty} x {volume_cl} cl"
    except Exception:
        return raw_format or "Unknown format"

# --- ARBITRAGE CRITERIA ---
def check_arbitrage(row):
    ask = row.get("least_listing_price", 0)
    last_tx = row.get("last_bbx_transaction", 0)
    market = row.get("market_price", 0)

    if ask == 0 or last_tx == 0:
        return False, None

    sale_price = min(last_tx, market if market > 0 else last_tx)
    potential_profit = (sale_price * 0.9) - ask
    return (ask < sale_price * 0.9), potential_profit

# --- SLACK NOTIFICATION ---
def send_slack_message(message):
    payload = {"text": message}
    try:
        response = requests.post(SLACK_WEBHOOK_URL, json=payload)
        if response.status_code == 200:
            print("✅ Slack message sent.")
        else:
            print(f"⚠️ Slack failed: {response.status_code}")
    except Exception as e:
        print(f"❌ Slack error: {e}")

# --- MAIN LOGIC ---
df = pd.read_csv(INPUT_CSV)
opportunities = []

for _, row in df.iterrows():
    is_arbitrage, profit = check_arbitrage(row)
    if not is_arbitrage:
        continue

    ask_price = row['least_listing_price']
    last_txn = row['last_bbx_transaction']
    market_price = row['market_price']
    wine_name = row['name']
    product_url = row.get("product_url", "").lstrip("/")
    sku = row["parent_sku"]
    case_format = format_case_string(row.get("format"))
    qty = row.get("qty_available", "N/A")

    row["potential_profit"] = round(profit, 2)
    row["case_format_pretty"] = case_format

    # --- BBX variant enrichment ---
    try:
        variant_data = fetch_bbx_listing_variants(sku, product_url, PAYLOAD_PATH)
        variants = variant_data["data"]["products"]["items"][0].get("variants", [])
        prices = sorted({
            v["product"]["custom_prices"]["price_per_case"]["amount"]["value"]
            for v in variants if v.get("product")
        })

        print(f"Wine: {wine_name}, Format: {case_format}, Qty: {qty}, Ask Price: £{ask_price}, "
              f"Last Transaction: £{last_txn}, Market Price: £{market_price}, "
              f"Potential Profit: £{row['potential_profit']}")
        print(f"   Other BBX prices: {prices}")

        # Adjust profit based on likely sale price (second lowest listing, if it exists)
        second_bbx_price = prices[1] if len(prices) > 1 else None
        resale_candidates = [p for p in [market_price, last_txn, second_bbx_price] if p and p > 0]
        if resale_candidates:
            resale_floor = min(resale_candidates)
            adjusted_profit = round((resale_floor * 0.9) - ask_price, 2)
            row["adjusted_profit"] = adjusted_profit
            print(f"   Adjusted Profit (inc. resale comp): £{adjusted_profit}")
        else:
            adjusted_profit = None
    except Exception as e:
        logging.error(f"❌ Failed to fetch variants for SKU {sku}: {e}")
        adjusted_profit = None

    # --- Slack Notification ---
    full_url = f"https://www.bbr.com/{product_url}"
    slack_message = (
        f"*Arbitrage Opportunity*\n"
        f"*{wine_name}*  \n"
        f"Format: {case_format}, Qty: {qty}  \n"
        f"Ask: £{ask_price}, Market: £{market_price}, Last Tx: £{last_txn}  \n"
        f"Potential Profit: £{round(profit, 2)}"
    )
    if adjusted_profit is not None:
        slack_message += f"\nAdjusted Profit (realistic): £{adjusted_profit}"
    slack_message += f"\n<{full_url}|View on BBX>"

    send_slack_message(slack_message)
    opportunities.append(row)

# --- EXPORT ---
pd.DataFrame(opportunities).to_csv(OUTPUT_CSV, index=False)
print(f"\n✅ Done! Arbitrage opportunities saved to:\n{OUTPUT_CSV}")

