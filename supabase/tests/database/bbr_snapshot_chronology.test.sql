BEGIN;

SELECT plan(17);

INSERT INTO auth.users (id)
VALUES
    ('10000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002');

INSERT INTO public.app_owners (user_id)
VALUES ('10000000-0000-0000-0000-000000000001');

-- Three accepted BBR snapshots in the shape the slice 2 backfill produces: the
-- newest is the nomination, the two older ones stay accepted_role = 'current'
-- and are chained to their immediate successor. They go in newest first,
-- because only one of them may be an unsuperseded current declaration at any
-- point during the insert -- which is the invariant under test.

INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status,
    accepted_at, accepted_by, effective_date, accepted_role,
    superseded_at, superseded_by
)
VALUES
    (
        '40000000-0000-0000-0000-000000000003', 'bbr_holdings', repeat('c', 64),
        'my-cellar-view-2026-07-23.csv', 1000,
        '10000000-0000-0000-0000-000000000001/snapshot-c/source.csv',
        '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'accepted',
        '2026-07-23 09:00:00+00', '10000000-0000-0000-0000-000000000001',
        DATE '2026-07-23', 'current', NULL, NULL
    );

INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status,
    accepted_at, accepted_by, effective_date, accepted_role,
    superseded_at, superseded_by
)
VALUES
    (
        '40000000-0000-0000-0000-000000000002', 'bbr_holdings', repeat('b', 64),
        'my-cellar-view-2026-06-01.csv', 1000,
        '10000000-0000-0000-0000-000000000001/snapshot-b/source.csv',
        '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'accepted',
        '2026-06-01 09:00:00+00', '10000000-0000-0000-0000-000000000001',
        DATE '2026-06-01', 'current',
        '2026-07-23 09:00:00+00', '40000000-0000-0000-0000-000000000003'
    ),
    (
        '40000000-0000-0000-0000-000000000001', 'bbr_holdings', repeat('a', 64),
        'my-cellar-view-2026-05-01.csv', 1000,
        '10000000-0000-0000-0000-000000000001/snapshot-a/source.csv',
        '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'accepted',
        '2026-05-01 09:00:00+00', '10000000-0000-0000-0000-000000000001',
        DATE '2026-05-01', 'current',
        '2026-06-01 09:00:00+00', '40000000-0000-0000-0000-000000000002'
    );

SELECT is(
    (
        SELECT count(*)::INT
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted'
          AND accepted_role = 'current'
          AND superseded_at IS NULL
    ),
    1,
    'a three-snapshot chain leaves exactly one nominated current snapshot'
);

SELECT is(
    (
        SELECT count(*)::INT
        FROM public.cellar_imports AS earlier
        JOIN public.cellar_imports AS successor
          ON successor.id = earlier.superseded_by
        WHERE earlier.source_type = 'bbr_holdings'
          AND earlier.superseded_at = successor.accepted_at
          AND successor.effective_date > earlier.effective_date
    ),
    2,
    'each superseded snapshot points at the successor that replaced it'
);

SELECT throws_ok(
    $$
    INSERT INTO public.cellar_imports (
        id, source_type, content_checksum, original_filename, byte_size,
        storage_object_path, uploaded_by, parser_version, status,
        accepted_at, accepted_by, effective_date, accepted_role
    )
    VALUES (
        '40000000-0000-0000-0000-000000000004', 'bbr_holdings', repeat('d', 64),
        'my-cellar-view-2026-08-01.csv', 1000,
        '10000000-0000-0000-0000-000000000001/second-current/source.csv',
        '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'accepted',
        '2026-08-01 09:00:00+00', '10000000-0000-0000-0000-000000000001',
        DATE '2026-08-01', 'current'
    )
    $$,
    '23505',
    'duplicate key value violates unique constraint "cellar_imports_one_nominated_current_idx"',
    'a second unsuperseded current declaration is refused'
);

SELECT throws_ok(
    $$
    INSERT INTO public.cellar_imports (
        id, source_type, content_checksum, original_filename, byte_size,
        storage_object_path, uploaded_by, parser_version, status,
        accepted_at, accepted_by, effective_date, accepted_role
    )
    VALUES (
        '40000000-0000-0000-0000-000000000005', 'bbr_holdings', repeat('e', 64),
        'my-cellar-view-2026-07-23.csv', 1000,
        '10000000-0000-0000-0000-000000000001/same-date/source.csv',
        '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'accepted',
        '2026-08-02 09:00:00+00', '10000000-0000-0000-0000-000000000001',
        DATE '2026-07-23', 'historical'
    )
    $$,
    '23505',
    'duplicate key value violates unique constraint "cellar_imports_bbr_effective_date_idx"',
    'a second accepted snapshot for an effective date already held is refused'
);

SELECT lives_ok(
    $$
    INSERT INTO public.cellar_imports (
        id, source_type, content_checksum, original_filename, byte_size,
        storage_object_path, uploaded_by, parser_version, status,
        accepted_at, accepted_by, effective_date, accepted_role
    )
    VALUES (
        '40000000-0000-0000-0000-000000000006', 'bbr_holdings', repeat('f', 64),
        'my-cellar-view-2025-05-21.csv', 1000,
        '10000000-0000-0000-0000-000000000001/historical/source.csv',
        '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'accepted',
        '2026-08-03 09:00:00+00', '10000000-0000-0000-0000-000000000001',
        DATE '2025-05-21', 'historical'
    )
    $$,
    'a historical snapshot on a free date joins the chronology'
);

SELECT throws_ok(
    $$
    INSERT INTO public.cellar_imports (
        id, source_type, content_checksum, original_filename, byte_size,
        storage_object_path, uploaded_by, parser_version, status,
        accepted_at, accepted_by, accepted_role
    )
    VALUES (
        '40000000-0000-0000-0000-000000000007', 'bbr_holdings', repeat('1', 64),
        'my-cellar-view-2026-09-01.csv', 1000,
        '10000000-0000-0000-0000-000000000001/undated/source.csv',
        '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'accepted',
        '2026-09-01 09:00:00+00', '10000000-0000-0000-0000-000000000001',
        'current'
    )
    $$,
    '23514',
    'new row for relation "cellar_imports" violates check constraint "cellar_imports_accepted_bbr_dated_check"',
    'an accepted BBR import without an effective date is refused'
);

SELECT throws_ok(
    $$
    INSERT INTO public.cellar_imports (
        id, source_type, content_checksum, original_filename, byte_size,
        storage_object_path, uploaded_by, parser_version, status,
        accepted_at, accepted_by, effective_date
    )
    VALUES (
        '40000000-0000-0000-0000-000000000008', 'bbr_holdings', repeat('2', 64),
        'my-cellar-view-2026-09-02.csv', 1000,
        '10000000-0000-0000-0000-000000000001/roleless/source.csv',
        '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'accepted',
        '2026-09-02 09:00:00+00', '10000000-0000-0000-0000-000000000001',
        DATE '2026-09-02'
    )
    $$,
    '23514',
    'new row for relation "cellar_imports" violates check constraint "cellar_imports_accepted_bbr_dated_check"',
    'an accepted BBR import without a role is refused'
);

SELECT throws_ok(
    $$
    UPDATE public.cellar_imports
    SET superseded_at = '2026-08-01 09:00:00+00'
    WHERE id = '40000000-0000-0000-0000-000000000003'
    $$,
    '23514',
    'new row for relation "cellar_imports" violates check constraint "cellar_imports_supersession_paired_check"',
    'a supersession timestamp without the superseding import is refused'
);

SELECT throws_ok(
    $$
    UPDATE public.cellar_imports
    SET accepted_role = 'historical'
    WHERE id = '40000000-0000-0000-0000-000000000002'
    $$,
    '23514',
    'new row for relation "cellar_imports" violates check constraint "cellar_imports_superseded_was_current_check"',
    'a superseded snapshot cannot be anything but a former current declaration'
);

SELECT throws_ok(
    $$
    UPDATE public.cellar_imports
    SET accepted_role = 'nominated'
    WHERE id = '40000000-0000-0000-0000-000000000003'
    $$,
    '23514',
    'new row for relation "cellar_imports" violates check constraint "cellar_imports_accepted_role_check"',
    'only current and historical are acceptance roles'
);

SELECT throws_ok(
    $$
    INSERT INTO public.cellar_imports (
        id, source_type, content_checksum, original_filename, byte_size,
        storage_object_path, uploaded_by, parser_version, status,
        superseded_at, superseded_by
    )
    VALUES (
        '40000000-0000-0000-0000-00000000000b', 'bbr_holdings', repeat('5', 64),
        'my-cellar-view-2026-09-04.csv', 1000,
        '10000000-0000-0000-0000-000000000001/roleless-supersession/source.csv',
        '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'validated',
        '2026-09-04 09:00:00+00', '40000000-0000-0000-0000-000000000003'
    )
    $$,
    '23514',
    'new row for relation "cellar_imports" violates check constraint "cellar_imports_superseded_was_current_check"',
    'supersession without any acceptance role at all is refused'
);

SELECT lives_ok(
    $$
    INSERT INTO public.cellar_imports (
        id, source_type, content_checksum, original_filename, byte_size,
        storage_object_path, uploaded_by, parser_version, status,
        accepted_at, accepted_by
    )
    VALUES (
        '40000000-0000-0000-0000-000000000009', 'cellartracker_inventory',
        repeat('3', 64), 'My Cellar.csv', 1000,
        '10000000-0000-0000-0000-000000000001/cellartracker/source.csv',
        '10000000-0000-0000-0000-000000000001', 'ct-v1', 'accepted',
        '2026-09-03 09:00:00+00', '10000000-0000-0000-0000-000000000001'
    )
    $$,
    'a CellarTracker import is accepted without an effective date or role'
);

SELECT is(
    has_function_privilege(
        'anon',
        'public.accept_bbr_import(uuid)',
        'EXECUTE'
    ),
    FALSE,
    'the withdrawn acceptance RPC is still closed to anonymous callers'
);

SELECT is(
    has_function_privilege(
        'authenticated',
        'public.accept_bbr_import(uuid)',
        'EXECUTE'
    ),
    TRUE,
    'replacing the acceptance RPC body left its execute grant intact'
);

INSERT INTO public.cellar_imports (
    id,
    source_type,
    content_checksum,
    original_filename,
    byte_size,
    storage_object_path,
    uploaded_by,
    parser_version,
    status
)
VALUES (
    '40000000-0000-0000-0000-00000000000a',
    'bbr_holdings',
    repeat('4', 64),
    'my-cellar-view-2026-09-05.csv',
    1000,
    '10000000-0000-0000-0000-000000000001/staged/source.csv',
    '10000000-0000-0000-0000-000000000001',
    'bbr-v2',
    'validated'
);

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_import('40000000-0000-0000-0000-00000000000a')
    $$,
    '0A000',
    'accept_bbr_import is withdrawn: a BBR snapshot is now accepted with an explicit effective date and role',
    'the undated acceptance path is withdrawn even for the owner'
);

SELECT is(
    (
        SELECT status
        FROM public.cellar_imports
        WHERE id = '40000000-0000-0000-0000-00000000000a'
    ),
    'validated',
    'the refused call leaves the staged import unaccepted'
);

RESET ROLE;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT is(
    (
        SELECT count(*)::INT
        FROM public.cellar_imports
        WHERE effective_date IS NOT NULL
    ),
    0,
    'RLS hides snapshot chronology from a non-owner'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
