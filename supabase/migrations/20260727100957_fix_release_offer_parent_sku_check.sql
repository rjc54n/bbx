ALTER TABLE public.release_offer_product_resolutions
    DROP CONSTRAINT release_offer_product_resolutions_parent_sku_check;

ALTER TABLE public.release_offer_product_resolutions
    ADD CONSTRAINT release_offer_product_resolutions_parent_sku_check
    CHECK (parent_sku IS NULL OR parent_sku ~ '^[0-9]{5,30}$');
