# apps/arbitrage_bot/run_arbitrage.py
# --------------------------------------------------------------
# Automated BBX arbitrage scanner.
#
# Pipeline:
#   1) Fetch listings via Algolia ("new to BBX" X days)
#   2) REST pricing enrichment
#   3) GraphQL enrichment (next-lowest price)
#   4) Apply discount filters
#   5) Deduplicate against prior notifications
#   6) Slack notify with compact summary
#
# --------------------------------------------------------------

import sys
from pathlib import Path

# --------------------------------------------------------------------
# Ensure the project root is on sys.path so "core" is importable
# when calling: python3 apps/arbitrage_bot/run_arbitrage.py
# --------------------------------------------------------------------
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import os
import logging

from core.fetch_listings import fetch_listings
from core.fetch_bbx_variants import fetch_bbx_listing_variants
from core.enrichment import REST_URL, REST_HEADERS
from core.slack import send_slack_message
from core.notification_state import (
    load_notification_state,
    save_notification_state,
    filter_new_or_improved,
)

import requests

# --------------------------------------------------------------
# PARAMETERS
# --------------------------------------------------------------

CADENCE_MINUTES = 60

# Lookback window for Algolia "new_to_bbx" facet.
# Maps to "1 Day", "2 Days", "3 Days", "7 Days".
LOOKBACK_DAYS = 1

# Arbitrage discount thresholds (percent)
MIN_PCT_MARKET = 15.0
MIN_PCT_LAST   = 15.0
MIN_PCT_NEXT   = 15.0

# Price sanity threshold (REST/GraphQL ask_price)
MIN_CASE_PRICE = 1.0

# Slack formatting limits
MAX_WINES_PER_ALERT = 20

# When True: print Slack messages locally but do not send
DRY_RUN = False

# Path for persistent notification state (used locally; CI uses S3)
STATE_FILE = Path("data/arbitrage_state.json")

# Re-notification interval when ask is unchanged (in days)
REMINDER_INTERVAL_DAYS = 7

# Control whether we send "no new or improved opportunities" messages.
SEND_EMPTY_ALERTS = True


# --------------------------------------------------------------
# Environment / credentials helpers
# --------------------------------------------------------------

def get_algolia_credentials():
    """
    Read Algolia credentials from environment variables.

    Designed for non-Streamlit environments such as:
      - local CLI runs
      - GitHub Actions

    Required environment variables:
      - ALGOLIA_APP_ID
      - ALGOLIA_API_KEY
    """
    app_id = os.environ.get("ALGOLIA_APP_ID")
    api_key = os.environ.get("ALGOLIA_API_KEY")

    if not app_id or not api_key:
        raise RuntimeError(
            "Algolia credentials not found in environment. "
            "Set ALGOLIA_APP_ID and ALGOLIA_API_KEY before running."
        )

    logging.info(f"Algolia APP ID length: {len(app_id)}")
    logging.info(f"Algolia API KEY length: {len(api_key)}")

    return app_id, api_key


# --------------------------------------------------------------
# Helpers
# --------------------------------------------------------------

def compute_discounts(entry, rest_data, gql_data):
    """
    Computes pct_market, pct_last, pct_next for a listing.
    Mirrors the logic in the Streamlit app.

    Parameters
    ----------
    entry : dict
        Algolia hit.
    rest_data : dict
        The REST pricing record for this SKU.
    gql_data : dict
        Entire GraphQL response (raw).

    Returns
    -------
    dict or None
        Discount metrics and prices, or None if they cannot be computed.
    """
    ask_raw  = rest_data.get("least_listing_price")
    mkt_raw  = rest_data.get("market_price")
    last_raw = rest_data.get("last_bbx_transaction")

    try:
        ask = float(ask_raw)
        mkt = float(mkt_raw)
    except Exception:
        return None

    if ask <= 0 or mkt <= 0:
        return None

    pct_market = round((mkt - ask) / mkt * 100, 1)
    pct_last   = None

    try:
        last = float(last_raw)
        if last > 0:
            pct_last = round((last - ask) / last * 100, 1)
    except Exception:
        pct_last = None

    # Now extract next-lowest price from GraphQL
    try:
        items = gql_data.get("data", {}).get("products", {}).get("items", [])
        variants = items[0].get("variants", []) if items else []
    except Exception:
        return None

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
            # Skip variants with malformed data
            pass

    if not prices:
        next_lowest = None
        pct_next = None
    else:
        sorted_prices = sorted(prices)
        higher = [p for p in sorted_prices if p > ask]
        next_lowest = higher[0] if higher else None
        pct_next = (
            round((next_lowest - ask) / next_lowest * 100, 1)
            if next_lowest else None
        )

    return {
        "ask": ask,
        "mkt": mkt,
        "last": last_raw,
        "pct_market": pct_market,
        "pct_last": pct_last,
        "next_lowest": next_lowest,
        "pct_next": pct_next,
    }


def derive_case_format(entry):
    """
    Derive a compact case format string for Slack output, eg "6x75cl".

    Priority:
      1) Use case_size and bottle_volume if present.
      2) Fall back to entry["format"] if available, normalised a bit.
      3) Return "N/A" if nothing useful is present.
    """
    case_size = entry.get("case_size")
    bottle_volume = entry.get("bottle_volume")

    if case_size and bottle_volume:
        # Expect something like 6 and "75cl" -> "6x75cl"
        return f"{case_size}x{bottle_volume}"

    fmt = entry.get("format")
    if isinstance(fmt, str) and fmt.strip():
        # Normalise common "6 x 75cl" to "6x75cl"
        return fmt.replace(" x ", "x").replace(" ", "")

    return "N/A"


# --------------------------------------------------------------
# Main arbitrage function (raw candidates, no dedup)
# --------------------------------------------------------------

def run_arbitrage():
    """
    Run a single arbitrage scan:
      - Fetch "new to BBX" listings from Algolia
      - Enrich with REST pricing
      - Enrich with GraphQL variant prices
      - Apply discount thresholds

    Returns
    -------
    list[dict]
        A list of candidate opportunities with pricing and discount metrics.
        Deduplication and notification state are applied elsewhere.
    """
    logging.info("Starting BBX arbitrage scan...")

    # Resolve Algolia credentials from environment (GitHub Actions / CLI)
    algolia_app_id, algolia_api_key = get_algolia_credentials()

    # Phase 1: Fetch "new to BBX" via Algolia
    label = f"{LOOKBACK_DAYS} Day" if LOOKBACK_DAYS == 1 else f"{LOOKBACK_DAYS} Days"

    logging.info(f"Fetching listings for 'new_to_bbx' window: {label}")
    listings = fetch_listings(
        algolia_app_id,
        algolia_api_key,
        days_label=label,      # same facet label used in the Streamlit UI
        colour_choice="Any",   # all colours
        price_bands=None,      # all price bands
        bottle_format=None,    # all formats
    )

    if not listings:
        logging.warning("No listings fetched from Algolia.")
        return []

    logging.info(f"Fetched {len(listings)} listings from Algolia.")

    # Build preliminary list (only entries with parent_sku)
    prelim = [
        (v, v.get("parent_sku"))
        for v in listings
        if v.get("parent_sku")
    ]

    if not prelim:
        logging.warning("No listings had a parent_sku. Nothing to process.")
        return []

    # Phase 2: REST batch pricing
    rest_results = {}
    BATCH = 24

    logging.info(f"Running REST pricing in batches of {BATCH}...")
    for i in range(0, len(prelim), BATCH):
        batch = prelim[i:i + BATCH]
        _, skus = zip(*batch)
        sku_list = ",".join(skus)

        try:
            resp = requests.post(
                REST_URL,
                headers=REST_HEADERS,
                json=[{
                    "account_id": "",
                    "product_codes": sku_list,
                    "is_biddable": True
                }],
                timeout=10
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logging.error(f"REST batch error: {e}")
            continue

        # Merge into rest_results dict
        for sku in skus:
            if sku in data and data[sku]:
                rest_results[sku] = data[sku][0]

    if not rest_results:
        logging.warning("No REST pricing results were obtained.")
        return []

    # Phase 3: GraphQL enrichment
    candidates = []
    logging.info("Running GraphQL enrichment and applying discount filters...")

    for entry, sku in prelim:
        rest_rec = rest_results.get(sku)
        if not rest_rec:
            continue

        # Sanity price check
        try:
            ask = float(rest_rec.get("least_listing_price"))
        except Exception:
            continue

        if ask <= MIN_CASE_PRICE:
            continue

        # GraphQL fetch
        path = entry.get("product_path", entry.get("product_url", "")).lstrip("/")
        gql = {}
        try:
            gql = fetch_bbx_listing_variants(sku, path, Path("data/payload.json"))
        except Exception as e:
            logging.error(f"GraphQL error for SKU {sku}: {e}")
            continue

        disc = compute_discounts(entry, rest_rec, gql)
        if not disc:
            continue

        # Apply discount filters
        if disc["pct_market"] < MIN_PCT_MARKET:
            continue
        if disc["pct_last"] is not None and disc["pct_last"] < MIN_PCT_LAST:
            continue
        if disc["pct_next"] is not None and disc["pct_next"] < MIN_PCT_NEXT:
            continue

        # Derive case format for Slack output
        case_format = derive_case_format(entry)

        # Build result record
        candidates.append({
            "name": entry.get("name"),
            "vintage": entry.get("vintage"),
            "region": entry.get("region"),
            "sku": sku,
            "case_format": case_format,
            **disc,
            "url": f"https://www.bbr.com/{path}",
        })

    logging.info(f"Arbitrage scan complete. {len(candidates)} raw candidates found.")
    return candidates


# --------------------------------------------------------------
# Slack message builder
# --------------------------------------------------------------

def format_slack_message(candidates, suppressed=None):
    """
    Build a compact Slack message summarising candidates.

    Parameters
    ----------
    candidates : list[dict]
        Candidates that will be notified this run.
    suppressed : list[dict] or None
        Candidates that were suppressed due to deduplication rules.

    Returns
    -------
    str
        Message suitable for sending to a Slack webhook.
    """
    suppressed = suppressed or []
    suppressed_count = len(suppressed)

    if not candidates:
        base = "BBX arbitrage scan: no new or improved opportunities found."
        if suppressed_count:
            return (
                f"{base}\n"
                f"(Suppressed {suppressed_count} previously-notified opportunities this run.)"
            )
        return base

    header = (
        f"BBX arbitrage scan - {len(candidates)} candidates "
        f"(mkt>={MIN_PCT_MARKET}%, last>={MIN_PCT_LAST}%, next>={MIN_PCT_NEXT}%)"
    )

    lines = [header]
    for i, c in enumerate(candidates[:MAX_WINES_PER_ALERT], start=1):
        case_fmt = c.get("case_format", "N/A")
        line = (
            f"{i}. {c['name']} ({c['vintage']}, {c['region']}, {case_fmt}) - "
            f"£{c['ask']} ask | £{c['mkt']} mkt ({c['pct_market']}%) | "
            f"last {c['pct_last']}% | next {c['pct_next']}% - {c['url']}"
        )
        lines.append(line)

    if len(candidates) > MAX_WINES_PER_ALERT:
        lines.append(f"... and {len(candidates) - MAX_WINES_PER_ALERT} more.")

    if suppressed_count:
        lines.append(
            f"(Suppressed {suppressed_count} previously-notified opportunities this run.)"
        )

    return "\n".join(lines)


# --------------------------------------------------------------
# Entry point
# --------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # 1) Load prior notification state
    state = load_notification_state(STATE_FILE)

    # 2) Run arbitrage scan to get raw candidates
    all_candidates = run_arbitrage()

    # 3) Apply deduplication rules
    notified, suppressed, new_state = filter_new_or_improved(
        all_candidates,
        state,
        reminder_days=REMINDER_INTERVAL_DAYS,
    )

    # 4) Build Slack message
    msg = format_slack_message(notified, suppressed)

    # 5) Send or print, depending on DRY_RUN and SEND_EMPTY_ALERTS
    if DRY_RUN:
        print(msg)
    else:
        if notified or SEND_EMPTY_ALERTS:
            send_slack_message(msg)

    # 6) Persist updated notification state
    save_notification_state(STATE_FILE, new_state)



