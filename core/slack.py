# core/slack.py
# --------------------------------------------------------------
# Simple Slack webhook sender with defensive behaviour.
# --------------------------------------------------------------

import json
import logging
import requests
import os

def send_slack_message(text: str, webhook_url: str | None = None) -> bool:
    """
    Sends a text message to Slack via webhook.
    Returns True if Slack accepted the message.
    Returns False if webhook is missing or Slack rejects.

    Parameters:
        text (str): The message body.
        webhook_url (str | None): Webhook URL. If None, falls back to env var.
    """
    url = webhook_url or os.environ.get("SLACK_WEBHOOK")
    if not url:
        logging.warning("Slack webhook not provided; message not sent.")
        return False

    payload = {"text": text}

    try:
        resp = requests.post(url, data=json.dumps(payload),
                             headers={"Content-Type": "application/json"},
                             timeout=10)
        if resp.status_code == 200:
            return True
        logging.error(f"Slack returned status {resp.status_code}: {resp.text}")
        return False

    except Exception as e:
        logging.error(f"Slack webhook error: {e}")
        return False
