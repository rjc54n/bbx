# core/notification_state.py
# --------------------------------------------------------------
# Persistent state and deduplication logic for the BBX arbitrage bot.
#
# Responsibilities:
#   - Load and save a simple JSON state keyed by SKU.
#   - Decide which candidates are "new or improved" vs "previously notified".
#
# Deduplication rules:
#   - If SKU has never been notified: notify.
#   - If current ask < last_notified ask: notify (improved).
#   - If current ask == last_notified ask and last notification is older
#     than `reminder_days`: notify (time-based reminder).
#   - Otherwise: suppress.
#
# Storage backends:
#   - In GitHub Actions: S3 object, using env vars S3_BUCKET and S3_STATE_KEY.
#   - Locally (CLI dev): JSON file at the Path passed in.
# --------------------------------------------------------------

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Tuple, Any

StateDict = Dict[str, Dict[str, Any]]

# boto3 is required in CI but the local CLI can run without S3 configuration.
try:
    import boto3  # type: ignore
except ImportError:
    boto3 = None  # type: ignore


def _now_utc() -> datetime:
    """Return current time in UTC as an aware datetime."""
    return datetime.now(timezone.utc)


def _to_iso_z(dt: datetime) -> str:
    """
    Convert a datetime to an ISO 8601 string with 'Z' suffix, e.g. 2025-11-23T08:10:00Z.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso_z(ts: str) -> datetime:
    """
    Parse an ISO 8601 string produced by _to_iso_z back into an aware datetime.
    """
    if not ts:
        raise ValueError("Empty timestamp string")
    if ts.endswith("Z"):
        ts = ts[:-1]
    # Result is naive; treat as UTC
    return datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)


# --------------------------------------------------------------
# Backend selection helpers
# --------------------------------------------------------------

def _get_s3_config():
    """
    Return (bucket, key, region) if S3 is configured via env vars,
    otherwise (None, None, None).
    """
    bucket = os.environ.get("S3_BUCKET")
    key = os.environ.get("S3_STATE_KEY")
    region = os.environ.get("AWS_REGION")
    if bucket and key:
        return bucket, key, region
    return None, None, None


def _load_state_from_s3(bucket: str, key: str, region: str | None) -> StateDict:
    """
    Load notification state from S3. Returns {} if the object is missing
    or if any error occurs.
    """
    if boto3 is None:
        logging.error(
            "boto3 is not available but S3_BUCKET/S3_STATE_KEY are set. "
            "Falling back to empty state."
        )
        return {}

    try:
        client_kwargs = {}
        if region:
            client_kwargs["region_name"] = region
        s3 = boto3.client("s3", **client_kwargs)  # type: ignore[arg-type]

        logging.info(f"Loading notification state from s3://{bucket}/{key}")
        resp = s3.get_object(Bucket=bucket, Key=key)
        body = resp["Body"].read().decode("utf-8")
        data = json.loads(body)
        if not isinstance(data, dict):
            raise ValueError("State file in S3 must contain a JSON object at top level.")
        return data  # type: ignore[return-value]
    except Exception as e:
        logging.info(
            f"No existing or readable notification state in S3 "
            f"(bucket={bucket}, key={key}): {e}. Starting fresh."
        )
        return {}


def _save_state_to_s3(bucket: str, key: str, region: str | None, state: StateDict) -> None:
    """
    Save notification state to S3. Errors are logged but not raised.
    """
    if boto3 is None:
        logging.error(
            "boto3 is not available but S3_BUCKET/S3_STATE_KEY are set. "
            "Cannot save state to S3."
        )
        return

    try:
        client_kwargs = {}
        if region:
            client_kwargs["region_name"] = region
        s3 = boto3.client("s3", **client_kwargs)  # type: ignore[arg-type]

        body = json.dumps(state, indent=2, sort_keys=True).encode("utf-8")
        s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
        )
        logging.info(f"Notification state saved to s3://{bucket}/{key}")
    except Exception as e:
        logging.error(f"Failed to save notification state to S3: {e}")


# --------------------------------------------------------------
# Public load / save interface
# --------------------------------------------------------------

def load_notification_state(path: Path) -> StateDict:
    """
    Load notification state from S3 if configured, otherwise from a local JSON file.

    S3 mode is enabled when both S3_BUCKET and S3_STATE_KEY are present in env.
    Local mode is used otherwise.
    """
    bucket, key, region = _get_s3_config()
    if bucket and key:
        return _load_state_from_s3(bucket, key, region)

    # Local JSON file mode (CLI and local development)
    if not path.exists():
        logging.info(f"No existing notification state at {path}, starting fresh.")
        return {}

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("State file must contain a JSON object at top level.")
        return data  # type: ignore[return-value]
    except Exception as e:
        logging.warning(f"Failed to load notification state from {path}: {e}")
        return {}


def save_notification_state(path: Path, state: StateDict) -> None:
    """
    Save notification state to S3 if configured, otherwise to a local JSON file.

    Errors are logged but do not raise, to avoid breaking the arbitrage run.
    """
    bucket, key, region = _get_s3_config()
    if bucket and key:
        _save_state_to_s3(bucket, key, region, state)
        return

    # Local JSON file mode
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, sort_keys=True)
        tmp_path.replace(path)
        logging.info(f"Notification state saved to {path}")
    except Exception as e:
        logging.error(f"Failed to save notification state to {path}: {e}")


# --------------------------------------------------------------
# Deduplication logic
# --------------------------------------------------------------

def filter_new_or_improved(
    candidates: List[Dict[str, Any]],
    state: StateDict,
    reminder_days: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], StateDict]:
    """
    Apply deduplication rules to a list of arbitrage candidates.

    Parameters
    ----------
    candidates : list[dict]
        Output from run_arbitrage() – each dict must contain at least:
        - 'sku' (string)
        - 'ask' (numeric)
    state : dict
        Notification state, keyed by SKU.
    reminder_days : int
        Number of days after which we will re-notify even if the ask is unchanged.

    Returns
    -------
    notified : list[dict]
        Candidates that should be included in the Slack message and persisted to state.
    suppressed : list[dict]
        Candidates that have been seen before and do not meet re-notification rules.
    new_state : dict
        Updated state dictionary reflecting any new or re-notified candidates.
    """
    now = _now_utc()
    now_str = _to_iso_z(now)

    notified: List[Dict[str, Any]] = []
    suppressed: List[Dict[str, Any]] = []
    new_state: StateDict = dict(state)  # shallow copy is fine

    for c in candidates:
        sku = c.get("sku")
        ask = c.get("ask")

        # If SKU or ask is missing, be conservative and treat as new.
        if not sku or ask is None:
            notified.append(c)
            continue

        try:
            ask_val = float(ask)
        except Exception:
            # Malformed ask – treat as new so we at least see it.
            notified.append(c)
            continue

        record = new_state.get(sku)

        # Case 1: never notified before -> notify
        if record is None:
            new_state[sku] = {
                "sku": sku,
                "ask_last_notified": ask_val,
                "first_notified_at": now_str,
                "last_notified_at": now_str,
                "notification_count": 1,
            }
            notified.append(c)
            continue

        # Existing record – decide whether to re-notify
        old_ask = record.get("ask_last_notified")
        last_notified_at = record.get("last_notified_at")

        # If stored data is incomplete, treat like first-time and reset.
        if old_ask is None or last_notified_at is None:
            new_state[sku] = {
                "sku": sku,
                "ask_last_notified": ask_val,
                "first_notified_at": record.get("first_notified_at", now_str),
                "last_notified_at": now_str,
                "notification_count": int(record.get("notification_count", 0)) + 1,
            }
            notified.append(c)
            continue

        try:
            old_ask_val = float(old_ask)
        except Exception:
            old_ask_val = ask_val  # fall back

        try:
            last_dt = _parse_iso_z(last_notified_at)
        except Exception:
            last_dt = now

        # Rule: improvement in ask -> notify
        if ask_val < old_ask_val:
            record["ask_last_notified"] = ask_val
            record["last_notified_at"] = now_str
            record["notification_count"] = int(record.get("notification_count", 0)) + 1
            notified.append(c)
            continue

        # Rule: same ask, reminder after N days -> notify
        if ask_val == old_ask_val:
            delta_days = (now - last_dt).total_seconds() / 86400.0
            if delta_days >= reminder_days:
                record["last_notified_at"] = now_str
                record["notification_count"] = int(record.get("notification_count", 0)) + 1
                notified.append(c)
            else:
                suppressed.append(c)
            continue

        # Rule: ask increased or otherwise worse -> suppress
        suppressed.append(c)

    return notified, suppressed, new_state
