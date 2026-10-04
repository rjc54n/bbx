-- Choose the latest event while rows are narrow. The DISTINCT ON tie rule is
-- unchanged; catalogue details are joined only after one event per format is
-- selected. PostgreSQL may inline this CTE and avoid materialising wide rows.
CREATE OR REPLACE VIEW public.recent_price_change_view
WITH (security_invoker = true) AS
WITH latest AS (
    SELECT DISTINCT ON (ph.parent_sku, ph.format_code)
        ph.parent_sku,
        ph.format_code,
        ph.field_name,
        ph.old_value_raw,
        ph.new_value_raw,
        ph.observed_at
    FROM public.price_history_view ph
    ORDER BY ph.parent_sku, ph.format_code, ph.observed_at DESC, ph.event_id DESC
)
SELECT
    latest.parent_sku,
    latest.format_code,
    c.name,
    c.vintage,
    c.country,
    c.region,
    c.subregion,
    c.colour,
    c.producer,
    c.product_url,
    c.case_size,
    c.bottle_volume_ml,
    latest.field_name,
    latest.old_value_raw,
    latest.new_value_raw,
    latest.observed_at
FROM latest
JOIN public.catalogue_view c
    ON c.parent_sku = latest.parent_sku AND c.format_code = latest.format_code;
