-- Weekly Gmail ingestion has no uploaded source file. The complete message
-- evidence is retained in each raw source row instead. Historic CSV imports
-- still require a private Storage object and a bounded byte size.

ALTER TABLE public.release_offer_imports
    ALTER COLUMN byte_size DROP NOT NULL,
    ALTER COLUMN storage_object_path DROP NOT NULL;

ALTER TABLE public.release_offer_imports
    ADD CONSTRAINT release_offer_imports_source_storage_check
    CHECK (
        (
            source_type = 'historic_csv'
            AND byte_size IS NOT NULL
            AND storage_object_path IS NOT NULL
        )
        OR
        (
            source_type = 'gmail'
            AND byte_size IS NULL
            AND storage_object_path IS NULL
        )
    );

CREATE INDEX idx_release_offer_imports_imported_by
    ON public.release_offer_imports(imported_by);
CREATE INDEX idx_release_offer_imports_accepted_by
    ON public.release_offer_imports(accepted_by)
    WHERE accepted_by IS NOT NULL;
CREATE INDEX idx_release_anchor_overrides_confirmed_by
    ON public.release_price_anchor_overrides(confirmed_by);

COMMENT ON COLUMN public.release_offer_imports.storage_object_path IS
    'Private source file for historic_csv imports; null for Gmail batches whose complete message evidence is stored in raw source rows.';
