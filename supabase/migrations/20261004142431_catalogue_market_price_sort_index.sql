-- The unfiltered landing page orders by these columns. A local data-copy
-- comparison found a 3,497,984-byte index and a narrower page read plan.
CREATE INDEX idx_catalogue_mv_market_price_order
    ON public.catalogue_mv (market_price_p ASC NULLS LAST, parent_sku ASC, format_code ASC);
