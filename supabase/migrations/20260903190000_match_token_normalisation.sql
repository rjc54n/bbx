-- Matching queue triage, Slice 3: an honest token-coverage metric.
-- See docs/MATCHING-QUEUE-TRIAGE-SPEC.md §3.1, §7 and the evaluation in §9.
--
-- Slice 2 (20260903180000) shipped coverage as
--   cardinality(matched_words) / token_count(source_match_key)
-- and its header records why that formula was kept despite being wrong in two
-- ways at once: the numerator is Algolia's matched words and INCLUDES the
-- vintage, the denominator is our normalised key and STRIPS it, and separately
-- `ch` and `château` are different tokens so every abbreviated Bordeaux source
-- lost a token. The vintage inflation was compensating for the abbreviation
-- gap. Correcting only one of the two made the tiering worse, which is why
-- neither was corrected at the time.
--
-- This slice corrects both together and drops the Algolia dependency entirely:
-- coverage is now the share of the source's own identity tokens that appear in
-- the candidate's name, with both sides normalised the same way.
--
--   coverage = |core(source_wine) ∩ core(candidate_name)| / |core(source_wine)|
--
-- Measured against ground truth — the 1,248 (source, candidate) pairs inside
-- groups the owner has already linked by hand, where the linked parent_sku is
-- the correct answer and the group's other candidates are known wrong:
--
--   metric      correct pairs kept (want high)   wrong pairs kept (want low)
--   old            792 / 817   96.9%                169 / 431   39.2%
--   new            797 / 817   97.6%                150 / 431   34.8%
--
-- Better on both axes, so this is not a precision/recall trade. On the live
-- unresolved queue it moves 1,513 groups from 708 workable / 805 low to
-- 597 workable / 916 low: ~111 fewer groups to review, while retaining
-- slightly MORE of the correct matches.
--
-- No re-matching. Both inputs (source_wine, suggestion name) are already
-- stored, and matched_words is simply no longer read.
--
-- What this deliberately does NOT touch:
--
--   * private.release_wine_match_key, which feeds source_match_key and the
--     GENERATED match_group_key. Renormalising identity would regenerate every
--     match_group_key and orphan every suggestion row keyed to it.
--   * the second-wine marker test, which stays on source_match_key. Markers
--     like 'les forts' and 'la croix' contain stopwords that core tokens drop
--     by design, so it must keep reading the stopword-preserving key.
--   * apps/web/src/lib/wine/coreKey.ts, whose wineCoreTokens already drops
--     vintages and stopwords but has no abbreviation expansion. Adding it there
--     would improve future candidate ranking, but only takes effect on a fresh
--     Algolia run, so it is a separate decision.

-- 1. Core identity tokens ----------------------------------------------------
--
-- Mirrors wineCoreTokens in apps/web/src/lib/wine/coreKey.ts: fold accents,
-- lowercase, split on non-alphanumerics, drop articles/conjunctions and
-- vintage-shaped tokens, dedupe. Producer words ('chateau', 'domaine') are
-- deliberately KEPT — dropping them collapses "Chateau Margaux" to the Margaux
-- appellation, which matches every Margaux property.
--
-- Two differences from the TS original, both deliberate:
--
--   * Abbreviation expansion (ch/dom/st), which is the whole point of the
--     slice. `ch` alone appears 551 times across the corpus.
--   * A corrected accent map. The map in private.release_wine_match_key pairs
--     29 source characters against 30 replacements, so from 'ù' onward it is
--     off by one and folds 'ù'->'e' and 'ý'->'u'. Postgres silently ignores the
--     surplus replacement rather than erroring. That defect is left alone where
--     it is — it feeds the generated match_group_key — but it is not carried
--     forward into a new function.
--
-- Numeric tokens are kept: "Bin 95" and "Bin 707" are identity, not noise.

CREATE FUNCTION private.wine_core_tokens(p_text TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT coalesce(array_agg(DISTINCT token), ARRAY[]::TEXT[])
    FROM (
        SELECT CASE word
                   WHEN 'ch'        THEN 'chateau'
                   WHEN 'chateaux'  THEN 'chateau'
                   WHEN 'dom'       THEN 'domaine'
                   WHEN 'domaines'  THEN 'domaine'
                   WHEN 'st'        THEN 'saint'
                   WHEN 'ste'       THEN 'saint'
                   ELSE word
               END AS token
        FROM unnest(string_to_array(
            regexp_replace(
                lower(translate(coalesce(p_text, ''),
                    'àáâãäåæçèéêëìíîïñòóôõöøœùúûüýÿ',
                    'aaaaaaaceeeeiiiinooooooouuuuyy')),
                '[^a-z0-9]+', ' ', 'g'),
            ' ')) AS word
        WHERE word <> ''
          AND word !~ '^(18|19|20)[0-9]{2}$'
          AND word <> ALL (ARRAY[
              'de','du','des','da','di','do','dos','del','della','delle',
              'la','le','les','el','il','al','lo','the','a','an','and',
              'et','e','y','und','von','van','der','den','ter'])
    ) normalised;
$$;

REVOKE ALL ON FUNCTION private.wine_core_tokens(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.wine_core_tokens(TEXT) TO authenticated;

-- 2. Coverage ----------------------------------------------------------------
--
-- Asymmetric on purpose: the denominator is the SOURCE's token count, so the
-- question is "how much of what the offer says did we account for", not "do the
-- two names look alike". A catalogue name carrying extra geography is not
-- penalised, which matters because BBR appends region and country at varying
-- depth. Coverage can therefore reach 1.0 without the names being equal.

CREATE FUNCTION private.wine_token_coverage(p_source TEXT, p_candidate TEXT)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_source IS NULL OR p_candidate IS NULL THEN NULL
        WHEN cardinality(source_tokens.tokens) = 0 THEN NULL
        ELSE (
            SELECT count(*) FROM unnest(source_tokens.tokens) AS token
            WHERE token = ANY (candidate_tokens.tokens)
        )::DOUBLE PRECISION / cardinality(source_tokens.tokens)
    END
    FROM (SELECT private.wine_core_tokens(p_source) AS tokens) AS source_tokens,
         (SELECT private.wine_core_tokens(p_candidate) AS tokens) AS candidate_tokens;
$$;

REVOKE ALL ON FUNCTION private.wine_token_coverage(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.wine_token_coverage(TEXT, TEXT) TO authenticated;

-- 3. release_offer_match_review_view: coverage from names, not matched_words --
--
-- Only top_candidate and the token_coverage expression change; the column list
-- and its order are identical to 20260903180000, so wine_match_review_view
-- needs no change and keeps its grants.
--
-- `full_with_typos` is expected to be empty or near-empty from here: the tier
-- means "every source token is present AND Algolia used typo tolerance", and
-- exact token overlap rarely reaches 1.0 when a word had to be fuzzy-matched.
-- It is kept rather than removed so the distinction survives if it recurs.

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
    SELECT match_group_key, name, coalesce(typo_count, 0) AS typo_count
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
), scored AS (
    SELECT
        grouped.*,
        top_candidate.name AS top_candidate_name,
        top_candidate.typo_count,
        private.wine_token_coverage(grouped.source_wine, top_candidate.name) AS token_coverage
    FROM grouped
    LEFT JOIN top_candidate USING (match_group_key)
)
SELECT
    scored.match_group_key,
    scored.source_wine,
    scored.source_vintage,
    scored.earliest_offer_date,
    scored.latest_offer_date,
    scored.source_row_count,
    scored.unresolved_row_count,
    scored.linked_row_count,
    scored.suppressed_row_count,
    scored.parent_sku,
    scored.match_method,
    EXISTS (
        SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = scored.parent_sku
    ) AS is_biddable,
    coalesce(suggestion_stats.suggestion_count, 0) AS suggestion_count,
    suggestion_stats.suggestions_observed_at,
    suggestion_stats.top_match_score,
    last_run.last_run_status,
    last_run.last_error_at,
    coalesce(
        private.second_wine_conflict(scored.source_match_key, scored.top_candidate_name),
        FALSE
    ) AS second_wine_conflict,
    scored.token_coverage,
    CASE
        WHEN scored.token_coverage IS NULL THEN 'none'
        WHEN scored.token_coverage >= 1 AND scored.typo_count = 0 THEN 'full'
        WHEN scored.token_coverage >= 1 THEN 'full_with_typos'
        WHEN scored.token_coverage >= 0.75 THEN 'partial'
        ELSE 'low'
    END AS coverage_tier
FROM scored
LEFT JOIN suggestion_stats USING (match_group_key)
LEFT JOIN last_run USING (match_group_key);

-- 4. cellartracker_match_review_view: the same change ------------------------

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
    SELECT match_group_key, name, coalesce(typo_count, 0) AS typo_count
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
), scored AS (
    SELECT
        grouped.*,
        top_candidate.name AS top_candidate_name,
        top_candidate.typo_count,
        private.wine_token_coverage(grouped.source_wine, top_candidate.name) AS token_coverage
    FROM grouped
    LEFT JOIN top_candidate USING (match_group_key)
)
SELECT
    scored.match_group_key,
    scored.source_wine,
    scored.source_vintage,
    scored.source_producer,
    scored.source_region,
    scored.source_row_count,
    scored.unresolved_row_count,
    scored.linked_row_count,
    scored.suppressed_row_count,
    scored.parent_sku,
    scored.match_method,
    EXISTS (
        SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = scored.parent_sku
    ) AS is_biddable,
    coalesce(suggestion_stats.suggestion_count, 0) AS suggestion_count,
    suggestion_stats.suggestions_observed_at,
    suggestion_stats.top_match_score,
    last_run.last_run_status,
    last_run.last_error_at,
    coalesce(
        private.second_wine_conflict(scored.source_match_key, scored.top_candidate_name),
        FALSE
    ) AS second_wine_conflict,
    scored.token_coverage,
    CASE
        WHEN scored.token_coverage IS NULL THEN 'none'
        WHEN scored.token_coverage >= 1 AND scored.typo_count = 0 THEN 'full'
        WHEN scored.token_coverage >= 1 THEN 'full_with_typos'
        WHEN scored.token_coverage >= 0.75 THEN 'partial'
        ELSE 'low'
    END AS coverage_tier
FROM scored
LEFT JOIN suggestion_stats USING (match_group_key)
LEFT JOIN last_run USING (match_group_key);
