#!/usr/bin/env python3
"""
Fetch BBR product variants and pricing via their GraphQL API.

Library usage:
    payload = load_payload(Path("data/payload.json"))
    data = fetch_bbx_listing_variants(sku, product_path, payload)

CLI usage:
    python fetch_bbx_variants.py <sku> <product_path> [--payload PAYLOAD_FILE]
"""
import argparse
import copy
import json
import logging
import sys
from pathlib import Path

import requests

# Constants
API_URL = "https://www.bbr.com/api/magento/customProductDetail"
BASE_URL = "https://www.bbr.com"

REQUEST_TIMEOUT = 30

_BROWSER_HEADERS = {
    "Accept":            "application/json, text/plain, */*",
    "Accept-Language":   "en-GB,en;q=0.5",
    "Content-Type":      "application/json",
    "Origin":            BASE_URL,
    "User-Agent":        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                         "AppleWebKit/537.36 (KHTML, like Gecko) "
                         "Chrome/134.0.0.0 Safari/537.36",
    "sec-ch-ua":         '"Chromium";v="134", "Not:A-Brand";v="24", "Brave";v="134"',
    "sec-ch-ua-mobile":  "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest":    "empty",
    "sec-fetch-mode":    "cors",
    "sec-fetch-site":    "same-origin",
    "sec-gpc":           "1",
}


def load_payload(payload_file: Path) -> list:
    """
    Load the GraphQL payload template from a JSON file and validate its shape.

    Raises ValueError if the file is unreadable or does not contain the
    expected variables.filter.sku.eq slot.
    """
    try:
        payload = json.loads(payload_file.read_text(encoding="utf-8"))
    except Exception as e:
        raise ValueError(f"Failed to load payload file '{payload_file}': {e}") from e

    try:
        payload[0]["variables"]["filter"]["sku"]["eq"]
    except (KeyError, IndexError, TypeError) as e:
        raise ValueError(
            f"Invalid payload structure in '{payload_file}': "
            "can't find variables.filter.sku.eq"
        ) from e

    return payload


def fetch_bbx_listing_variants(
    sku: str,
    product_path: str,
    payload: list,
    session: requests.Session | None = None,
) -> dict:
    """
    Fetch all variant listings for a given parent SKU from BBR's GraphQL endpoint.

    :param sku: Parent SKU to filter on (e.g. "20101261017").
    :param product_path: URL path (without domain) for the Referer header.
    :param payload: GraphQL payload template (from load_payload). Not mutated.
    :param session: Optional shared requests.Session. Reusing one session across
                    calls keeps cookies warm and pools connections.
    :return: Parsed JSON response as a Python dict.
    :raises requests.RequestException: on any HTTP failure.
    """
    if session is None:
        session = requests.Session()
    full_url = f"{BASE_URL}/{product_path.lstrip('/')}"

    # 1) Seed cookies & CSRF token by visiting the actual product page
    resp = session.get(full_url, headers=_BROWSER_HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()

    # 2) Mirror browser headers, injecting dynamic Referer and CSRF token
    headers = {
        **_BROWSER_HEADERS,
        "Referer": full_url,
        "X-CSRF-Token": session.cookies.get("X-CSRF-Token", ""),
    }

    # 3) Parameterise the payload with this SKU (deep copy: template is shared)
    body = copy.deepcopy(payload)
    body[0]["variables"]["filter"]["sku"]["eq"] = sku

    # 4) Send the POST request
    post_resp = session.post(API_URL, json=body, headers=headers, timeout=REQUEST_TIMEOUT)
    post_resp.raise_for_status()

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
        default=Path(__file__).resolve().parents[1] / "data" / "payload.json",
        help="Path to the GraphQL payload JSON file"
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    try:
        payload = load_payload(args.payload)
        result = fetch_bbx_listing_variants(args.sku, args.product_path, payload)
    except (ValueError, requests.RequestException) as e:
        logging.error("%s", e)
        sys.exit(1)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
