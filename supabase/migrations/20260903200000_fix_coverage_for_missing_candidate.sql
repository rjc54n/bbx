-- Fix: a group with no rank-1 candidate must be tier 'none', not 'low'.
--
-- 20260903190000 moved the NULL guard in private.wine_token_coverage from the
-- raw text arguments onto token arrays, and the guard stopped firing.
-- private.wine_core_tokens coalesces a NULL input to '', and array_agg over
-- zero rows is coalesced to ARRAY[]::TEXT[], so
--
--   private.wine_coverage_tokens(NULL) = '{}'   -- an empty array, NOT NULL
--
-- The `p_candidate_tokens IS NULL` branch therefore never matched for a group
-- with no suggestion; coverage was computed as 0 / n = 0.0 and the group was
-- tiered 'low' instead of 'none'.
--
-- That is not cosmetic. The /matches tier filter excludes 'low' and never
-- 'none', precisely so that groups with no suggestions keep showing up
-- (docs/MATCHING-QUEUE-TRIAGE-SPEC.md §4.2). The regression silently hid 99
-- unresolved no-suggestion groups from the default queue — the groups that
-- most need a human, since the matcher found nothing at all for them.
--
-- Guarding on cardinality covers both cases: a NULL argument and an argument
-- that normalises away to nothing. Coverage against nothing is undefined, not
-- zero, and NULL is what the tier CASE reads as 'none'.

CREATE OR REPLACE FUNCTION private.wine_token_coverage(
    p_source_tokens TEXT[],
    p_candidate_tokens TEXT[]
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_source_tokens IS NULL OR p_candidate_tokens IS NULL THEN NULL
        WHEN cardinality(p_source_tokens) = 0 THEN NULL
        WHEN cardinality(p_candidate_tokens) = 0 THEN NULL
        ELSE (
            SELECT count(*)::DOUBLE PRECISION
            FROM unnest(p_source_tokens) AS token
            WHERE token = ANY (p_candidate_tokens)
        ) / cardinality(p_source_tokens)
    END;
$$;
