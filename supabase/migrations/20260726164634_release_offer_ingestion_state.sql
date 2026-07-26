-- Durable state for weekly connector ingestion. Tracking URLs are represented
-- only by a SHA-256 digest; personalised tokens never enter operational logs
-- or mutable resolution state.

CREATE TABLE public.release_offer_ingestion_cursors (
    source_type                TEXT PRIMARY KEY CHECK (source_type = 'gmail'),
    last_successful_message_at TIMESTAMPTZ,
    last_successful_message_id TEXT,
    last_import_id             UUID REFERENCES public.release_offer_imports(id),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (last_successful_message_at IS NULL AND last_successful_message_id IS NULL)
        OR
        (last_successful_message_at IS NOT NULL AND last_successful_message_id IS NOT NULL)
    )
);

INSERT INTO public.release_offer_ingestion_cursors(source_type)
VALUES ('gmail');

CREATE TABLE public.release_offer_link_resolutions (
    tracking_url_sha256 TEXT PRIMARY KEY
        CHECK (tracking_url_sha256 ~ '^[0-9a-f]{64}$'),
    status              TEXT NOT NULL
        CHECK (status IN ('resolved', 'not_product', 'failed')),
    final_product_url   TEXT,
    source_product_id   TEXT,
    attempted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (status = 'resolved' AND final_product_url IS NOT NULL)
        OR
        (status <> 'resolved' AND final_product_url IS NULL AND source_product_id IS NULL)
    )
);

ALTER TABLE public.release_offer_ingestion_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_offer_link_resolutions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
    public.release_offer_ingestion_cursors,
    public.release_offer_link_resolutions
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON
    public.release_offer_ingestion_cursors,
    public.release_offer_link_resolutions
TO authenticated;

CREATE POLICY "Owner can read release ingestion cursors"
    ON public.release_offer_ingestion_cursors FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can read release link resolutions"
    ON public.release_offer_link_resolutions FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
