from __future__ import annotations

from typing import Any
from urllib.parse import quote

from .config import (
    APP_BASE_URL,
    USER_COLLECTION,
    USER_DEVICES_CACHE_TTL_SECONDS,
    USER_DEVICES_COLLECTION,
    USERS_CACHE_TTL_SECONDS,
    WEB_PUSH_SUBSCRIPTIONS_CACHE_TTL_SECONDS,
    WEB_PUSH_SUBSCRIPTIONS_COLLECTION,
)
from .firebase import get_cached_collection_documents


def normalize_email(value: str) -> str:
    email = str(value or "").strip().lower()
    return email if "@" in email else ""


def notification_preference_key(category: str, destination: str) -> str:
    normalized_category = str(category or "").strip().lower()
    normalized_destination = str(destination or "").strip().lower()

    if normalized_category in {"requests", "request"}:
        return "requests"
    if normalized_category in {"mention", "mentions"}:
        return "mentions"
    if normalized_category in {"chat"} or normalized_destination == "chat":
        return "chat"
    if normalized_category in {"polls"} or normalized_destination == "polls":
        return "polls"
    if normalized_category in {"payments"} or normalized_destination == "payments":
        return "payments"
    if (
        normalized_category in {"registration", "verification", "system"}
        or normalized_destination == "auth"
    ):
        return "system"
    return "events"


def allows_notification(user: dict[str, Any] | None, preference_key: str) -> bool:
    if not user:
        return False
    settings = user.get("notificationSettings")
    if not isinstance(settings, dict):
        return True
    value = settings.get(preference_key)
    if value is None:
        return True
    return bool(value)


def users_by_id() -> dict[str, dict[str, Any]]:
    users = get_cached_collection_documents(USER_COLLECTION, USERS_CACHE_TTL_SECONDS)
    return {
        str(user.get("id") or "").strip(): user
        for user in users
        if str(user.get("id") or "").strip()
    }


def collect_tokens(
    audience: str,
    target_user_ids: list[str],
    excluded_user_ids: list[str],
    category: str,
    destination: str,
) -> list[dict[str, Any]]:
    target_set = set(target_user_ids)
    exclude_set = set(excluded_user_ids)
    preference_key = notification_preference_key(category, destination)
    user_map = users_by_id()
    devices = get_cached_collection_documents(
        USER_DEVICES_COLLECTION, USER_DEVICES_CACHE_TTL_SECONDS
    )
    result: list[dict[str, Any]] = []
    for device in devices:
        token = str(device.get("token") or "").strip()
        user_id = str(device.get("userId") or "").strip()
        if not token or not user_id:
            continue
        if user_id in exclude_set:
            continue
        if audience == "broadcast":
            if user_id in exclude_set:
                continue
        elif user_id not in target_set:
            continue
        if not allows_notification(user_map.get(user_id), preference_key):
            continue
        result.append(device)
    return result


def collect_web_push_subscriptions(
    audience: str,
    target_user_ids: list[str],
    excluded_user_ids: list[str],
    category: str,
    destination: str,
) -> list[dict[str, Any]]:
    target_set = set(target_user_ids)
    exclude_set = set(excluded_user_ids)
    preference_key = notification_preference_key(category, destination)
    user_map = users_by_id()
    subscriptions = get_cached_collection_documents(
        WEB_PUSH_SUBSCRIPTIONS_COLLECTION,
        WEB_PUSH_SUBSCRIPTIONS_CACHE_TTL_SECONDS,
    )
    result: list[dict[str, Any]] = []
    for subscription in subscriptions:
        user_id = str(subscription.get("userId") or "").strip()
        endpoint = str(subscription.get("endpoint") or "").strip()
        p256dh_key = str(subscription.get("p256dhKey") or "").strip()
        auth_key = str(subscription.get("authKey") or "").strip()
        if not user_id or not endpoint or not p256dh_key or not auth_key:
            continue
        if user_id in exclude_set:
            continue
        if audience == "broadcast":
            if user_id in exclude_set:
                continue
        elif user_id not in target_set:
            continue
        if not allows_notification(user_map.get(user_id), preference_key):
            continue
        result.append(subscription)
    return result


def collect_recipient_emails(
    audience: str,
    target_user_ids: list[str],
    excluded_user_ids: list[str],
    category: str,
    destination: str,
) -> list[str]:
    target_set = set(target_user_ids)
    exclude_set = set(excluded_user_ids)
    preference_key = notification_preference_key(category, destination)
    users = get_cached_collection_documents(USER_COLLECTION, USERS_CACHE_TTL_SECONDS)
    result: list[str] = []
    for user in users:
        user_id = str(user.get("id") or "").strip()
        if user_id in exclude_set:
            continue
        if audience == "broadcast":
            if user_id in exclude_set:
                continue
        elif user_id not in target_set:
            continue
        if not allows_notification(user, preference_key):
            continue
        email = normalize_email(user.get("email") or user.get("authEmail") or "")
        if email:
            result.append(email)
    return sorted(set(result))


def build_app_url(destination: str) -> str:
    base = APP_BASE_URL or "https://malinkieco.rethavo.ru/"
    if "?" in base:
        separator = "&"
    else:
        separator = "?"
    tab = destination.strip() or "events"
    return f"{base}{separator}openTab={quote(tab, safe='')}"


def direct_email_targets(job: dict[str, Any]) -> list[str]:
    return sorted(
        {
            normalize_email(item)
            for item in job.get("emailTargets") or []
            if normalize_email(item)
        }
    )


def should_send_event_email(job: dict[str, Any]) -> bool:
    return (
        str(job.get("audience") or "") == "broadcast"
        and str(job.get("destination") or "events") == "events"
        and str(job.get("category") or "events") == "events"
        and bool(job.get("sendEmail", True))
    )


def should_send_direct_email(job: dict[str, Any]) -> bool:
    return bool(job.get("sendEmail", False)) and len(direct_email_targets(job)) > 0
