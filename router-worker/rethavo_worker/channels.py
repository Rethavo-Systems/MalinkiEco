from __future__ import annotations

import json
import logging
from email.utils import formataddr, parseaddr
from typing import Any
from urllib.parse import urlparse

from . import transport as requests
from .templates import email_html


def push_text(value: str, limit: int) -> str:
    encoded = value.encode("utf-8")
    if len(encoded) <= limit:
        return value
    return encoded[: limit - 3].decode("utf-8", "ignore") + "…"


try:
    from pywebpush import WebPushException, webpush
except ImportError:  # pragma: no cover - depends on router runtime
    WebPushException = Exception  # type: ignore[assignment]
    webpush = None


from .config import (
    APP_NAME,
    EMAIL_ENABLED,
    FCM_SEND_URL,
    RESEND_API_KEY,
    RESEND_FROM,
    RESEND_SEND_URL,
    WEB_PUSH_ENABLED,
    WEB_PUSH_VAPID_PRIVATE_KEY,
    WEB_PUSH_VAPID_SUBJECT,
)
from .firebase import firestore_headers
from .recipients import build_app_url, should_send_direct_email


def resend_email(to_email: str, subject: str, body: str, delivery_id: str = "") -> None:
    if not EMAIL_ENABLED:
        raise RuntimeError(
            "Email delivery is disabled: missing RESEND_API_KEY or RESEND_FROM"
        )
    response = requests.post(
        RESEND_SEND_URL,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            **({"Idempotency-Key": delivery_id} if delivery_id else {}),
            "Content-Type": "application/json",
        },
        json={
            "from": formataddr(("Rethavo Systems", parseaddr(RESEND_FROM)[1])),
            "to": [to_email],
            "subject": subject,
            "text": body,
            "html": email_html(subject, body),
        },
        timeout=30,
    )
    response.raise_for_status()


def send_push(
    token: str, title: str, body: str, destination: str, category: str
) -> dict[str, Any]:
    response = requests.post(
        FCM_SEND_URL,
        headers=firestore_headers(),
        json={
            "message": {
                "token": token,
                "data": {
                    "title": push_text(title, 256),
                    "body": push_text(body, 2048),
                    "destination": destination,
                    "category": category,
                },
                "android": {"priority": "high"},
            }
        },
        timeout=30,
    )
    if response.ok:
        return {"ok": True, "invalidToken": False}

    payload = (
        response.json()
        if response.headers.get("Content-Type", "").startswith("application/json")
        else {}
    )
    status = str(payload.get("error", {}).get("status") or "")
    message = str(payload.get("error", {}).get("message") or response.text)
    details = payload.get("error", {}).get("details", [])
    invalid = status in {"NOT_FOUND", "UNREGISTERED"} or any(
        detail.get("errorCode") == "UNREGISTERED"
        for detail in details
        if isinstance(detail, dict)
    )
    logging.warning("FCM delivery failed: status=%s", status or "unknown")
    return {"ok": False, "invalidToken": invalid, "message": message}


def send_web_push(
    subscription: dict[str, Any], title: str, body: str, destination: str, category: str
) -> dict[str, Any]:
    if not WEB_PUSH_ENABLED or webpush is None:
        return {
            "ok": False,
            "invalidSubscription": False,
            "message": "Web push disabled",
        }

    endpoint = str(subscription.get("endpoint") or "").strip()
    p256dh_key = str(subscription.get("p256dhKey") or "").strip()
    auth_key = str(subscription.get("authKey") or "").strip()
    if not endpoint or not p256dh_key or not auth_key:
        return {
            "ok": False,
            "invalidSubscription": True,
            "message": "Missing subscription keys",
        }

    parsed = urlparse(endpoint)
    hosts = (
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
        "wns.windows.com",
    )
    if (
        parsed.scheme != "https"
        or parsed.port not in (None, 443)
        or not any(
            parsed.hostname == host or (parsed.hostname or "").endswith("." + host)
            for host in hosts
        )
    ):
        return {
            "ok": False,
            "invalidSubscription": False,
            "message": "Unknown push provider",
        }

    payload = json.dumps(
        {
            "title": push_text(title, 256),
            "body": push_text(body, 2048),
            "destination": destination,
            "category": category,
            "url": build_app_url(destination),
        },
        ensure_ascii=False,
    )

    try:
        webpush(
            subscription_info={
                "endpoint": endpoint,
                "keys": {
                    "p256dh": p256dh_key,
                    "auth": auth_key,
                },
            },
            data=payload,
            vapid_private_key=WEB_PUSH_VAPID_PRIVATE_KEY,
            vapid_claims={"sub": WEB_PUSH_VAPID_SUBJECT},
            ttl=120,
            timeout=20,
            requests_session=requests.session(),
        )
        return {"ok": True, "invalidSubscription": False}
    except WebPushException as error:
        response = getattr(error, "response", None)
        status_code = int(getattr(response, "status_code", 0) or 0)
        invalid = status_code in {404, 410}
        message = str(error)
        logging.warning(
            "Web push delivery failed: status=%s",
            status_code or "unknown",
        )
        return {"ok": False, "invalidSubscription": invalid, "message": message}


def build_event_email_text(title: str, body: str) -> str:
    return "\n".join(
        [
            "Здравствуйте!",
            "",
            title,
            "",
            body,
            "",
            f"Уведомление {APP_NAME}. Настройки уведомлений доступны в личном кабинете.",
        ]
    )


def build_email_text(job: dict[str, Any], title: str, body: str) -> str:
    if should_send_direct_email(job):
        return body
    return build_event_email_text(title, body)
