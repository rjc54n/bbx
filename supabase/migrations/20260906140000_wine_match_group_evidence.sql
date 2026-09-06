-- Split the match-run-scoped half of the review views into a maintained table.
--
-- Context: the production freeze on 6 September 2026 (~14:06-14:14 UTC). Each
-- /matches load scanned public.wine_match_review_view twice -- once directly and
-- once inside public.wine_match_queue_summary -- at ~3.95 s a scan, against an
-- 8 s authenticated statement_timeout and a 10-connection PostgREST pool. Under
-- concurrency the pool exhausted and every query timed out.
--
-- Of the four CTEs in each of release_offer_match_review_view /
-- cellartracker_match_review_view, only `grouped` (the unresolved / linked /
-- suppressed resolution counts) changes when a reviewer acts. suggestion_stats,
-- top_candidate and last_run are fixed between match runs. This migration moves
-- those three into public.wine_match_group_evidence, one row per
-- (source, match_group_key), maintained synchronously per group by triggers on
-- the *_match_suggestions and *_match_run_groups tables. The review views keep
-- `grouped` live and LEFT JOIN the table.
--
-- Not a materialised view: PostgREST wraps every RPC in a transaction, so
-- REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run from the match-run server
-- actions, and there is no Python / pg_cron path for match runs the way
-- core/store.py refreshes catalogue_mv. A non-concurrent REFRESH would hold an
-- ACCESS EXCLUSIVE lock for the ~2 s the underlying query costs.
--
-- Design: docs/MATCHING-REVIEW-VIEW-PERFORMANCE.md. Parks the follow-up noted in
-- docs/MATCHING-QUEUE-TRIAGE-SPEC.md section 8.
--
-- delete_release_offer_match_group / delete_cellartracker_match_group are not
-- touched: they leave a processed run group in place, so a deleted group loses
-- its source rows and drops out of `grouped` before its evidence row could be
-- read. The orphaned row is harmless; private.rebuild_wine_match_group_evidence()
-- clears it.

-- 1. The coverage-tier vocabulary, previously inlined in both review views -----

CREATE FUNCTION private.match_coverage_tier(
    p_token_coverage DOUBLE PRECISION,
    p_typo_count INTEGER
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_token_coverage IS NULL THEN 'none'
        WHEN p_token_coverage >= 1 AND coalesce(p_typo_count, 0) = 0 THEN 'full'
        WHEN p_token_coverage >= 1 THEN 'full_with_typos'
        WHEN p_token_coverage >= 0.75 THEN 'partial'
        ELSE 'low'
    END;
$$;

REVOKE ALL ON FUNCTION private.match_coverage_tier(DOUBLE PRECISION, INTEGER)
    FROM PUBLIC, anon, authenticated;

-- 2. The maintained evidence table ------------------------------------------
--
-- Column types match what the review views expose today (evidence_score /
-- score_margin numeric(5,4) from the suggestion tables, token_coverage double
-- precision) so the col_type_is assertions in wine_match_unified_surface stay
-- green.

CREATE TABLE public.wine_match_group_evidence (
    source TEXT NOT NULL CHECK (source IN ('release_offer', 'cellartracker')),
    match_group_key TEXT NOT NULL,
    suggestion_count INTEGER NOT NULL DEFAULT 0,
    suggestions_observed_at TIMESTAMPTZ,
    top_match_score NUMERIC,
    last_run_status TEXT,
    last_error_at TIMESTAMPTZ,
    second_wine_conflict BOOLEAN NOT NULL DEFAULT FALSE,
    token_coverage DOUBLE PRECISION,
    coverage_tier TEXT NOT NULL DEFAULT 'none',
    algorithm_version TEXT,
    evidence_score NUMERIC(5,4),
    score_margin NUMERIC(5,4),
    review_band TEXT,
    review_priority SMALLINT,
    impact_band TEXT,
    risk_flags TEXT[] NOT NULL DEFAULT '{}',
    match_reasons TEXT[] NOT NULL DEFAULT '{}',
    top_candidate_parent_sku TEXT,
    top_candidate_was_biddable_at_observation BOOLEAN,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, match_group_key)
);

COMMENT ON TABLE public.wine_match_group_evidence IS
    'Precomputed match-run-scoped review evidence, one row per (source, '
    'match_group_key). Maintained by the sync_*_match_group_evidence triggers on '
    'the *_match_suggestions and *_match_run_groups tables; rebuilt by '
    'private.rebuild_wine_match_group_evidence(). Read only through the review '
    'views -- the resolution counts stay live in those views.';

ALTER TABLE public.wine_match_group_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wine_match_group_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wine_match_group_evidence TO authenticated;

CREATE POLICY "Owner can read wine match group evidence"
    ON public.wine_match_group_evidence FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));

-- The per-group maintenance and the review-view join both filter run groups by
-- match_group_key alone; the existing indexes lead with run_id.
CREATE INDEX idx_release_offer_match_run_groups_group
    ON public.release_offer_match_run_groups (match_group_key);
CREATE INDEX idx_cellartracker_match_run_groups_group
    ON public.cellartracker_match_run_groups (match_group_key);

-- 3. Per-group maintenance --------------------------------------------------
--
-- One SQL function per source. `smk` and `agg` each yield exactly one row, so
-- the INSERT always writes exactly one row -- even for a group with no rank-1
-- suggestion and no run group. source_match_key is taken from the run group
-- (its normal home) and falls back to the source rows for a suggestion-only
-- group.

CREATE FUNCTION private.upsert_release_offer_match_group_evidence(p_match_group_key TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO public.wine_match_group_evidence (
        source, match_group_key, suggestion_count, suggestions_observed_at,
        top_match_score, last_run_status, last_error_at, second_wine_conflict,
        token_coverage, coverage_tier, algorithm_version, evidence_score,
        score_margin, review_band, review_priority, impact_band, risk_flags,
        match_reasons, top_candidate_parent_sku,
        top_candidate_was_biddable_at_observation, updated_at
    )
    SELECT
        'release_offer', p_match_group_key,
        coalesce(agg.suggestion_count, 0),
        agg.suggestions_observed_at,
        agg.top_match_score,
        lr.last_run_status,
        lr.last_error_at,
        coalesce(private.second_wine_conflict(smk.source_match_key, top.name), FALSE),
        top.token_coverage,
        private.match_coverage_tier(top.token_coverage, top.typo_count),
        top.algorithm_version, top.evidence_score, top.score_margin,
        top.review_band, top.review_priority, top.impact_band,
        coalesce(top.risk_flags, '{}'), coalesce(top.match_reasons, '{}'),
        top.parent_sku, top.was_biddable_at_observation,
        now()
    FROM (
        SELECT coalesce(
            (SELECT min(run_group.source_match_key)
             FROM public.release_offer_match_run_groups run_group
             WHERE run_group.match_group_key = p_match_group_key),
            (SELECT min(row.source_match_key)
             FROM public.release_offer_source_rows row
             WHERE row.match_group_key = p_match_group_key)
        ) AS source_match_key
    ) smk
    CROSS JOIN (
        SELECT count(*)::INTEGER AS suggestion_count,
            max(observed_at) AS suggestions_observed_at,
            max(match_score) AS top_match_score
        FROM public.release_offer_match_suggestions
        WHERE match_group_key = p_match_group_key
    ) agg
    LEFT JOIN LATERAL (
        SELECT s.name, s.parent_sku, s.was_biddable_at_observation,
            coalesce(s.typo_count, 0) AS typo_count,
            (cardinality(s.matched_words)::DOUBLE PRECISION
                / nullif(array_length(string_to_array(smk.source_match_key, ' '), 1), 0)
            ) AS token_coverage,
            s.algorithm_version, s.evidence_score, s.score_margin,
            s.review_band, s.review_priority, s.impact_band,
            s.risk_flags, s.match_reasons
        FROM public.release_offer_match_suggestions s
        WHERE s.match_group_key = p_match_group_key AND s.rank = 1
    ) top ON TRUE
    LEFT JOIN LATERAL (
        SELECT run_group.status AS last_run_status,
            CASE WHEN run_group.status = 'failed' THEN run_group.processed_at END AS last_error_at
        FROM public.release_offer_match_run_groups run_group
        JOIN public.release_offer_match_runs run ON run.id = run_group.run_id
        WHERE run_group.match_group_key = p_match_group_key
        ORDER BY run.started_at DESC, run_group.processed_at DESC NULLS LAST
        LIMIT 1
    ) lr ON TRUE
    ON CONFLICT (source, match_group_key) DO UPDATE SET
        suggestion_count = EXCLUDED.suggestion_count,
        suggestions_observed_at = EXCLUDED.suggestions_observed_at,
        top_match_score = EXCLUDED.top_match_score,
        last_run_status = EXCLUDED.last_run_status,
        last_error_at = EXCLUDED.last_error_at,
        second_wine_conflict = EXCLUDED.second_wine_conflict,
        token_coverage = EXCLUDED.token_coverage,
        coverage_tier = EXCLUDED.coverage_tier,
        algorithm_version = EXCLUDED.algorithm_version,
        evidence_score = EXCLUDED.evidence_score,
        score_margin = EXCLUDED.score_margin,
        review_band = EXCLUDED.review_band,
        review_priority = EXCLUDED.review_priority,
        impact_band = EXCLUDED.impact_band,
        risk_flags = EXCLUDED.risk_flags,
        match_reasons = EXCLUDED.match_reasons,
        top_candidate_parent_sku = EXCLUDED.top_candidate_parent_sku,
        top_candidate_was_biddable_at_observation = EXCLUDED.top_candidate_was_biddable_at_observation,
        updated_at = now();
$$;

REVOKE ALL ON FUNCTION private.upsert_release_offer_match_group_evidence(TEXT)
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.upsert_cellartracker_match_group_evidence(p_match_group_key TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO public.wine_match_group_evidence (
        source, match_group_key, suggestion_count, suggestions_observed_at,
        top_match_score, last_run_status, last_error_at, second_wine_conflict,
        token_coverage, coverage_tier, algorithm_version, evidence_score,
        score_margin, review_band, review_priority, impact_band, risk_flags,
        match_reasons, top_candidate_parent_sku,
        top_candidate_was_biddable_at_observation, updated_at
    )
    SELECT
        'cellartracker', p_match_group_key,
        coalesce(agg.suggestion_count, 0),
        agg.suggestions_observed_at,
        agg.top_match_score,
        lr.last_run_status,
        lr.last_error_at,
        coalesce(private.second_wine_conflict(smk.source_match_key, top.name), FALSE),
        top.token_coverage,
        private.match_coverage_tier(top.token_coverage, top.typo_count),
        top.algorithm_version, top.evidence_score, top.score_margin,
        top.review_band, top.review_priority, top.impact_band,
        coalesce(top.risk_flags, '{}'), coalesce(top.match_reasons, '{}'),
        top.parent_sku, top.was_biddable_at_observation,
        now()
    FROM (
        SELECT coalesce(
            (SELECT min(run_group.source_match_key)
             FROM public.cellartracker_match_run_groups run_group
             WHERE run_group.match_group_key = p_match_group_key),
            (SELECT min(evidence.source_match_key)
             FROM public.cellartracker_evidence evidence
             WHERE evidence.match_group_key = p_match_group_key)
        ) AS source_match_key
    ) smk
    CROSS JOIN (
        SELECT count(*)::INTEGER AS suggestion_count,
            max(observed_at) AS suggestions_observed_at,
            max(match_score) AS top_match_score
        FROM public.cellartracker_match_suggestions
        WHERE match_group_key = p_match_group_key
    ) agg
    LEFT JOIN LATERAL (
        SELECT s.name, s.parent_sku, s.was_biddable_at_observation,
            coalesce(s.typo_count, 0) AS typo_count,
            (cardinality(s.matched_words)::DOUBLE PRECISION
                / nullif(array_length(string_to_array(smk.source_match_key, ' '), 1), 0)
            ) AS token_coverage,
            s.algorithm_version, s.evidence_score, s.score_margin,
            s.review_band, s.review_priority, s.impact_band,
            s.risk_flags, s.match_reasons
        FROM public.cellartracker_match_suggestions s
        WHERE s.match_group_key = p_match_group_key AND s.rank = 1
    ) top ON TRUE
    LEFT JOIN LATERAL (
        SELECT run_group.status AS last_run_status,
            CASE WHEN run_group.status = 'failed' THEN run_group.processed_at END AS last_error_at
        FROM public.cellartracker_match_run_groups run_group
        JOIN public.cellartracker_match_runs run ON run.id = run_group.run_id
        WHERE run_group.match_group_key = p_match_group_key
        ORDER BY run.started_at DESC, run_group.processed_at DESC NULLS LAST
        LIMIT 1
    ) lr ON TRUE
    ON CONFLICT (source, match_group_key) DO UPDATE SET
        suggestion_count = EXCLUDED.suggestion_count,
        suggestions_observed_at = EXCLUDED.suggestions_observed_at,
        top_match_score = EXCLUDED.top_match_score,
        last_run_status = EXCLUDED.last_run_status,
        last_error_at = EXCLUDED.last_error_at,
        second_wine_conflict = EXCLUDED.second_wine_conflict,
        token_coverage = EXCLUDED.token_coverage,
        coverage_tier = EXCLUDED.coverage_tier,
        algorithm_version = EXCLUDED.algorithm_version,
        evidence_score = EXCLUDED.evidence_score,
        score_margin = EXCLUDED.score_margin,
        review_band = EXCLUDED.review_band,
        review_priority = EXCLUDED.review_priority,
        impact_band = EXCLUDED.impact_band,
        risk_flags = EXCLUDED.risk_flags,
        match_reasons = EXCLUDED.match_reasons,
        top_candidate_parent_sku = EXCLUDED.top_candidate_parent_sku,
        top_candidate_was_biddable_at_observation = EXCLUDED.top_candidate_was_biddable_at_observation,
        updated_at = now();
$$;

REVOKE ALL ON FUNCTION private.upsert_cellartracker_match_group_evidence(TEXT)
    FROM PUBLIC, anon, authenticated;

-- 4. Triggers -------------------------------------------------------------
--
-- Every result / error RPC ends by transitioning a run group
-- pending -> processed | failed after writing that group's suggestions, so the
-- run-group status trigger covers the whole match-run write path. The
-- suggestions trigger additionally covers a suggestion written with no run group
-- (direct fixtures; a run whose groups were not recorded). Both are
-- statement-level: begin_*_match_run inserts thousands of pending rows in one
-- statement and the `status <> 'pending'` filter drops them all in one pass.

CREATE FUNCTION private.sync_release_offer_evidence_from_suggestions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.upsert_release_offer_match_group_evidence(affected.match_group_key)
    FROM (SELECT DISTINCT match_group_key FROM affected_rows) affected;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_release_offer_evidence_from_suggestions()
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.sync_release_offer_evidence_from_run_groups()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.upsert_release_offer_match_group_evidence(affected.match_group_key)
    FROM (
        SELECT DISTINCT match_group_key FROM affected_rows WHERE status <> 'pending'
    ) affected;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_release_offer_evidence_from_run_groups()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_match_group_evidence_ins
AFTER INSERT ON public.release_offer_match_suggestions
REFERENCING NEW TABLE AS affected_rows
FOR EACH STATEMENT EXECUTE FUNCTION private.sync_release_offer_evidence_from_suggestions();

CREATE TRIGGER sync_match_group_evidence_upd
AFTER UPDATE ON public.release_offer_match_suggestions
REFERENCING NEW TABLE AS affected_rows
FOR EACH STATEMENT EXECUTE FUNCTION private.sync_release_offer_evidence_from_suggestions();

CREATE TRIGGER sync_match_group_evidence_ins
AFTER INSERT ON public.release_offer_match_run_groups
REFERENCING NEW TABLE AS affected_rows
FOR EACH STATEMENT EXECUTE FUNCTION private.sync_release_offer_evidence_from_run_groups();

CREATE TRIGGER sync_match_group_evidence_upd
AFTER UPDATE ON public.release_offer_match_run_groups
REFERENCING NEW TABLE AS affected_rows
FOR EACH STATEMENT EXECUTE FUNCTION private.sync_release_offer_evidence_from_run_groups();

CREATE FUNCTION private.sync_cellartracker_evidence_from_suggestions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.upsert_cellartracker_match_group_evidence(affected.match_group_key)
    FROM (SELECT DISTINCT match_group_key FROM affected_rows) affected;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_cellartracker_evidence_from_suggestions()
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.sync_cellartracker_evidence_from_run_groups()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.upsert_cellartracker_match_group_evidence(affected.match_group_key)
    FROM (
        SELECT DISTINCT match_group_key FROM affected_rows WHERE status <> 'pending'
    ) affected;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_cellartracker_evidence_from_run_groups()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_match_group_evidence_ins
AFTER INSERT ON public.cellartracker_match_suggestions
REFERENCING NEW TABLE AS affected_rows
FOR EACH STATEMENT EXECUTE FUNCTION private.sync_cellartracker_evidence_from_suggestions();

CREATE TRIGGER sync_match_group_evidence_upd
AFTER UPDATE ON public.cellartracker_match_suggestions
REFERENCING NEW TABLE AS affected_rows
FOR EACH STATEMENT EXECUTE FUNCTION private.sync_cellartracker_evidence_from_suggestions();

CREATE TRIGGER sync_match_group_evidence_ins
AFTER INSERT ON public.cellartracker_match_run_groups
REFERENCING NEW TABLE AS affected_rows
FOR EACH STATEMENT EXECUTE FUNCTION private.sync_cellartracker_evidence_from_run_groups();

CREATE TRIGGER sync_match_group_evidence_upd
AFTER UPDATE ON public.cellartracker_match_run_groups
REFERENCING NEW TABLE AS affected_rows
FOR EACH STATEMENT EXECUTE FUNCTION private.sync_cellartracker_evidence_from_run_groups();

-- 5. Full rebuild (backfill, and any manual resync) -----------------------

CREATE FUNCTION private.rebuild_wine_match_group_evidence()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    TRUNCATE public.wine_match_group_evidence;

    PERFORM private.upsert_release_offer_match_group_evidence(keys.match_group_key)
    FROM (
        SELECT match_group_key FROM public.release_offer_match_run_groups
        UNION
        SELECT match_group_key FROM public.release_offer_match_suggestions
    ) keys;

    PERFORM private.upsert_cellartracker_match_group_evidence(keys.match_group_key)
    FROM (
        SELECT match_group_key FROM public.cellartracker_match_run_groups
        UNION
        SELECT match_group_key FROM public.cellartracker_match_suggestions
    ) keys;
END;
$$;

REVOKE ALL ON FUNCTION private.rebuild_wine_match_group_evidence()
    FROM PUBLIC, anon, authenticated;

SELECT private.rebuild_wine_match_group_evidence();

-- 6. release_offer_match_review_view: keep `grouped` live, join the table --
--
-- `grouped` is verbatim from 20260903210000. Dropped: suggestion_stats,
-- top_candidate, last_run. Column list, names, types and order are unchanged.

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
    coalesce(evidence.suggestion_count, 0) AS suggestion_count,
    evidence.suggestions_observed_at,
    evidence.top_match_score,
    evidence.last_run_status,
    evidence.last_error_at,
    coalesce(evidence.second_wine_conflict, FALSE) AS second_wine_conflict,
    evidence.token_coverage,
    coalesce(evidence.coverage_tier, 'none') AS coverage_tier
FROM grouped
LEFT JOIN public.wine_match_group_evidence evidence
  ON evidence.source = 'release_offer'
 AND evidence.match_group_key = grouped.match_group_key;

-- 7. cellartracker_match_review_view: the same change --------------------
--
-- `latest` and `grouped` are verbatim from 20260903210000.

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
    coalesce(evidence.suggestion_count, 0) AS suggestion_count,
    evidence.suggestions_observed_at,
    evidence.top_match_score,
    evidence.last_run_status,
    evidence.last_error_at,
    coalesce(evidence.second_wine_conflict, FALSE) AS second_wine_conflict,
    evidence.token_coverage,
    coalesce(evidence.coverage_tier, 'none') AS coverage_tier
FROM grouped
LEFT JOIN public.wine_match_group_evidence evidence
  ON evidence.source = 'cellartracker'
 AND evidence.match_group_key = grouped.match_group_key;

-- 8. wine_match_review_view: v2 evidence columns from the table ----------
--
-- Structure unchanged from 20260906133120; the per-source
-- LEFT JOIN release_offer_match_suggestions ... rank = 1 (and the cellartracker
-- equivalent) becomes a LEFT JOIN public.wine_match_group_evidence. Every
-- column name, coalesce and security_invoker is preserved, so
-- public.wine_match_queue_summary and the /matches page are untouched.

CREATE OR REPLACE VIEW public.wine_match_review_view
WITH (security_invoker = TRUE)
AS
SELECT 'release_offer'::TEXT AS source,
    review.match_group_key,
    CASE WHEN review.parent_sku IS NOT NULL THEN 'parent:' || review.parent_sku END AS wine_ref,
    review.parent_sku, review.match_method, review.source_wine, review.source_vintage,
    review.source_row_count, review.unresolved_row_count, review.linked_row_count,
    review.suppressed_row_count, review.is_biddable AS is_bbx_eligible,
    review.suggestion_count, review.top_match_score, review.suggestions_observed_at,
    review.last_run_status, review.last_error_at, review.second_wine_conflict,
    review.token_coverage, review.coverage_tier,
    evidence.algorithm_version, evidence.evidence_score, evidence.score_margin,
    coalesce(evidence.review_band, 'legacy') AS review_band,
    coalesce(evidence.review_priority, 90::SMALLINT) AS review_priority,
    evidence.impact_band, coalesce(evidence.risk_flags, '{}') AS risk_flags,
    coalesce(evidence.match_reasons, '{}') AS match_reasons,
    evidence.top_candidate_parent_sku,
    evidence.top_candidate_was_biddable_at_observation
FROM public.release_offer_match_review_view review
LEFT JOIN public.wine_match_group_evidence evidence
  ON evidence.source = 'release_offer' AND evidence.match_group_key = review.match_group_key
UNION ALL
SELECT 'cellartracker'::TEXT AS source,
    review.match_group_key,
    CASE WHEN review.parent_sku IS NOT NULL THEN 'parent:' || review.parent_sku END AS wine_ref,
    review.parent_sku, review.match_method, review.source_wine, review.source_vintage,
    review.source_row_count, review.unresolved_row_count, review.linked_row_count,
    review.suppressed_row_count, review.is_biddable AS is_bbx_eligible,
    review.suggestion_count, review.top_match_score, review.suggestions_observed_at,
    review.last_run_status, review.last_error_at, review.second_wine_conflict,
    review.token_coverage, review.coverage_tier,
    evidence.algorithm_version, evidence.evidence_score, evidence.score_margin,
    coalesce(evidence.review_band, 'legacy') AS review_band,
    coalesce(evidence.review_priority, 90::SMALLINT) AS review_priority,
    evidence.impact_band, coalesce(evidence.risk_flags, '{}') AS risk_flags,
    coalesce(evidence.match_reasons, '{}') AS match_reasons,
    evidence.top_candidate_parent_sku,
    evidence.top_candidate_was_biddable_at_observation
FROM public.cellartracker_match_review_view review
LEFT JOIN public.wine_match_group_evidence evidence
  ON evidence.source = 'cellartracker' AND evidence.match_group_key = review.match_group_key;
