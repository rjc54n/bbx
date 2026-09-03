-- Matching queue triage, Slice 1: the second-wine conflict flag.
-- See docs/MATCHING-QUEUE-TRIAGE-SPEC.md §3.2, §3.3, §4.1.
--
-- release_price_anchor_view anchors on the earliest offer per
-- (parent_sku, format_code), so linking a second wine's offer to the grand
-- vin's SKU corrupts that wine's anchor from the earliest offer forward. Les
-- Forts de Latour trades at roughly a fifth of Château Latour, and the two
-- names differ by three tokens the matcher is happy to drop.
--
-- The rule is SYMMETRIC, and that is the point. The originally proposed form
-- ("source carries the marker, candidate does not") covers 10 groups in the
-- queue, 8 of which already fall below 0.75 token coverage and are buried by
-- Slice 2 anyway. The reverse direction — source is the grand vin, candidate
-- is the second wine — covers 7 more, and those include
-- `2025 Château Margaux -> 2025 Pavillon Blanc du Château Margaux` at full
-- coverage with zero typos, which lands in the tier the owner is being asked
-- to glance-and-confirm. Flagging only the forward direction would guard the
-- groups that need it least.
--
-- Rank is NOT modified. It is assigned in TypeScript at match time
-- (apps/web/src/lib/releaseOffers/algoliaMatching.ts) and stored; rewriting it
-- would need a full Algolia re-run. It would also gain nothing: in all 10
-- forward conflicts, NONE of the five candidates carries the marker, so
-- demotion promotes the second-wrongest answer rather than surfacing a right
-- one. BBR does not stock these wines. The flag is a suppression signal.

-- 1. The marker test ---------------------------------------------------------
--
-- SECURITY DEFINER solely so the view can reach private.release_wine_match_key,
-- which is REVOKEd from authenticated; the alternative was widening the grant
-- on the general normaliser. The function touches no tables and takes no
-- identifiers, so running it as owner exposes nothing: it is pure text.
--
-- Markers are the phrase that distinguishes the second wine and never appears
-- in the grand vin's name, deliberately NOT the second wine's full name. The
-- full name is too brittle in both directions:
--
--   * 'alter ego de palmer' misses `2017 Alter Ego de Ch. Palmer` (the source
--     abbreviates the estate), flagging a correct match as a conflict.
--   * 'la croix de beaucaillou' misses the catalogue's own
--     `La Croix Ducru-Beaucaillou`, which is the same second wine under BBR's
--     name, again flagging a correct match.
--
-- 'la croix' is the loosest entry here and the one to watch: it would flag any
-- other "La Croix ..." wine whose candidate lacks the phrase. It is clean
-- against the queue as it stands (the one other holder, `Moulin à Vent, La
-- Croix des Vérillats`, has a candidate that also carries it).
--
-- Matching is on token boundaries against the normalised key. A bare substring
-- test additionally flags `La Croix des Vérillats` via "la croix de|s", which
-- is how the boundary form earns the two extra concatenations.

CREATE FUNCTION private.second_wine_markers()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'petit mouton',
        'pavillon blanc',
        'pavillon rouge',
        'les forts',
        'carruades',
        'clos du marquis',
        'la croix',
        'alter ego',
        'echo de lynch',
        'petit cheval',
        'reserve de la comtesse'
    ];
$$;

REVOKE ALL ON FUNCTION private.second_wine_markers() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.second_wine_conflict(
    p_source_match_key TEXT,
    p_candidate_name TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
    -- A NULL candidate means the group has no rank-1 suggestion, so there is
    -- nothing that could be wrongly confirmed and nothing to warn about. Without
    -- this guard the NULL normalises to '', carries no marker, and every source
    -- that DOES carry one is reported as a conflict against a candidate that
    -- does not exist -- which flagged 3 candidate-less groups in the queue.
    SELECT CASE WHEN p_source_match_key IS NULL OR p_candidate_name IS NULL THEN FALSE
    ELSE EXISTS (
        SELECT 1
        FROM unnest(private.second_wine_markers()) AS marker
        WHERE (' ' || p_source_match_key || ' '
               LIKE '% ' || marker || ' %')
          <> (' ' || private.release_wine_match_key(p_candidate_name) || ' '
               LIKE '% ' || marker || ' %')
    ) END;
$$;

REVOKE ALL ON FUNCTION private.second_wine_conflict(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.second_wine_conflict(TEXT, TEXT) TO authenticated;

-- 2. release_offer_match_review_view: + source_match_key, + second_wine_conflict
--
-- Unchanged from 20260831120000 apart from source_match_key in `grouped`, the
-- top_candidate CTE, and the two appended columns. Appended at the end so
-- CREATE OR REPLACE keeps grants and the union view's explicit column list
-- stays valid.

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
    -- The rank-1 candidate is the one the owner is being invited to confirm,
    -- so it is the only one the conflict flag is about.
    SELECT match_group_key, name
    FROM public.release_offer_match_suggestions
    WHERE rank = 1
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
    -- FALSE, not NULL, when there is no rank-1 candidate: nothing can be
    -- wrongly confirmed, so there is nothing to warn about.
    coalesce(
        private.second_wine_conflict(grouped.source_match_key, top_candidate.name),
        FALSE
    ) AS second_wine_conflict
FROM grouped
LEFT JOIN suggestion_stats USING (match_group_key)
LEFT JOIN top_candidate USING (match_group_key)
LEFT JOIN last_run USING (match_group_key);

-- 3. cellartracker_match_review_view: the same two additions -----------------

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
    SELECT match_group_key, name
    FROM public.cellartracker_match_suggestions
    WHERE rank = 1
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
    ) AS second_wine_conflict
FROM grouped
LEFT JOIN suggestion_stats USING (match_group_key)
LEFT JOIN top_candidate USING (match_group_key)
LEFT JOIN last_run USING (match_group_key);

-- 4. wine_match_review_view: carry the flag through the union ----------------

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
    review.second_wine_conflict
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
    review.second_wine_conflict
FROM public.cellartracker_match_review_view review;
