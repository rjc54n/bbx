-- BBR holdings history, slice 5: current authority moves to the nomination.
--
-- Plan: docs/BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md, slice 5 and
-- decisions D1 (current authority) and D4 (derived history is query-time
-- views). Functional spec sections 7.4 and 8.
--
-- The last of the four migrations inside the acceptance freeze. Slice 6 is an
-- app deploy on top of these, and is what ends it.

-- 1. current_bbr_holdings stops meaning "the most recently accepted import"
--    and starts meaning "the snapshot the owner nominated as current". Those
--    coincide today -- production holds exactly one accepted import -- which
--    is what makes the switch safe to make before any second snapshot exists.
--
--    Replaced rather than dropped and recreated, because bbr_cellar_market_view
--    depends on it. CREATE OR REPLACE VIEW can only append columns, so
--    effective_date goes last and every existing column keeps its name,
--    type and position. confirmed_at deliberately stays accepted_at: it means
--    "when the owner confirmed this", which is not the same fact as the date
--    the file describes, and downstream code already reads it that way.
--
--    With no nomination the view is empty. It does not fall back to the newest
--    historical import: the honest answer to "what do I hold now" for a
--    database that has never nominated a current snapshot is nothing, not a
--    guess from dated evidence (spec 7.4).

CREATE OR REPLACE VIEW public.current_bbr_holdings
WITH (security_invoker = TRUE)
AS
WITH nominated AS (
    SELECT
        id,
        accepted_at,
        effective_date
    FROM public.cellar_imports
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted'
      AND accepted_role = 'current'
      AND superseded_at IS NULL
)
SELECT
    e.import_id,
    n.accepted_at AS confirmed_at,
    e.source_row_number,
    e.parent_sku,
    e.format_code,
    e.product_code,
    e.description,
    e.country,
    e.region,
    e.vintage,
    e.colour,
    e.maturity,
    e.drinking_window_from,
    e.drinking_window_to,
    e.bottle_volume_ml,
    e.quantity_bottles,
    e.eligible_for_bbx,
    e.purchase_price_per_case_p,
    e.case_size,
    e.livex_market_price_p,
    e.wine_searcher_lowest_list_price_p,
    e.bbx_last_transaction_price_p,
    e.bbx_lowest_price_p,
    e.bbx_highest_bid_p,
    e.current_status,
    e.alcohol_percent,
    n.effective_date
FROM nominated AS n
JOIN public.bbr_holding_evidence AS e ON e.import_id = n.id;

COMMENT ON VIEW public.current_bbr_holdings IS
    'Ownership evidence from the nominated current snapshot: accepted_role = current with no supersession. Empty when nothing is nominated. confirmed_at is when the owner accepted it; effective_date is the day the file describes.';

-- 2. The accepted-snapshot calendar and import history of spec section 8.
--    Accepted snapshots only, so that every row carries a real state and a
--    consumer cannot mistake a staged import for a point in the chronology --
--    which would matter to slice 9's episode inference, where a calendar date
--    with no observation is read as evidence of absence. Staged and failed
--    imports remain visible on the imports list, which reads cellar_imports
--    directly.
--
--    Never selects raw_row (spec section 10): the calendar is built from the
--    import record alone.

CREATE VIEW public.bbr_snapshot_view
WITH (security_invoker = TRUE)
AS
SELECT
    i.id AS import_id,
    i.original_filename,
    i.effective_date,
    i.uploaded_at,
    i.accepted_at,
    i.accepted_role,
    i.superseded_at,
    i.superseded_by,
    CASE
        WHEN i.accepted_role = 'historical' THEN 'historical'
        WHEN i.superseded_at IS NULL THEN 'nominated_current'
        ELSE 'superseded_current'
    END AS snapshot_state,
    (i.accepted_role = 'current' AND i.superseded_at IS NULL)
        AS is_nominated_current,
    i.status,
    i.parser_version,
    i.source_row_count,
    i.parsed_row_count,
    i.matched_row_count,
    i.unmatched_row_count,
    i.warning_row_count,
    i.error_row_count
FROM public.cellar_imports AS i
WHERE i.source_type = 'bbr_holdings'
  AND i.status = 'accepted';

COMMENT ON VIEW public.bbr_snapshot_view IS
    'One row per accepted BBR snapshot: the chronology slice 9 walks to tell continuous holding from absence, and the import history of spec section 8. Staged and failed imports are not in it. Unordered, like any view -- order by effective_date at the query, which is what the calendar walk depends on.';

REVOKE ALL ON public.bbr_snapshot_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bbr_snapshot_view TO authenticated;
