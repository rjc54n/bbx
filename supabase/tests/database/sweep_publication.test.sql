BEGIN;
SELECT plan(10);

INSERT INTO private.scan_runs (id, scope, run_date, status, started_at)
VALUES ('b1000000-0000-0000-0000-000000000001', 'publication_test', '2026-10-03', 'running', now());
SELECT is((SELECT published_at FROM private.scan_runs WHERE scope = 'publication_test'),
          NULL::timestamptz, 'a started run is not a publication');
SELECT is((SELECT publication_stages FROM private.scan_runs WHERE scope = 'publication_test'),
          '{}'::jsonb, 'stage evidence starts empty');
SELECT throws_ok(
    $$UPDATE private.scan_runs SET published_at = now() WHERE scope = 'publication_test'$$,
    '23514', NULL, 'publication requires a source commit');
SELECT throws_ok(
    $$UPDATE private.scan_runs SET source_status = 'failed' WHERE scope = 'publication_test'$$,
    '23514', NULL, 'source quality is completed or partial');
SELECT throws_ok(
    $$UPDATE private.scan_runs SET rotation_bucket = 15 WHERE scope = 'publication_test'$$,
    '23514', NULL, 'rotation has fifteen buckets');
UPDATE private.scan_runs SET source_committed_at = now(), source_status = 'partial',
    rotation_bucket = 14 WHERE scope = 'publication_test';
SELECT is((SELECT finished_at FROM private.scan_runs WHERE scope = 'publication_test'),
          NULL::timestamptz, 'source commit does not finish the attempt');
UPDATE private.scan_runs SET published_at = now(), status = 'partial', finished_at = now()
    WHERE scope = 'publication_test';
SELECT ok((SELECT published_at IS NOT NULL FROM public.scan_health_view WHERE scope = 'publication_test'),
          'partial source quality can have a verified publication');
SELECT ok((SELECT 'security_invoker=true' = ANY(reloptions) FROM pg_class
           WHERE oid = 'public.scan_health_view'::regclass), 'status view preserves invoker security');
SELECT ok(has_table_privilege('anon', 'public.scan_health_view', 'SELECT'), 'public status remains readable');
SELECT ok(NOT has_table_privilege('anon', 'private.scan_runs', 'UPDATE'), 'public readers cannot forge publication');
SELECT * FROM finish();
ROLLBACK;
