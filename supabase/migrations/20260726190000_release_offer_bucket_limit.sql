-- Phase 7 Phase B: the historic-offers CSV now uploads directly to Storage
-- from the browser (bypassing the serverless function request-body ceiling),
-- so the app-level cap can grow. The bucket's own file_size_limit is a hard
-- floor enforced by Storage itself, independent of app validation -- it must
-- rise with the app cap or uploads between the old and new limits are
-- rejected by Storage regardless of what the app checks. Only the numeric
-- limit changes; visibility, RLS and allowed MIME types are untouched.

UPDATE storage.buckets
SET file_size_limit = 10485760
WHERE id = 'cellar-imports';
