-- Revert Slice 3's coverage expression: restore the stored-integer metric.
--
-- 20260903190000 replaced the coverage numerator with a token overlap computed
-- by private.wine_coverage_tokens / private.wine_token_coverage. It is more
-- accurate — on 1,248 ground-truth pairs it keeps 98.0% of correct candidates
-- against 96.9%, and admits 34.8% of wrong ones against 39.2% — but it is far
-- too slow to sit in a live view.
--
-- Measured like-for-like on the same /matches page query (union view, tier
-- filter, ORDER BY, LIMIT 50), EXPLAIN ANALYZE against production:
--
--   stored-integer metric   ~1,589 ms
--   token-overlap metric    ~4,318 ms
--
-- So Slice 3 roughly tripled the page query. Note the ~1.6 s baseline is the
-- pre-existing cost of this five-level view stack and is NOT introduced here;
-- it is a separate, known problem.
--
-- The cause of the 2.7 s added on top: the tier CASE is used as a filter, and
-- Postgres inlines the `scored` CTE, so the coverage expression is re-evaluated
-- once per CASE branch — four times per row. Each evaluation tokenises both
-- sides, and each tokenisation is a regexp_replace plus a split plus an
-- aggregate inside two nested SQL functions: roughly 15,000 tokeniser
-- invocations per page load. Marking the CTE MATERIALIZED removes the 4x —
-- the release-offer branch alone then measures ~1,176 ms — but the tokenising
-- itself remains the floor.
--
-- A one-point recall gain does not justify tripling the owner's main page on a
-- free-tier instance with no I/O headroom, so coverage goes back to arithmetic
-- over stored integers. Nothing is lost: the evaluation stands in
-- docs/MATCHING-QUEUE-TRIAGE-SPEC.md §8, and the fix is to stop computing
-- tokens per page load — store them as GENERATED columns on the suggestion and
-- source-row tables, or precompute coverage into a materialised view refreshed
-- by the match run, as catalogue_mv already does.
--
-- CREATE OR REPLACE, not DROP: public.wine_match_review_view selects from both
-- of these and a DROP ... CASCADE would take the union surface with it.
--
-- Slice 1's second_wine_conflict is untouched and stays live. The tier
-- vocabulary, the column list and the queue summary are all unchanged, so no
-- application change is needed.

CREATE OR REPLACE VIEW public.release_offer_match_review_view
WITH (security_invoker = TRUE)
AS
WITH grouped AS (
    SELECT
        row.match_group_key,
        min(row.source_wine) AS source_wine,
        min(row.source_match_key) AS source_match_key,
        min(row.source_vintage) AS source_vintage,
        min(row.offer_date) AS earliest_offer_date,
        max(row.offer_date) AS latest_offer_date,
        count(*)::INT AS source_row_count,
        count(*) FILTER (WHERE resolution.import_id IS NULL)::INT AS unresolved_row_count,
        count(*) FILTER (WHERE resolution.status = 'linked')::INT AS linked_row_count,
        count(*) FILTER (WHERE resolution.status = 'ignored')::INT AS suppressed_row_count,
        CASE WHEN count(DISTINCT resolution.parent_sku) FILTER (WHERE resolution.status = 'linked') = 1
            THEN min(resolution.parent_sku) FILTER (WHERE resolution.status = 'linked') END AS parent_sku,
        CASE WHEN count(DISTINCT resolution.match_method) FILTER (WHERE resolution.status = 'linked') = 1
            THEN min(resolution.match_method) FILTER (WHERE resolution.status = 'linked') END AS match_method
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted'
      AND NOT EXISTS (
        SELECT 1 FROM public.release_offer_record_exclusions exclusion
        WHERE exclusion.content_fingerprint = row.content_fingerprint
      )
    GROUP BY row.match_group_key
), suggestion_stats AS (
    SELECT match_group_key,
        count(*)::INT AS suggestion_count,
        max(observed_at) AS suggestions_observed_at,
        max(match_score) AS top_match_score
    FROM public.release_offer_match_suggestions
    GROUP BY match_group_key
), top_candidate AS (
    SELECT
        grouped.match_group_key,
        suggestion.name,
        (cardinality(suggestion.matched_words)::DOUBLE PRECISION
            / nullif(array_length(string_to_array(grouped.source_match_key, ' '), 1), 0)
        ) AS token_coverage,
        coalesce(suggestion.typo_count, 0) AS typo_count
    FROM grouped
    JOIN public.release_offer_match_suggestions suggestion
      ON suggestion.match_group_key = grouped.match_group_key AND suggestion.rank = 1
), last_run AS (
    SELECT DISTINCT ON (run_group.match_group_key)
        run_group.match_group_key,
        run_group.status AS last_run_status,
        CASE WHEN run_group.status = 'failed' THEN run_group.processed_at END AS last_error_at
    FROM public.release_offer_match_run_groups run_group
    JOIN public.release_offer_match_runs run ON run.id = run_group.run_id
    ORDER BY run_group.match_group_key, run.started_at DESC, run_group.processed_at DESC NULLS LAST
)
SELECT
    grouped.match_group_key,
    grouped.source_wine,
    grouped.source_vintage,
    grouped.earliest_offer_date,
    grouped.latest_offer_date,
    grouped.source_row_count,
    grouped.unresolved_row_count,
    grouped.linked_row_count,
    grouped.suppressed_row_count,
    grouped.parent_sku,
    grouped.match_method,
    EXISTS (
        SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = grouped.parent_sku
    ) AS is_biddable,
    coalesce(suggestion_stats.suggestion_count, 0) AS suggestion_count,
    suggestion_stats.suggestions_observed_at,
    suggestion_stats.top_match_score,
    last_run.last_run_status,
    last_run.last_error_at,
    coalesce(
        private.second_wine_conflict(grouped.source_match_key, top_candidate.name),
        FALSE
    ) AS second_wine_conflict,
    top_candidate.token_coverage,
    CASE
        WHEN top_candidate.token_coverage IS NULL THEN 'none'
        WHEN top_candidate.token_coverage >= 1 AND top_candidate.typo_count = 0 THEN 'full'
        WHEN top_candidate.token_coverage >= 1 THEN 'full_with_typos'
        WHEN top_candidate.token_coverage >= 0.75 THEN 'partial'
        ELSE 'low'
    END AS coverage_tier
FROM grouped
LEFT JOIN suggestion_stats USING (match_group_key)
LEFT JOIN top_candidate USING (match_group_key)
LEFT JOIN last_run USING (match_group_key);

-- 2. cellartracker_match_review_view: the same two additions -----------------

CREATE OR REPLACE VIEW public.cellartracker_match_review_view
WITH (security_invoker = TRUE)
AS
WITH latest AS (
    SELECT id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC
    LIMIT 1
), grouped AS (
    SELECT
        evidence.match_group_key,
        min(evidence.source_wine) AS source_wine,
        min(evidence.source_match_key) AS source_match_key,
        min(evidence.vintage) AS source_vintage,
        min(evidence.producer) AS source_producer,
        min(evidence.region) AS source_region,
        count(*)::INT AS source_row_count,
        count(*) FILTER (WHERE resolution.import_id IS NULL)::INT AS unresolved_row_count,
        count(*) FILTER (WHERE resolution.status = 'linked')::INT AS linked_row_count,
        count(*) FILTER (WHERE resolution.status = 'suppressed')::INT AS suppressed_row_count,
        CASE WHEN count(DISTINCT resolution.parent_sku) FILTER (WHERE resolution.status = 'linked') = 1
            THEN min(resolution.parent_sku) FILTER (WHERE resolution.status = 'linked') END AS parent_sku,
        CASE WHEN count(DISTINCT resolution.match_method) FILTER (WHERE resolution.status = 'linked') = 1
            THEN min(resolution.match_method) FILTER (WHERE resolution.status = 'linked') END AS match_method
    FROM latest
    JOIN public.cellartracker_evidence evidence ON evidence.import_id = latest.id
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id AND resolution.source_row_number = evidence.source_row_number
    WHERE NOT EXISTS (
        SELECT 1 FROM public.cellartracker_record_decisions decisions
        WHERE decisions.match_group_key = evidence.match_group_key
          AND decisions.source_wine = evidence.source_wine
          AND decisions.is_excluded
    )
    GROUP BY evidence.match_group_key
), suggestion_stats AS (
    SELECT match_group_key,
        count(*)::INT AS suggestion_count,
        max(observed_at) AS suggestions_observed_at,
        max(match_score) AS top_match_score
    FROM public.cellartracker_match_suggestions
    GROUP BY match_group_key
), top_candidate AS (
    SELECT
        grouped.match_group_key,
        suggestion.name,
        (cardinality(suggestion.matched_words)::DOUBLE PRECISION
            / nullif(array_length(string_to_array(grouped.source_match_key, ' '), 1), 0)
        ) AS token_coverage,
        coalesce(suggestion.typo_count, 0) AS typo_count
    FROM grouped
    JOIN public.cellartracker_match_suggestions suggestion
      ON suggestion.match_group_key = grouped.match_group_key AND suggestion.rank = 1
), last_run AS (
    SELECT DISTINCT ON (run_group.match_group_key)
        run_group.match_group_key,
        run_group.status AS last_run_status,
        CASE WHEN run_group.status = 'failed' THEN run_group.processed_at END AS last_error_at
    FROM public.cellartracker_match_run_groups run_group
    JOIN public.cellartracker_match_runs run ON run.id = run_group.run_id
    ORDER BY run_group.match_group_key, run.started_at DESC, run_group.processed_at DESC NULLS LAST
)
SELECT
    grouped.match_group_key,
    grouped.source_wine,
    grouped.source_vintage,
    grouped.source_producer,
    grouped.source_region,
    grouped.source_row_count,
    grouped.unresolved_row_count,
    grouped.linked_row_count,
    grouped.suppressed_row_count,
    grouped.parent_sku,
    grouped.match_method,
    EXISTS (
        SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = grouped.parent_sku
    ) AS is_biddable,
    coalesce(suggestion_stats.suggestion_count, 0) AS suggestion_count,
    suggestion_stats.suggestions_observed_at,
    suggestion_stats.top_match_score,
    last_run.last_run_status,
    last_run.last_error_at,
    coalesce(
        private.second_wine_conflict(grouped.source_match_key, top_candidate.name),
        FALSE
    ) AS second_wine_conflict,
    top_candidate.token_coverage,
    CASE
        WHEN top_candidate.token_coverage IS NULL THEN 'none'
        WHEN top_candidate.token_coverage >= 1 AND top_candidate.typo_count = 0 THEN 'full'
        WHEN top_candidate.token_coverage >= 1 THEN 'full_with_typos'
        WHEN top_candidate.token_coverage >= 0.75 THEN 'partial'
        ELSE 'low'
    END AS coverage_tier
FROM grouped
LEFT JOIN suggestion_stats USING (match_group_key)
LEFT JOIN top_candidate USING (match_group_key)
LEFT JOIN last_run USING (match_group_key);

-- The two functions are dropped rather than left unused. Their definitions
-- live in 20260903190000 and 20260903200000 for whoever picks up the
-- follow-up. private.wine_core_tokens is NOT dropped — it predates this work
-- (20260729160000) and feeds the CellarTracker identity keys.

DROP FUNCTION IF EXISTS private.wine_token_coverage(TEXT[], TEXT[]);
DROP FUNCTION IF EXISTS private.wine_coverage_tokens(TEXT);
