-- An older accepted BBR offer export says "£X per bottle 6 case in bond" for
-- three 6 x 75 cl cases. The old parser preferred "per bottle" and stored
-- these as 1 x 75 cl, multiplying their historic per-bottle reference by six.
-- Preserve the source text, amount and fingerprint. Correct only the parsed
-- format, with exact preconditions so changed production evidence fails loudly.

DO $$
DECLARE
    v_import_id UUID := '6bfd17fb-9eaa-4b2d-bf51-31de8a0a006b';
    v_matches INT;
    v_updated INT;
BEGIN
    -- A fresh local database has no historical import. Production does.
    IF NOT EXISTS (SELECT 1 FROM public.release_offer_imports WHERE id = v_import_id) THEN
        RETURN;
    END IF;

    SELECT count(*) INTO v_matches
    FROM public.release_offer_prices price
    WHERE price.import_id = v_import_id
      AND price.fragment_index = 1
      AND price.source_row_number IN (1519, 1520, 1521)
      AND price.raw_price_text = CASE price.source_row_number
            WHEN 1519 THEN '£135 per bottle 6 case in bond'
            WHEN 1520 THEN '£138 per bottle 6 case in bond'
            WHEN 1521 THEN '£204 per bottle 6 case in bond'
          END
      AND price.amount_p = CASE price.source_row_number
            WHEN 1519 THEN 13500 WHEN 1520 THEN 13800 WHEN 1521 THEN 20400
          END
      AND price.case_size = 1
      AND price.bottle_volume_ml = 750
      AND price.format_code = '01-00750'
      AND price.tax_basis = 'in_bond'
      AND price.parse_status = 'valid';

    IF v_matches <> 3 OR EXISTS (
        SELECT 1 FROM public.release_offer_prices price
        WHERE price.import_id = v_import_id
          AND price.source_row_number IN (1519, 1520, 1521)
          AND price.format_code = '06-00750'
    ) THEN
        RAISE EXCEPTION 'Six-bottle offer correction preconditions failed';
    END IF;

    UPDATE public.release_offer_prices price
    SET case_size = 6, format_code = '06-00750'
    WHERE price.import_id = v_import_id
      AND price.source_row_number IN (1519, 1520, 1521)
      AND price.fragment_index = 1;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 3 THEN
        RAISE EXCEPTION 'Six-bottle offer correction updated % rows', v_updated;
    END IF;
END;
$$;
