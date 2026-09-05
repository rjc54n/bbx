"""Two-session concurrency checks for public.accept_bbr_snapshot.

pgTAP runs in one session and cannot prove that two simultaneous acceptances
cannot both win, so the chronology rules that only bind across transactions are
asserted here instead. Each case drives two real connections through a hostile
interleaving: session A accepts and holds its transaction open, session B is
confirmed to be waiting, A commits, and B is then required to see the
chronology A committed rather than the one it read before waiting.

These cases fail against the pre-20260905170000 function, which serialised
itself by locking the nominated current row:

  * with no nomination, that lock locks nothing, so a historical acceptance
    runs straight through a concurrent current one;
  * with a nomination, the waiting transaction wakes to find the row it locked
    no longer matches "not superseded", reads no nomination at all, and skips
    the post-dating check.

Both produce a historical snapshot dated after the nominated current one.

Safety: local database or an isolated data branch only, never production
(AGENTS.md, plan section 6). A non-loopback host is refused unless it is
explicitly declared to be an isolated branch.
"""
import os
import threading
import time
import urllib.parse

import pytest

psycopg2 = pytest.importorskip(
    "psycopg2", reason="psycopg2 is needed to drive two database sessions"
)

LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DB_URL = os.environ.get("BBX_TEST_DB_URL", LOCAL_DB_URL)
ISOLATED_BRANCH = os.environ.get("BBX_TEST_DB_IS_ISOLATED_BRANCH") == "1"

LOOPBACK = {"127.0.0.1", "::1", "localhost", "db", "supabase_db_bbx"}

# Fixture identity, kept in its own UUID namespace so teardown never touches
# anything else in the database.
OWNER_ID = "7c000000-0000-0000-0000-000000000001"
IMPORT_PREFIX = "7c000000-0000-0000-0000-0000000000"

# Every wait in this file is bounded: a wedged session fails the test instead of
# hanging the suite.
BLOCK_TIMEOUT_S = 5.0
JOIN_TIMEOUT_S = 30.0
STATEMENT_TIMEOUT = "15s"
IDLE_IN_TRANSACTION_TIMEOUT = "30s"


def _refuse_unsafe_target():
    host = urllib.parse.urlsplit(DB_URL).hostname or ""
    if host in LOOPBACK or ISOLATED_BRANCH:
        return
    pytest.fail(
        f"refusing to run concurrency tests against {host!r}. They hold "
        "transactions open and contend on locks, which production has no "
        "headroom for. Point BBX_TEST_DB_URL at the local database, or set "
        "BBX_TEST_DB_IS_ISOLATED_BRANCH=1 for a data branch."
    )


def _connect(autocommit=False):
    conn = psycopg2.connect(DB_URL, connect_timeout=5)
    conn.autocommit = autocommit
    return conn


def _prepare_session(conn):
    """A transaction that speaks as the owner and cannot wait indefinitely."""
    with conn.cursor() as cur:
        cur.execute("SET LOCAL statement_timeout = %s", (STATEMENT_TIMEOUT,))
        cur.execute(
            "SET LOCAL idle_in_transaction_session_timeout = %s",
            (IDLE_IN_TRANSACTION_TIMEOUT,),
        )
        cur.execute(
            "SELECT set_config('request.jwt.claims', %s, TRUE)",
            ('{"sub":"%s","role":"authenticated"}' % OWNER_ID,),
        )
        cur.execute("SET LOCAL ROLE authenticated")


def _accept(conn, import_id, effective_date, role):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT public.accept_bbr_snapshot(%s, %s::DATE, %s)",
            (import_id, effective_date, role),
        )
        return cur.fetchone()[0]


@pytest.fixture(scope="module")
def admin():
    _refuse_unsafe_target()
    try:
        conn = _connect(autocommit=True)
    except psycopg2.OperationalError as exc:
        pytest.skip(f"no local database to test against: {exc}")

    with conn.cursor() as cur:
        cur.execute(
            "SELECT to_regprocedure('public.accept_bbr_snapshot(uuid,date,text)')"
        )
        if cur.fetchone()[0] is None:
            pytest.skip("accept_bbr_snapshot is not present; run supabase db reset")

        # The invariants asserted here are properties of the whole BBR
        # chronology, so it has to start empty.
        cur.execute(
            """
            SELECT count(*) FROM public.cellar_imports
            WHERE source_type = 'bbr_holdings' AND status = 'accepted'
            """
        )
        if cur.fetchone()[0]:
            pytest.skip(
                "this database already holds accepted BBR snapshots; run these "
                "against a freshly reset local database"
            )

        cur.execute(
            "INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING",
            (OWNER_ID,),
        )
        cur.execute(
            "INSERT INTO public.app_owners (user_id) VALUES (%s) "
            "ON CONFLICT DO NOTHING",
            (OWNER_ID,),
        )

    yield conn

    _clean(conn)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.app_owners WHERE user_id = %s", (OWNER_ID,))
        cur.execute("DELETE FROM auth.users WHERE id = %s", (OWNER_ID,))
    conn.close()


def _clean(conn):
    # One DELETE per table, covering every fixture import at once: superseded_by
    # points from one fixture row to another, and that foreign key is checked at
    # the end of the statement rather than row by row.
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM public.bbr_holding_evidence WHERE import_id::TEXT LIKE %s",
            (IMPORT_PREFIX + "%",),
        )
        cur.execute(
            "DELETE FROM public.cellar_import_rows WHERE import_id::TEXT LIKE %s",
            (IMPORT_PREFIX + "%",),
        )
        cur.execute(
            "DELETE FROM public.cellar_imports WHERE id::TEXT LIKE %s",
            (IMPORT_PREFIX + "%",),
        )


def _stage(conn, suffix):
    """A complete, validated BBR import: one valid row, one evidence row."""
    import_id = IMPORT_PREFIX + suffix
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.cellar_imports (
                id, source_type, content_checksum, original_filename, byte_size,
                storage_object_path, uploaded_by, parser_version, status,
                source_row_count, parsed_row_count, matched_row_count,
                unmatched_row_count, error_row_count
            )
            VALUES (
                %s, 'bbr_holdings', %s, %s, 1000, %s, %s, 'bbr-v2', 'validated',
                1, 1, 0, 1, 0
            )
            """,
            (
                import_id,
                (suffix * 32)[:64],
                f"my-cellar-view-concurrency-{suffix}.csv",
                f"{OWNER_ID}/{import_id}/source.csv",
                OWNER_ID,
            ),
        )
        cur.execute(
            "INSERT INTO public.cellar_import_rows "
            "(import_id, source_row_number, raw_row, match_status) "
            "VALUES (%s, 1, '{}'::JSONB, 'unmatched')",
            (import_id,),
        )
        cur.execute(
            """
            INSERT INTO public.bbr_holding_evidence (
                import_id, source_row_number, parent_sku, format_code,
                catalogue_matched, product_code, description, bottle_volume_ml,
                quantity_bottles, eligible_for_bbx, case_size
            )
            VALUES (%s, 1, '90000000001', '06-00750', FALSE, 'fixture',
                    'Fixture wine', 750, 6, TRUE, 6)
            """,
            (import_id,),
        )
    return import_id


@pytest.fixture
def chronology(admin):
    _clean(admin)
    yield admin
    _clean(admin)


class Contender(threading.Thread):
    """The second session: one acceptance, run to completion or to its error."""

    def __init__(self, import_id, effective_date, role):
        super().__init__(daemon=True)
        self.import_id = import_id
        self.effective_date = effective_date
        self.role = role
        self.result = None
        self.error = None

    def run(self):
        conn = _connect()
        try:
            _prepare_session(conn)
            self.result = _accept(
                conn, self.import_id, self.effective_date, self.role
            )
            conn.commit()
        except Exception as exc:  # recorded and asserted on by the test
            self.error = exc
            conn.rollback()
        finally:
            conn.close()


def _wait_until_blocked(admin, timeout=BLOCK_TIMEOUT_S):
    """True once another backend is waiting on a lock inside the RPC."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with admin.cursor() as cur:
            cur.execute(
                """
                SELECT count(*) FROM pg_stat_activity
                WHERE pid <> pg_backend_pid()
                  AND state = 'active'
                  AND wait_event_type = 'Lock'
                  AND query ILIKE '%%accept_bbr_snapshot%%'
                """
            )
            if cur.fetchone()[0]:
                return True
        time.sleep(0.05)
    return False


def _nominations(admin):
    with admin.cursor() as cur:
        cur.execute(
            """
            SELECT id::TEXT, effective_date FROM public.cellar_imports
            WHERE source_type = 'bbr_holdings' AND status = 'accepted'
              AND accepted_role = 'current' AND superseded_at IS NULL
            """
        )
        return cur.fetchall()


def _historical(admin):
    with admin.cursor() as cur:
        cur.execute(
            """
            SELECT id::TEXT, effective_date FROM public.cellar_imports
            WHERE source_type = 'bbr_holdings' AND status = 'accepted'
              AND accepted_role = 'historical'
            """
        )
        return cur.fetchall()


def _assert_chronology_sound(admin):
    nominations = _nominations(admin)
    assert len(nominations) <= 1, (
        f"{len(nominations)} snapshots claim to be the current nomination: "
        f"{nominations}"
    )
    if not nominations:
        return
    nominated_date = nominations[0][1]
    later = [row for row in _historical(admin) if row[1] > nominated_date]
    assert not later, (
        f"historical snapshot(s) {later} are dated after the nominated current "
        f"snapshot of {nominated_date}"
    )


def _race(admin, first, second):
    """Run `second` against `first`'s open transaction, then let both settle.

    `first` is (import_id, date, role) accepted and held uncommitted; `second`
    is the same triple for the contending session. Returns the contender.
    """
    holder = _connect()
    contender = Contender(*second)
    try:
        _prepare_session(holder)
        _accept(holder, *first)

        contender.start()
        assert _wait_until_blocked(admin), (
            "the second acceptance did not wait for the first: acceptance is "
            "not serialised, and both transactions can commit against "
            "different chronologies"
        )
        holder.commit()
    finally:
        if not holder.closed:
            try:
                holder.rollback()
            finally:
                holder.close()

    contender.join(JOIN_TIMEOUT_S)
    assert not contender.is_alive(), "the second acceptance never finished"
    return contender


def _refusal(contender):
    assert contender.error is not None, (
        f"the second acceptance committed instead of being refused: "
        f"{contender.result}"
    )
    return str(contender.error)


def test_two_current_acceptances_for_one_date_leave_one_nomination(chronology):
    """Current versus current: the loser re-reads the date the winner took."""
    first = _stage(chronology, "01")
    second = _stage(chronology, "02")

    contender = _race(
        chronology,
        (first, "2026-06-01", "current"),
        (second, "2026-06-01", "current"),
    )

    assert "an accepted snapshot already describes 2026-06-01" in _refusal(contender)
    assert [row[0] for row in _nominations(chronology)] == [first]
    _assert_chronology_sound(chronology)


def test_historical_cannot_post_date_a_concurrently_accepted_current(chronology):
    """Current versus later-dated historical, with a nomination in place.

    The pre-existing nomination is what the old row lock caught. Waiting on it
    was not enough: the winner supersedes that row, so the waiter woke to find
    no nomination at all and let a later historical snapshot through.
    """
    previous = _stage(chronology, "03")
    current = _stage(chronology, "04")
    historical = _stage(chronology, "05")

    holder = _connect()
    try:
        _prepare_session(holder)
        _accept(holder, previous, "2026-05-01", "current")
        holder.commit()
    finally:
        holder.close()

    contender = _race(
        chronology,
        (current, "2026-06-01", "current"),
        (historical, "2026-06-15", "historical"),
    )

    assert (
        "a historical snapshot cannot post-date the nominated current snapshot "
        "of 2026-06-01" in _refusal(contender)
    )
    assert [row[0] for row in _nominations(chronology)] == [current]
    _assert_chronology_sound(chronology)


def test_historical_waits_for_a_current_acceptance_with_no_nomination(chronology):
    """Historical versus current with nothing accepted yet.

    The case the old row lock could not see at all: FOR UPDATE over an empty
    result locks nothing, so both transactions committed and the historical
    snapshot ended up dated after the nomination.
    """
    current = _stage(chronology, "06")
    historical = _stage(chronology, "07")

    contender = _race(
        chronology,
        (current, "2026-06-01", "current"),
        (historical, "2026-06-15", "historical"),
    )

    assert (
        "a historical snapshot cannot post-date the nominated current snapshot "
        "of 2026-06-01" in _refusal(contender)
    )
    assert [row[0] for row in _nominations(chronology)] == [current]
    _assert_chronology_sound(chronology)


def test_current_waits_for_a_historical_acceptance_with_no_nomination(chronology):
    """The same pair in the other order, where the current declaration loses."""
    historical = _stage(chronology, "08")
    current = _stage(chronology, "09")

    contender = _race(
        chronology,
        (historical, "2026-06-15", "historical"),
        (current, "2026-06-01", "current"),
    )

    assert (
        "a current snapshot cannot pre-date the accepted snapshot for 2026-06-15"
        in _refusal(contender)
    )
    assert _nominations(chronology) == []
    _assert_chronology_sound(chronology)
