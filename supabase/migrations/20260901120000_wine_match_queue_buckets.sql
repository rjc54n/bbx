-- Wine matching, Part A follow-up: split the matching queue into three disjoint
-- buckets. See docs/MATCHING-FUNCTIONAL-SPEC.md §3.5.
--
-- Slice 1 shipped wine_match_queue_summary with `needs_review` (the whole
-- unresolved backlog) and `with_suggestions` (a *subset* of it). Presented as
-- side-by-side tiles that read as siblings, not parent/child, which is
-- confusing: a group with candidates shows under both.
--
-- The queue is now three mutually exclusive buckets that partition the backlog:
--
--   with_suggestions : unresolved, last run did not fail, has >= 1 candidate
--   no_suggestions   : unresolved, last run did not fail, no candidate
--   errors           : unresolved and the last match run failed on the group
--
-- `needs_review` stays as the umbrella count (unresolved_row_count > 0) so the
-- `?state=needs-review` URL keeps working for old bookmarks; it now equals
-- with_suggestions + no_suggestions + errors exactly. A fully-resolved group
-- whose last run failed is no longer counted here — it is `linked` (or
-- `no_suitable_match`), and the stale failure is still visible on the card.
--
-- RETURNS TABLE changes shape, so this is DROP + CREATE, not CREATE OR REPLACE.
-- SECURITY INVOKER and the grant/revoke are unchanged.

DROP FUNCTION IF EXISTS public.wine_match_queue_summary(TEXT);

CREATE FUNCTION public.wine_match_queue_summary(p_source TEXT DEFAULT NULL)
RETURNS TABLE (
    needs_review BIGINT,
    with_suggestions BIGINT,
    no_suggestions BIGINT,
    errors BIGINT,
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
        count(*)
    FROM public.wine_match_review_view review
    WHERE p_source IS NULL OR review.source = p_source;
$$;

REVOKE ALL ON FUNCTION public.wine_match_queue_summary(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wine_match_queue_summary(TEXT) TO authenticated;
