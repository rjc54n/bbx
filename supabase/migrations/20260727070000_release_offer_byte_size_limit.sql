-- Phase 7 Phase B: the historic-offers CSV now uploads directly to Storage and
-- the app + bucket limits rose to 10 MB. release_offer_imports still carried the
-- original 4 MiB byte_size CHECK, so a valid 4.12 MB file was rejected at insert
-- with a 23514 check-constraint violation. Raise the CHECK to match the 10 MB
-- (10485760-byte) app and bucket limits. The constraint still passes on NULL
-- (gmail imports record no byte_size), and the BBR cellar_imports cap is left at
-- 4 MiB deliberately -- BBR exports stay small.

ALTER TABLE public.release_offer_imports
    DROP CONSTRAINT release_offer_imports_byte_size_check;

ALTER TABLE public.release_offer_imports
    ADD CONSTRAINT release_offer_imports_byte_size_check
        CHECK (byte_size BETWEEN 1 AND 10485760);
