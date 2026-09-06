-- Follow-up to 20260906140000: ANALYZE the freshly-backfilled evidence table.
--
-- On prod, immediately after the backfill the planner still had the default
-- ~8-row estimate for public.wine_match_group_evidence and chose a nested-loop
-- join with a 3.8M-row join filter for the wine_match_review_view v2-column
-- join -- 1.2 s for the /matches page query. A plain ANALYZE dropped it to
-- ~80 ms (hash/index joins). Autovacuum would get there eventually; this makes
-- it deterministic on every replay, branch and reset.

ANALYZE public.wine_match_group_evidence;

-- Fold the ANALYZE into the manual-resync path too.
CREATE OR REPLACE FUNCTION private.rebuild_wine_match_group_evidence()
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

    ANALYZE public.wine_match_group_evidence;
END;
$$;

REVOKE ALL ON FUNCTION private.rebuild_wine_match_group_evidence()
    FROM PUBLIC, anon, authenticated;
