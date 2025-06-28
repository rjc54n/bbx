"""
================================================================================
    BBX New Listings Extractor – Production Script
    ------------------------------------------------------------------------
    Purpose:
        This script queries the Algolia-powered BBX index to extract all
        listings marked as "New to BBX" within the past day. It then enriches
        the dataset using the BBX pricing API to provide relevant fields
        including listing price, market value, transaction history, and
        format metadata.

    Key Features:
        • Pulls newly listed BBX wines using Algolia's 'new_to_bbx' facet.
        • Enriches listings with pricing, format, and availability data.
        • Joins metadata and pricing to produce a complete dataset.
        • Outputs CSV file to the /data directory for use by downstream scripts.

    Output:
        /data/bbx_new_enriched.csv – merged and deduplicated dataset.

    Notes:
        • Runs daily or on-demand as a precursor to analysis/filtering scripts.
        • Used by scheduled Heroku tasks and optionally in Streamlit front end.
        • Keeps scope intentionally narrow: no filtering logic is applied.

    Dependencies:
        - Python 3.10+
        - requests, pandas
        - Valid Algolia credentials (APP_ID and API_KEY)
        - Network access to bbr.com APIs

    Author:
        Richard Carvell
================================================================================
"""


import requests
import json
import pandas as pd
import time
import random
from pathlib import Path
# --- CONFIGURATION ---
ALGOLIA_APP_ID = "***REMOVED***"
ALGOLIA_API_KEY = "***REMOVED***"
ALGOLIA_INDEX = "prod_product"
HITS_PER_PAGE = 100
MAX_PAGES = 100
BATCH_SIZE = 24
BASE_DIR = Path(__file__).resolve().parents[1]  # Project root
DATA_DIR = BASE_DIR / "data"
OUTPUT_CSV = DATA_DIR / "bbx_new_enriched.csv"



ALGOLIA_URL = f"https://{ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries"
HEADERS = {
    "x-algolia-application-id": ALGOLIA_APP_ID,
    "x-algolia-api-key": ALGOLIA_API_KEY,
    "Content-Type": "application/json"
}

FIELDS = [
    "parent_sku", "name", "product_url", "family_type", "maturity",
    "colour", "country", "region", "subregion", "grape_varieties",
    "vintage", "sweetness", "producer", "sku", "alcohol_percentage",
    "case_size", "bottle_volume", "bottle_order_unit",
    "bbx_listing_id", "bbx_listing_date"
]

# --- STEP 1: FETCH NEW LISTINGS ---
all_records = []

for page in range(MAX_PAGES):
    print(f"🔄 Fetching page {page + 1}...")

    raw_params = (
        f"hitsPerPage={HITS_PER_PAGE}&page={page}"
        f"&filters=stock_origin:'BBX' AND new_to_bbx:'1 Day'"
    )

    payload = {
        "requests": [{
            "indexName": ALGOLIA_INDEX,
            "params": raw_params
        }]
    }

    response = requests.post(ALGOLIA_URL, headers=HEADERS, data=json.dumps(payload))

    if response.status_code == 200:
        hits = response.json()['results'][0]['hits']
        print(f"📦 Found {len(hits)} new listings")
        if not hits:
            break
        for hit in hits:
            record = {field: hit.get(field, "") for field in FIELDS}
            all_records.append(record)
    else:
        print(f"❌ API Error: {response.status_code}")
        break

    time.sleep(0.5)

metadata_df = pd.DataFrame(all_records)
metadata_df.drop_duplicates(subset="parent_sku", inplace=True)
product_codes = metadata_df["parent_sku"].dropna().astype(str).tolist()

# --- STEP 2: ENRICH WITH BBX PRICING ---
pricing_rows = []
url = "https://www.bbr.com/api/cellarServices/getBiddableCprStock"
headers = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "referer": "https://www.bbr.com/bbx-listings",
    "user-agent": "Mozilla/5.0"
}

print("\n🔄 Fetching BBX pricing data...")
for i in range(0, len(product_codes), BATCH_SIZE):
    batch = product_codes[i:i + BATCH_SIZE]
    batch_label = f"{i+1}-{i+len(batch)}"
    body = [{
        "account_id": "",
        "product_codes": ",".join(batch),
        "is_biddable": True
    }]

    print(f"🔍 Pricing batch {batch_label}...")

    try:
        response = requests.post(url, headers=headers, data=json.dumps(body))
        if response.status_code == 200:
            data = response.json()
            for parent_sku, entries in data.items():
                for entry in entries:
                    pricing_rows.append({
                        "parent_sku": parent_sku,
                        "format": entry.get("format"),
                        "qty_available": entry.get("qty_available"),
                        "highest_bid": entry.get("highest_bid"),
                        "least_listing_price": entry.get("least_listing_price"),
                        "last_bbx_transaction": entry.get("last_bbx_transaction"),
                        "market_price": entry.get("market_price"),
                        "has_already_bidded": entry.get("has_already_bidded")
                    })
        else:
            print(f"❌ API Error {response.status_code} on batch {batch_label}")
    except Exception as e:
        print(f"❌ Exception on batch {batch_label}: {e}")

    time.sleep(random.uniform(0.8, 1.6))

pricing_df = pd.DataFrame(pricing_rows)
pricing_df["parent_sku"] = pricing_df["parent_sku"].astype(str)
metadata_df["parent_sku"] = metadata_df["parent_sku"].astype(str)

# --- JOIN AND EXPORT ---
final_df = pricing_df.merge(metadata_df, on="parent_sku", how="inner")
final_df.to_csv(OUTPUT_CSV, index=False)

print(f"\n✅ Done! Enriched new BBX listings saved to:\n{OUTPUT_CSV}")

