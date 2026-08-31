-- Wine matching, Part A / Slice 1: a unified read surface over the two
-- per-source matching queues. See docs/MATCHING-FUNCTIONAL-SPEC.md §3.2, §3.5.
--
-- The release-offer and CellarTracker matching pages each read their own
-- *_match_review_view / *_match_suggestion_view. This migration adds a union
-- pair (wine_match_review_view, wine_match_suggestion_view) and a single
-- exact-count summary function (wine_match_queue_summary) that the new /matches
-- page will read, without touching the 12 existing per-source mutation RPCs.
--
-- Three things change on the way:
--
--   1. release_offer_match_review_view is recreated WITH the excluded-row
--      filter that cellartracker_match_review_view already has (spec §2.4). An
--      excluded release-offer row currently still counts as unresolved and
--      keeps its group in the queue. From here both branches agree, and the
--      current /release-prices/matches page inherits the fix immediately.
--
--   2. Both per-source review views gain three columns the union contract needs
--      and neither exposed today: last_run_status, last_error_at (from the
--      per-group *_match_run_groups ledger, latest run wins) and top_match_score
--      (max suggestion score in the group). Appended at the end, so
--      CREATE OR REPLACE keeps the views' grants and there are no dependants.
--
--   3. is_biddable is surfaced through the union as is_bbx_eligible. The
--      predicate is unchanged (EXISTS in public.catalogue_view); "biddable" is
--      retired as a term because a linked group being in the catalogue does not
--      mean it is trading right now (spec §4).
--
-- Access: every object here is WITH (security_invoker = true) / SECURITY
-- INVOKER and relies on the owner-only RLS already on the underlying tables
-- (release_offer_* and cellartracker_* are all "USING (private.is_app_owner())"
-- with SELECT granted to authenticated only). A non-owner authenticated caller
-- can execute the function and select the views, but every underlying row is
-- filtered out by RLS, so they see zero rows / all-zero counts. anon has no
-- grant at all.

-- 1. release_offer_match_review_view: add the exclusion filter + 3 columns ----

CREATE OR REPLACE VIEW public.release_offer_match_review_view
WITH (security_invoker = TRUE)
AS
WITH grouped AS (
    SELECT
        row.match_group_key,
        min(row.source_wine) AS source_wine,
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
      -- The exclusion is keyed on content, so the same offer in a later file
      -- stays out too. Matches release_offer_review_view / _evidence_view.
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
), last_run AS (
    -- The most recently started run that touched this group, and whether it
    -- failed. run_groups.status is one of pending / processed / failed.
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
    last_run.last_error_at
FROM grouped
LEFT JOIN suggestion_stats USING (match_group_key)
LEFT JOIN last_run USING (match_group_key);

-- 2. cellartracker_match_review_view: add the same 3 columns -----------------
--
-- The exclusion filter (cellartracker_record_decisions.is_excluded) is already
-- present; only the run-status and score columns are new.

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
    last_run.last_error_at
FROM grouped
LEFT JOIN suggestion_stats USING (match_group_key)
LEFT JOIN last_run USING (match_group_key);

-- 3. wine_match_review_view: the union surface ------------------------------
--
-- UNION ALL (the branches are disjoint by source), explicit column list,
-- (source, match_group_key) is the identity. wine_ref is the Part B seam: a
-- future local identity slots in beside 'parent:' without a contract change.
-- Source-specific columns (earliest_offer_date, source_producer, ...) stay on
-- the per-source views; the list surface reads only this common projection and
-- the expanded panel fetches source detail (spec §3.4).

CREATE VIEW public.wine_match_review_view
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
    review.last_error_at
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
    review.last_error_at
FROM public.cellartracker_match_review_view review;

-- 4. wine_match_suggestion_view: the union of the per-source suggestions -----
--
-- match_score is each backend's own ranking score, used only to order
-- suggestions within a group, never to compare across groups or sources.

CREATE VIEW public.wine_match_suggestion_view
WITH (security_invoker = TRUE)
AS
SELECT
    'release_offer'::TEXT AS source,
    suggestion.match_group_key,
    suggestion.parent_sku,
    suggestion.rank,
    suggestion.name,
    suggestion.vintage,
    suggestion.producer,
    suggestion.region,
    suggestion.match_score,
    suggestion.is_biddable AS is_bbx_eligible,
    suggestion.observed_at
FROM public.release_offer_match_suggestion_view suggestion
UNION ALL
SELECT
    'cellartracker'::TEXT AS source,
    suggestion.match_group_key,
    suggestion.parent_sku,
    suggestion.rank,
    suggestion.name,
    suggestion.vintage,
    suggestion.producer,
    suggestion.region,
    suggestion.match_score,
    suggestion.is_biddable AS is_bbx_eligible,
    suggestion.observed_at
FROM public.cellartracker_match_suggestion_view suggestion;

REVOKE ALL ON public.wine_match_review_view, public.wine_match_suggestion_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wine_match_review_view, public.wine_match_suggestion_view
    TO authenticated;

-- 5. wine_match_queue_summary: one exact single-pass tally -------------------
--
-- PostgREST count=estimated estimates the rows a query returns; it cannot turn
-- count(*) FILTER (...) inside a function into a planner estimate. So the
-- state-chip tallies come from here: one pass over the union view, exact
-- filtered counts, one row out. The page keeps its own exact count=exact on
-- the visible list for pagination.
--
-- The five buckets are exactly the /matches state filters (spec §3.5). They
-- deliberately overlap the way the filters do: a group with rows both linked
-- and suppressed and none unresolved counts under both 'linked' and
-- 'no_suitable_match', matching what the list would show under each filter.
--
-- p_source NULL means all sources; otherwise the tally is scoped to that
-- source. SECURITY INVOKER + the union view's own security_invoker boundary;
-- no SECURITY DEFINER, no wrapper.

CREATE FUNCTION public.wine_match_queue_summary(p_source TEXT DEFAULT NULL)
RETURNS TABLE (
    needs_review BIGINT,
    with_suggestions BIGINT,
    linked BIGINT,
    no_suitable_match BIGINT,
    all_groups BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        count(*) FILTER (
            WHERE review.unresolved_row_count > 0 OR review.last_run_status = 'failed'
        ),
        count(*) FILTER (
            WHERE (review.unresolved_row_count > 0 OR review.last_run_status = 'failed')
              AND review.suggestion_count > 0
        ),
        count(*) FILTER (
            WHERE review.linked_row_count > 0 AND review.unresolved_row_count = 0
        ),
        count(*) FILTER (
            WHERE review.suppressed_row_count > 0 AND review.unresolved_row_count = 0
        ),
        count(*)
    FROM public.wine_match_review_view review
    WHERE p_source IS NULL OR review.source = p_source;
$$;

REVOKE ALL ON FUNCTION public.wine_match_queue_summary(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wine_match_queue_summary(TEXT) TO authenticated;
