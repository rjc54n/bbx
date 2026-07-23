"""
Format premium correction for BBX's guide price.

BBX's `market_price` is identical to the Liv-ex market price (verified against
115 cellar holdings, 2026-07-23) and Liv-ex quotes a standard 12x75cl case,
scaling every other format by pure volume. Real format premiums are not
volume-linear: a magnum is not "half a double magnum's litres". FORMAT_PREMIUM
below is measured from 450 BBR historic release offers that priced a bottle
case and another format in the same offer, taking the median premium of the
other format's price-per-litre over the bottle case's price-per-litre.

This is release-time retail structure, not an observed secondary-market
premium -- a materially better prior than the guide's implicit 0.0%, not a
target price.
"""
from __future__ import annotations

from typing import Optional

# bottle_volume_ml -> premium over the 750ml price-per-litre, as a fraction.
FORMAT_PREMIUM = {
    375: 0.031,    # half bottle
    750: 0.0,      # reference
    1500: 0.031,   # magnum
    3000: 0.178,   # double magnum
    6000: 0.109,   # imperial / methuselah
    9000: 0.143,   # salmanazar
}


def adjusted_guide_pence(
    market_price_p: Optional[int],
    case_size: Optional[int],
    bottle_volume_ml: Optional[int],
) -> Optional[int]:
    """Apply the format premium to a per-case guide price, in pence.

    `market_price_p` is already a per-case figure (Liv-ex scaled to the
    stored case_size), so the premium applies to the whole value directly --
    `case_size` does not otherwise enter the calculation; it is accepted for
    call-site symmetry with the other per-SKU pricing helpers. An
    unrecognised bottle_volume_ml returns the guide unchanged rather than
    being bucketed to the nearest known size -- silently guessing a format's
    premium is worse than applying none.
    """
    if market_price_p is None:
        return None
    premium = FORMAT_PREMIUM.get(bottle_volume_ml, 0.0)
    return round(market_price_p * (1 + premium))
