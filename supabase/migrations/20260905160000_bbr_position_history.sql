-- BBR holdings history, slice 7: the history projections.
--
-- Plan: docs/BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md, slice 7 and
-- decisions D4 (derived history is query-time views), D8 (membership is a
-- tri-state) and D10 (position grain). Functional spec sections 5 and 6.
--
-- Three views, nothing else. No table, no trigger, no materialisation: at 116
-- positions per snapshot, twenty recovered snapshots are ~2,300 evidence rows,
-- and D4 records the thresholds at which that judgement is revisited.
--
-- Nothing reads these yet. Slices 8 and 9 are the app on top of them, so the
-- rollback for this slice is DROP VIEW on all three, in reverse order.
--
-- D10 resolved to the no-repeats branch in slice 0: no recovered export
-- repeats a (Parent ID, derived format), so slice 3 added
-- bbr_holding_evidence_position_key UNIQUE (import_id, parent_sku,
-- format_code) and observation grain is evidence grain. There is no
-- aggregation here, and the unique index is what makes that safe -- without
-- it, a repeat would silently become two observations of one day.

-- 1. Observation grain: one row per position per accepted snapshot.
--
--    Accepted snapshots only, and every accepted snapshot -- historical,
--    nominated current and superseded current alike. All three are dated
--    evidence, so all three are observations; accepted_role and superseded_at
--    are carried so a consumer can tell which is which without a second
--    query, and bbr_snapshot_view carries the derived state for the ones that
--    want it spelled out.
--
--    Never selects raw_row (spec section 10). The source CSV holds Account
--    Payer and Beneficial Owner columns which the parser never lifts into
--    evidence; nothing in this file can reach them, and nothing in this file
--    should acquire a route to them.
--
--    effective_date, not accepted_at: the chronology is the days the files
--    describe, not the order the owner happened to accept them in.

CREATE VIEW public.bbr_position_observations
WITH (security_invoker = TRUE)
AS
SELECT
    i.id AS import_id,
    i.effective_date,
    i.accepted_role,
    i.superseded_at,
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
    e.current_status,
    e.catalogue_matched
FROM public.cellar_imports AS i
JOIN public.bbr_holding_evidence AS e ON e.import_id = i.id
WHERE i.source_type = 'bbr_holdings'
  AND i.status = 'accepted';

COMMENT ON VIEW public.bbr_position_observations IS
    'One row per (import_id, parent_sku, format_code) across every accepted BBR snapshot: what the file said was held on its effective date. Provenance is the import row and source_row_number. Dated observations only -- nothing here is a transaction, an acquisition or a disposal.';

REVOKE ALL ON public.bbr_position_observations
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bbr_position_observations TO authenticated;

-- 2. Consolidated grain: one row per position across the whole chronology.
--
--    membership is D8's tri-state and the reason this view cannot be a plain
--    GROUP BY. With no nominated current snapshot nothing has been
--    established about current membership, so every position is 'unknown'
--    with a NULL current quantity -- null because zero is a claim and null is
--    the absence of one. A position observed anywhere but not in the
--    nomination is 'former' with zero, which is a claim, and one the
--    nomination evidences.
--
--    absent_by is the earliest accepted effective_date after last_seen: the
--    first day a complete snapshot did not carry the position. It is null
--    while the position is in the most recent snapshot. It says nothing about
--    why, and deliberately cannot: spec 5.3 permits "absent by this date" and
--    forbids "sold" or "withdrawn". Intermediate absences are not visible
--    here -- a position present, absent, then present again has a last_seen
--    at the end of that story. Slice 9's calendar walk is what recovers the
--    episodes, and it needs bbr_snapshot_view to do it.
--
--    The identity and source-status columns come from the latest observation
--    rather than any observation, because a description or case size that
--    changed between exports should read as the most recent thing BBR said.
--    D2's one-accepted-snapshot-per-date index is what makes "latest"
--    single-valued: effective_date is unique among accepted snapshots, so the
--    DISTINCT ON below has no tie to break.

CREATE VIEW public.bbr_positions_view
WITH (security_invoker = TRUE)
AS
WITH nomination AS (
    SELECT id
    FROM public.cellar_imports
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted'
      AND accepted_role = 'current'
      AND superseded_at IS NULL
),
observation AS (
    SELECT * FROM public.bbr_position_observations
),
consolidated AS (
    SELECT
        o.parent_sku,
        o.format_code,
        min(o.effective_date) AS first_seen,
        max(o.effective_date) AS last_seen,
        min(o.purchase_price_per_case_p) AS reported_price_min_p,
        max(o.purchase_price_per_case_p) AS reported_price_max_p,
        count(*)::INT AS observation_count
    FROM observation AS o
    GROUP BY o.parent_sku, o.format_code
),
latest AS (
    -- import_id only breaks a tie D2's index says cannot happen. It is here so
    -- that if that index is ever lost, this view returns a wrong answer
    -- consistently rather than a different one on each plan.
    SELECT DISTINCT ON (o.parent_sku, o.format_code) o.*
    FROM observation AS o
    ORDER BY o.parent_sku, o.format_code, o.effective_date DESC, o.import_id
),
current_observation AS (
    SELECT o.*
    FROM observation AS o
    JOIN nomination AS n ON n.id = o.import_id
)
SELECT
    c.parent_sku,
    c.format_code,
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM nomination) THEN 'unknown'
        WHEN cur.import_id IS NOT NULL THEN 'current'
        ELSE 'former'
    END AS membership,
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM nomination) THEN NULL
        ELSE coalesce(cur.quantity_bottles, 0)
    END AS current_quantity_bottles,
    c.first_seen,
    c.last_seen,
    a.absent_by,
    c.reported_price_min_p,
    c.reported_price_max_p,
    c.observation_count,
    -- The same date as last_seen at this grain, and named separately because
    -- spec 5.1 asks for both and because the decoration below is read as of
    -- this observation, not as of the position as a whole.
    l.effective_date AS latest_observation_date,
    l.import_id AS latest_import_id,
    l.source_row_number AS latest_source_row_number,
    l.catalogue_matched AS latest_catalogue_matched,
    l.quantity_bottles AS latest_quantity_bottles,
    l.purchase_price_per_case_p AS latest_purchase_price_per_case_p,
    l.product_code,
    l.description,
    l.country,
    l.region,
    l.vintage,
    l.colour,
    l.maturity,
    l.drinking_window_from,
    l.drinking_window_to,
    l.bottle_volume_ml,
    l.eligible_for_bbx,
    l.case_size,
    l.current_status
FROM consolidated AS c
JOIN latest AS l
    ON l.parent_sku = c.parent_sku
   AND l.format_code = c.format_code
LEFT JOIN current_observation AS cur
    ON cur.parent_sku = c.parent_sku
   AND cur.format_code = c.format_code
LEFT JOIN LATERAL (
    SELECT min(s.effective_date) AS absent_by
    FROM public.bbr_snapshot_view AS s
    WHERE s.effective_date > c.last_seen
) AS a ON TRUE;

COMMENT ON VIEW public.bbr_positions_view IS
    'One row per (parent_sku, format_code) consolidated across every accepted BBR snapshot. membership is current, former or unknown (D8): unknown means no snapshot is nominated as current, and its current_quantity_bottles is null rather than zero. Identity and source-status columns are as at latest_observation_date. absent_by is the first accepted effective date on which a snapshot did not carry the position, and is evidence of absence only -- never of a sale.';

REVOKE ALL ON public.bbr_positions_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bbr_positions_view TO authenticated;

-- 3. The consolidated positions with live market decoration.
--
--    The same left join and the same catalogue columns as
--    bbr_cellar_market_view, so slice 8 adapts the existing browser instead of
--    rewriting it. Left, not inner: a position whose Parent ID the local
--    catalogue does not carry stays in the cellar with null decoration. That
--    is D3's rule -- ownership evidence does not depend on catalogue coverage
--    -- and it is why a former position from a 2019 export is still visible
--    years after the wine left the catalogue.
--
--    Imported BBX prices are not exposed here. They are immutable source
--    evidence of what BBR reported on a past date; the live scanner values
--    are what a market column should show (spec 6.9).

CREATE VIEW public.bbr_cellar_positions_market_view
WITH (security_invoker = TRUE)
AS
SELECT
    p.parent_sku,
    p.format_code,
    p.membership,
    p.current_quantity_bottles,
    p.first_seen,
    p.last_seen,
    p.absent_by,
    p.reported_price_min_p,
    p.reported_price_max_p,
    p.observation_count,
    p.latest_observation_date,
    p.latest_import_id,
    p.latest_source_row_number,
    p.latest_catalogue_matched,
    p.latest_quantity_bottles,
    p.latest_purchase_price_per_case_p,
    p.product_code,
    p.description,
    p.country,
    p.region,
    p.vintage,
    p.colour,
    p.maturity,
    p.drinking_window_from,
    p.drinking_window_to,
    p.bottle_volume_ml,
    p.eligible_for_bbx,
    p.case_size,
    p.current_status,
    c.name AS catalogue_name,
    c.producer,
    c.product_url,
    c.is_listed,
    c.highest_bid_p,
    c.ask AS lowest_ask_p,
    c.market_price_p,
    c.last_rest_checked_at
FROM public.bbr_positions_view AS p
LEFT JOIN public.catalogue_view AS c
    ON c.parent_sku = p.parent_sku
   AND c.format_code = p.format_code;

COMMENT ON VIEW public.bbr_cellar_positions_market_view IS
    'Every owned position, current and former, with live scanner market values at exact product-format grain. The all-owned counterpart of bbr_cellar_market_view, which stays at current-holdings grain. Market values are live and are never treated as ownership history.';

REVOKE ALL ON public.bbr_cellar_positions_market_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bbr_cellar_positions_market_view TO authenticated;
