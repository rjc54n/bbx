"""Check publication age even when the sweep trigger is outside its window."""
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.db import get_connection, is_postgres

MAX_PUBLICATION_AGE = timedelta(hours=60)


def publication_age_error(published_at, now):
    if published_at is None:
        return "No verified catalogue publication on record"
    if isinstance(published_at, str):
        published_at = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    if now - published_at > MAX_PUBLICATION_AGE:
        return f"Catalogue publication is over 60 hours old (last published {published_at.isoformat()})"
    return None


def main():
    if not is_postgres():
        logging.error("DATABASE_URL is required for the publication health check")
        return 1
    now = datetime.now(timezone.utc)
    if 2 <= now.hour < 5:
        print("Publication age check deferred until after the backup window")
        return 0
    with get_connection() as conn:
        cur = conn.cursor()
        try:
            cur.execute("SET LOCAL statement_timeout = '5s'")
            cur.execute(
                "SELECT max(published_at) AS published_at FROM scan_runs "
                "WHERE scope = 'biddable_full_book'"
            )
            error = publication_age_error(dict(cur.fetchone())["published_at"], now)
        finally:
            cur.close()
    if error:
        logging.error("%s. Inspect the latest sweep and recover publication or run a due sweep.", error)
        return 1
    print("Latest catalogue publication is within 60 hours")
    return 0


if __name__ == "__main__":
    sys.exit(main())
