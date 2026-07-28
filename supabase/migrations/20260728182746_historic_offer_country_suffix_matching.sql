-- Exact Algolia matching may ignore a trailing country label only when it
-- matches the candidate's own country field. Existing runs retain v1.
ALTER TABLE public.release_offer_match_runs
    ALTER COLUMN algorithm_version
    SET DEFAULT 'algolia-prod-product-v2-country-suffix';
