-- Historic emails occasionally contain long price lists. The immutable raw row
-- already keeps the source intact; this normalised evidence field must not
-- block a whole resumable import because it happens to exceed an arbitrary cap.
ALTER TABLE public.release_offer_source_rows
    DROP CONSTRAINT release_offer_source_rows_source_price_text_check;

ALTER TABLE public.release_offer_source_rows
    ADD CONSTRAINT release_offer_source_rows_source_price_text_check
    CHECK (char_length(source_price_text) >= 1);
