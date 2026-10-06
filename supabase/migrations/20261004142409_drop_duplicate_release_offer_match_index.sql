-- The unique constraint already supplies the same (match_group_key, rank)
-- B-tree access path. Keep that constraint and remove only the duplicate.
DROP INDEX public.idx_release_offer_match_suggestions_group_rank;
