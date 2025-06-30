# core/filters.py
# ----------------------------------------------
# A helper to apply your bargain-hunting criteria to a set
# of BBX listings, filtering out those that don't meet thresholds.

import pandas as pd


def apply_bargain_filters(
    variants: list[dict],
    min_pct_market: float,
    min_pct_last: float,
    max_price_per_case: float,
    case_format: str | None = None
) -> list[dict]:
    """
    Filters a list of BBX variant dicts based on discount and price criteria.

    Args:
        variants: list of dicts, each with at least the keys:
            - 'pct_discount_market': float
            - 'pct_discount_last': float
            - 'price_per_case': float
            - optional 'case_format': str
        min_pct_market: minimum % discount vs market required
        min_pct_last:   minimum % discount vs last transaction required
        max_price_per_case: maximum allowed price per case (£)
        case_format:    optional exact case format to include (e.g. '6 x 75 cl')

    Returns:
        A list of dicts representing the variants that meet all criteria.
    """
    # 1) Convert the list of dicts into a pandas DataFrame for vectorised filtering
    df = pd.DataFrame(variants)

    # 2) If there are no records or missing required columns, return the input unfiltered
    required_cols = {'pct_discount_market', 'pct_discount_last', 'price_per_case'}
    if df.empty or not required_cols.issubset(df.columns):
        return variants

    # 3) Build a boolean mask for the numeric thresholds
    mask = (
        (df['pct_discount_market'] >= min_pct_market) &  # market discount threshold
        (df['pct_discount_last']   >= min_pct_last)   &  # last tx discount threshold
        (df['price_per_case']      <= max_price_per_case) # price cap
    )

    # 4) If a specific case_format is requested, further narrow the mask
    if case_format:
        mask &= (df['case_format'] == case_format)

    # 5) Use the mask to select rows and convert back to a list of dicts
    filtered_variants = df[mask].to_dict(orient='records')

    # 6) Return only those variants that passed all filters
    return filtered_variants

