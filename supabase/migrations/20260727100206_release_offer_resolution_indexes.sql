CREATE INDEX idx_release_offer_product_resolutions_resolved_by
    ON public.release_offer_product_resolutions(resolved_by)
    WHERE resolved_by IS NOT NULL;
