#!/usr/bin/env python3
"""
Fetch BBR product variants and pricing via their GraphQL API.
Usage:
    python fetch_bbx_variants.py <sku> <product_path> [--payload PAYLOAD_FILE]
Example:
    python fetch_bbx_variants.py 20101261017 \
        products-20101261017-2010-auxey-duresses-1er-cru-comte-armand-burgundy \
        --payload payload.json
"""
import argparse
import json
import logging
import sys
from pathlib import Path

import requests

# Constants
API_URL = "https://www.bbr.com/api/magento/customProductDetail"
BASE_URL = "https://www.bbr.com"


def fetch_bbx_listing_variants(sku: str, product_path: str, payload_file: Path) -> dict:
    """
    Fetch all variant listings for a given parent SKU from BBR’s GraphQL endpoint.

    :param sku: Parent SKU to filter on (e.g. "20101261017").
    :param product_path: URL path (without domain) for Referer header.
    :param payload_file: Path to the JSON file containing the full GraphQL payload.
    :return: Parsed JSON response as a Python dict.
    """
    session = requests.Session()
    full_url = f"{BASE_URL}/{product_path}"

    # 1) Seed cookies & CSRF token by visiting the actual product page
    resp = session.get(full_url)
    resp.raise_for_status()

    # 2) Mirror browser headers, injecting dynamic Referer and CSRF token
    headers = {
        "Accept":            "application/json, text/plain, */*",
        "Accept-Language":   "en-GB,en;q=0.5",
        "Content-Type":      "application/json",
        "Origin":            BASE_URL,
        "Referer":           full_url,
        "User-Agent":        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/134.0.0.0 Safari/537.36",
        "sec-ch-ua":         '"Chromium";v="134", "Not:A-Brand";v="24", "Brave";v="134"',
        "sec-ch-ua-mobile":  "?0",
        "sec-ch-ua-platform":"\"macOS\"",
        "sec-fetch-dest":    "empty",
        "sec-fetch-mode":    "cors",
        "sec-fetch-site":    "same-origin",
        "sec-gpc":           "1",
        # Include CSRF token as header (cookie already set)
        "X-CSRF-Token":      session.cookies.get("X-CSRF-Token", "")
    }
    session.headers.update(headers)

    # 3) Load and parameterise the GraphQL payload
    try:
        payload = json.loads(payload_file.read_text(encoding="utf-8"))
    except Exception as e:
        logging.error("Failed to load payload file '%s': %s", payload_file, e)
        sys.exit(1)

    # Update the filter SKU
    try:
        payload[0]["variables"]["filter"]["sku"]["eq"] = sku
    except KeyError:
        logging.error("Invalid payload structure: can't find variables.filter.sku.eq")
        sys.exit(1)

    # 4) Send the POST request
    try:
        post_resp = session.post(API_URL, json=payload)
        post_resp.raise_for_status()
    except requests.HTTPError as err:
        logging.error("HTTP error: %s", err)
        logging.error("Status code: %s", err.response.status_code)
        logging.error("Response body: %s", err.response.text)
        sys.exit(1)

    return post_resp.json()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch BBR product variant listings and prices via GraphQL."
    )
    parser.add_argument(
        "sku",
        help="Parent SKU to query (e.g. 20101261017)"
    )
    parser.add_argument(
        "product_path",
        help="URL path for the product (e.g. products-20101261017-... )"
    )
    parser.add_argument(
        "--payload", "-p",
        type=Path,
        default=Path("payload.json"),
        help="Path to the GraphQL payload JSON file"
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    result = fetch_bbx_listing_variants(args.sku, args.product_path, args.payload)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
