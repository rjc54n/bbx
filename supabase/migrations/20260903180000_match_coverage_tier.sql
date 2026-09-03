-- Matching queue triage, Slice 2: token-coverage tiering.
-- See docs/MATCHING-QUEUE-TRIAGE-SPEC.md §2, §3.1, §4.2.
--
-- 1,578 unresolved groups carry a rank-1 suggestion, and hand-sampling says
-- most of the low-coverage end is Algolia returning its nearest miss for a wine
-- BBR does not stock — no_suitable_match in disguise. Coverage of the source
-- name's tokens discriminates where vintage agreement does not (1,569 of 1,585
-- top candidates already agree on vintage; the matcher searches within vintage).
--
-- Everything here is computed from stored columns. No re-matching.
--
-- On the metric: matched_words comes from Algolia and INCLUDES the vintage;
-- source_match_key comes from private.release_wine_match_key, which STRIPS it.
-- So coverage is inflated by one token in 1,561 of 1,578 groups. That is a real
-- defect and it is deliberately left in place, because correcting it makes the
-- tiering worse: the strict metric collapses the top tier from 416 groups to 84
-- and buries plainly correct matches such as
-- `2011 Ch. Brane-Cantenac -> 2011 Château Brane-Cantenac` at 0.50, since `ch`
-- and `château` are different tokens. The vintage inflation was silently
-- compensating for that gap. Two defects roughly cancelling is not a good
-- state, but this is the better-calibrated of the two metrics available today
-- and the one the 7-of-8 sample actually validated. The honest fix is token
-- normalisation, which changes match behaviour rather than queue presentation
-- and is out of scope (spec §7).
--
-- Tier is NOT a confidence score. The top tier sampled 7 of 8 correct, and
-- `2025 Château Margaux -> 2025 Pavillon Blanc du Château Margaux` reaches full
-- coverage with zero typos while being wrong — which is what Slice 1 is for.
-- Glance-and-confirm, never auto-link.

-- 1. release_offer_match_review_view: + token_coverage, + coverage_tier -------
--
-- 'none' rather than NULL for a group with no rank-1 candidate, so the filter
-- can be a plain neq. `NOT (coverage_tier = 'low')` would drop NULL rows, which
-- would silently hide every no-suggestions group from the "all" state.

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

-- 3. wine_match_review_view: carry both columns through the union ------------

CREATE OR REPLACE VIEW public.wine_match_review_view
WITH (security_invoker = TRUE)
AS
SELECT
    'release_offer'::TEXT AS source,
    review.match_group_key,
    CASE WHEN review.parent_sku IS NOT NULL THEN 'parent:' || review.parent_sku END AS wine_ref,
    review.parent_sku,
    review.match_method,
    review.source_wine,
    review.source_vintage,
    review.source_row_count,
    review.unresolved_row_count,
    review.linked_row_count,
    review.suppressed_row_count,
    review.is_biddable AS is_bbx_eligible,
    review.suggestion_count,
    review.top_match_score,
    review.suggestions_observed_at,
    review.last_run_status,
    review.last_error_at,
    review.second_wine_conflict,
    review.token_coverage,
    review.coverage_tier
FROM public.release_offer_match_review_view review
UNION ALL
SELECT
    'cellartracker'::TEXT AS source,
    review.match_group_key,
    CASE WHEN review.parent_sku IS NOT NULL THEN 'parent:' || review.parent_sku END AS wine_ref,
    review.parent_sku,
    review.match_method,
    review.source_wine,
    review.source_vintage,
    review.source_row_count,
    review.unresolved_row_count,
    review.linked_row_count,
    review.suppressed_row_count,
    review.is_biddable AS is_bbx_eligible,
    review.suggestion_count,
    review.top_match_score,
    review.suggestions_observed_at,
    review.last_run_status,
    review.last_error_at,
    review.second_wine_conflict,
    review.token_coverage,
    review.coverage_tier
FROM public.cellartracker_match_review_view review;

-- 4. wine_match_queue_summary: + the two tier tallies and the conflict tally --
--
-- Builds on 20260901120000 (the three disjoint queue buckets), NOT on the
-- original 20260831120000 shape: needs_review / with_suggestions /
-- no_suggestions / errors / linked / no_suitable_match / all_groups all keep
-- their meaning and their order, and three columns are appended.
--
-- RETURNS TABLE changes shape, so this is DROP + CREATE. The added fields are
-- additive for callers: PostgREST returns the row as an object and a page that
-- does not read them is unaffected.
--
-- workable + low_coverage partition with_suggestions exactly, using that
-- bucket's own predicate (unresolved, last run did not fail, has candidates),
-- so the two chips add up to the tile above them.

DROP FUNCTION IF EXISTS public.wine_match_queue_summary(TEXT);

CREATE FUNCTION public.wine_match_queue_summary(p_source TEXT DEFAULT NULL)
RETURNS TABLE (
    needs_review BIGINT,
    with_suggestions BIGINT,
    no_suggestions BIGINT,
    errors BIGINT,
    linked BIGINT,
    no_suitable_match BIGINT,
    all_groups BIGINT,
    workable BIGINT,
    low_coverage BIGINT,
    second_wine_conflicts BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        count(*) FILTER (WHERE review.unresolved_row_count > 0),
        count(*) FILTER (
            WHERE review.unresolved_row_count > 0
              AND review.last_run_status IS DISTINCT FROM 'failed'
              AND review.suggestion_count > 0
        ),
        count(*) FILTER (
            WHERE review.unresolved_row_count > 0
              AND review.last_run_status IS DISTINCT FROM 'failed'
              AND review.suggestion_count = 0
        ),
        count(*) FILTER (
            WHERE review.unresolved_row_count > 0
              AND review.last_run_status = 'failed'
        ),
        count(*) FILTER (WHERE review.linked_row_count > 0 AND review.unresolved_row_count = 0),
        count(*) FILTER (WHERE review.suppressed_row_count > 0 AND review.unresolved_row_count = 0),
        count(*),
        count(*) FILTER (
            WHERE review.unresolved_row_count > 0
              AND review.last_run_status IS DISTINCT FROM 'failed'
              AND review.suggestion_count > 0
              AND review.coverage_tier <> 'low'
        ),
        count(*) FILTER (
            WHERE review.unresolved_row_count > 0
              AND review.last_run_status IS DISTINCT FROM 'failed'
              AND review.suggestion_count > 0
              AND review.coverage_tier = 'low'
        ),
        count(*) FILTER (
            WHERE review.unresolved_row_count > 0 AND review.second_wine_conflict
        )
    FROM public.wine_match_review_view review
    WHERE p_source IS NULL OR review.source = p_source;
$$;

REVOKE ALL ON FUNCTION public.wine_match_queue_summary(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wine_match_queue_summary(TEXT) TO authenticated;
