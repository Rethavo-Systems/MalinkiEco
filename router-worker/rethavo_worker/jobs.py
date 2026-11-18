from __future__ import annotations

import hashlib
import logging
from typing import Any

from .channels import build_email_text, resend_email, send_push, send_web_push
from .config import (
    APP_GATE_CACHE_TTL_SECONDS,
    CLEANUP_INTERVAL_SECONDS,
    DELETE_DONE_JOBS,
    DONE_JOB_TTL_SECONDS,
    ENABLE_FCM_PUSH,
    FAILED_JOB_TTL_SECONDS,
    JOB_COLLECTION,
    MAINTENANCE_ALLOWED_ROLES,
    USER_COLLECTION,
    USERS_CACHE_TTL_SECONDS,
    WORKER_ID,
)
from .firebase import (
    delete_auth_user,
    delete_document,
    delete_web_push_subscriptions_for_user,
    get_cached_collection_documents,
    get_cached_document,
    get_document,
    invalidate_collection_cache,
    now_ms,
    patch_document,
    run_collection_query,
)
from .lifecycle import progress, stop_event
from .recipients import (
    collect_recipient_emails,
    collect_tokens,
    collect_web_push_subscriptions,
    direct_email_targets,
    normalize_email,
    should_send_direct_email,
    should_send_event_email,
)

last_cleanup_at_ms = 0


def get_app_gate() -> dict[str, Any]:
    return (
        get_cached_document("app_settings", "app_gate", APP_GATE_CACHE_TTL_SECONDS)
        or {}
    )


def is_maintenance_enabled() -> bool:
    gate = get_app_gate()
    return bool(gate.get("maintenanceEnabled") or gate.get("errorEnabled"))


def get_maintenance_allowed_users() -> list[dict[str, Any]]:
    allowed_users: list[dict[str, Any]] = []
    for user in get_cached_collection_documents(
        USER_COLLECTION, USERS_CACHE_TTL_SECONDS
    ):
        role = str(user.get("role") or "").strip().upper()
        if role in MAINTENANCE_ALLOWED_ROLES:
            allowed_users.append(user)
    return allowed_users


def get_maintenance_allowed_user_ids() -> set[str]:
    return {
        str(user.get("id") or "").strip()
        for user in get_maintenance_allowed_users()
        if str(user.get("id") or "").strip()
    }


def filter_email_targets_for_maintenance(email_targets: list[str]) -> list[str]:
    allowed_emails = {
        normalize_email(user.get("email") or user.get("authEmail") or "")
        for user in get_maintenance_allowed_users()
        if normalize_email(user.get("email") or user.get("authEmail") or "")
    }
    return sorted({email for email in email_targets if email in allowed_emails})


def cleanup_finished_jobs(force: bool = False) -> None:
    global last_cleanup_at_ms

    current_time = now_ms()
    if (
        not force
        and current_time - last_cleanup_at_ms < CLEANUP_INTERVAL_SECONDS * 1000
    ):
        return

    last_cleanup_at_ms = current_time
    jobs: list[dict[str, Any]] = []
    for status in ("DONE", "FAILED"):
        jobs.extend(
            run_collection_query(
                JOB_COLLECTION,
                filters=[
                    {
                        "fieldFilter": {
                            "field": {"fieldPath": "status"},
                            "op": "EQUAL",
                            "value": {"stringValue": status},
                        }
                    }
                ],
                limit=200,
            )
        )
    cleaned = 0

    for job in jobs:
        status = str(job.get("status") or "").strip().upper()
        document_name = str(job.get("_document_name") or "").strip()
        if not document_name:
            continue

        job_timestamp = int(
            job.get("processedAtClient")
            or job.get("updatedAtClient")
            or job.get("createdAtClient")
            or 0
        )
        age_ms = max(0, current_time - job_timestamp)

        should_delete_done = (
            status == "DONE"
            and DELETE_DONE_JOBS
            and age_ms >= max(0, DONE_JOB_TTL_SECONDS) * 1000
        )
        should_delete_failed = (
            status == "FAILED"
            and FAILED_JOB_TTL_SECONDS >= 0
            and age_ms >= FAILED_JOB_TTL_SECONDS * 1000
        )

        if not should_delete_done and not should_delete_failed:
            continue

        try:
            delete_document(document_name)
            cleaned += 1
        except Exception as error:  # noqa: BLE001
            logging.exception(
                "Failed to clean up finished job %s: %s", job.get("id"), error
            )

    if cleaned > 0:
        logging.info("Cleaned up %s finished jobs", cleaned)


def mark_job(document_name: str, **fields: Any) -> None:
    payload = {
        **fields,
        "updatedAtClient": now_ms(),
    }
    patch_document(document_name, payload)


def process_job(job: dict[str, Any]) -> None:
    title = str(job.get("title") or "").strip()
    body = str(job.get("body") or "").strip()
    audience = str(job.get("audience") or "").strip() or "broadcast"
    destination = str(job.get("destination") or "events").strip() or "events"
    category = str(job.get("category") or destination).strip() or "events"
    target_user_ids = [
        str(item).strip()
        for item in job.get("targetUserIds") or []
        if str(item).strip()
    ]
    excluded_user_ids = [
        str(item).strip()
        for item in job.get("excludedUserIds") or []
        if str(item).strip()
    ]
    attempts = int(job.get("attempts") or 0) + 1
    document_name = str(job["_document_name"])
    delivered_keys = set(job.get("deliveryReceipts") or [])

    def receipt(kind, recipient):
        return hashlib.sha256((kind + ":" + recipient).encode()).hexdigest()

    def checkpoint(key):
        delivered_keys.add(key)
        mark_job(
            document_name,
            deliveryReceipts=sorted(delivered_keys),
            processingStartedAtClient=now_ms(),
        )
        progress()

    event_email_enabled = should_send_event_email(job)
    auth_delete_user_id = str(job.get("authDeleteUserId") or "").strip()
    cleanup_web_push_user_id = str(job.get("cleanupWebPushUserId") or "").strip()

    if not title or not body:
        mark_job(
            document_name,
            status="FAILED",
            attempts=attempts,
            lastError="Missing title/body",
        )
        return

    if auth_delete_user_id or cleanup_web_push_user_id:
        actor = get_document(USER_COLLECTION, str(job.get("createdById") or ""))
        if not actor or actor.get("role") not in {"ADMIN", "MODERATOR"}:
            mark_job(
                document_name, status="FAILED", lastError="Unauthorized account cleanup"
            )
            return

    maintenance_enabled = is_maintenance_enabled()
    maintenance_filtered = False
    if maintenance_enabled:
        allowed_user_ids = get_maintenance_allowed_user_ids()
        maintenance_filtered = True
        if audience == "broadcast":
            audience = "users"
            target_user_ids = sorted(allowed_user_ids)
            target_user_ids = [
                uid for uid in target_user_ids if uid not in excluded_user_ids
            ]
        else:
            target_user_ids = [
                user_id for user_id in target_user_ids if user_id in allowed_user_ids
            ]
            excluded_user_ids = [
                user_id for user_id in excluded_user_ids if user_id in allowed_user_ids
            ]

    mark_job(
        document_name,
        status="PROCESSING",
        attempts=attempts,
        processingWorker=WORKER_ID,
        processingStartedAtClient=now_ms(),
    )

    send_push_enabled = bool(job.get("sendPush", True))
    emailed = 0
    email_failed = 0
    auth_deleted = 0
    auth_already_missing = 0
    web_push_cleanup_removed = 0

    if auth_delete_user_id:
        auth_result = delete_auth_user(auth_delete_user_id)
        auth_deleted = 1 if auth_result.get("deleted") else 0
        auth_already_missing = 1 if auth_result.get("alreadyMissing") else 0

    if cleanup_web_push_user_id:
        web_push_cleanup_removed = delete_web_push_subscriptions_for_user(
            cleanup_web_push_user_id
        )

    if auth_delete_user_id or cleanup_web_push_user_id:
        invalidate_collection_cache(USER_COLLECTION)

    recipient_emails: list[str] = []
    if should_send_direct_email(job):
        recipient_emails.extend(direct_email_targets(job))
    elif event_email_enabled:
        recipient_emails.extend(
            collect_recipient_emails(
                audience,
                target_user_ids,
                excluded_user_ids,
                category,
                destination,
            )
        )
    if maintenance_filtered:
        recipient_emails = filter_email_targets_for_maintenance(recipient_emails)

    if recipient_emails:
        email_body = build_email_text(job, title, body)
        for email in sorted(set(recipient_emails)):
            progress()
            if stop_event.is_set():
                raise InterruptedError("Shutdown requested")
            key = receipt("email", email)
            if key in delivered_keys:
                continue
            try:
                resend_email(
                    email,
                    title,
                    email_body,
                    delivery_id=hashlib.sha256(
                        (document_name + key).encode()
                    ).hexdigest(),
                )
                checkpoint(key)
                emailed += 1
            except Exception as error:  # noqa: BLE001
                email_failed += 1
                logging.warning("Email delivery failed (%s)", type(error).__name__)

    delivered = 0
    push_failed = 0
    invalid_tokens_removed = 0
    web_push_delivered = 0
    web_push_failed = 0
    invalid_web_subscriptions_removed = 0

    if send_push_enabled and ENABLE_FCM_PUSH:
        tokens = collect_tokens(
            audience, target_user_ids, excluded_user_ids, category, destination
        )
        for device in tokens:
            token = str(device.get("token") or "").strip()
            if not token:
                continue
            progress()
            if stop_event.is_set():
                raise InterruptedError("Shutdown requested")
            key = receipt("fcm", token)
            if key in delivered_keys:
                continue
            try:
                result = send_push(token, title, body, destination, category)
            except Exception as error:
                push_failed += 1
                logging.warning("FCM delivery failed (%s)", type(error).__name__)
                continue
            if result["ok"]:
                delivered += 1
                checkpoint(key)
                continue
            push_failed += 1
            if result.get("invalidToken"):
                invalid_tokens_removed += 1
                try:
                    delete_document(str(device["_document_name"]))
                except Exception as error:  # noqa: BLE001
                    logging.exception(
                        "Failed to delete invalid token doc %s: %s",
                        device.get("id"),
                        error,
                    )

    if send_push_enabled:
        web_push_subscriptions = collect_web_push_subscriptions(
            audience,
            target_user_ids,
            excluded_user_ids,
            category,
            destination,
        )
        for subscription in web_push_subscriptions:
            progress()
            if stop_event.is_set():
                raise InterruptedError("Shutdown requested")
            key = receipt("web", str(subscription.get("endpoint")))
            if key in delivered_keys:
                continue
            try:
                result = send_web_push(subscription, title, body, destination, category)
            except Exception as error:
                push_failed += 1
                web_push_failed += 1
                logging.warning("Web push delivery failed (%s)", type(error).__name__)
                continue
            if result["ok"]:
                delivered += 1
                web_push_delivered += 1
                checkpoint(key)
                continue
            web_push_failed += 1
            push_failed += 1
            if result.get("invalidSubscription"):
                invalid_web_subscriptions_removed += 1
                try:
                    delete_document(str(subscription["_document_name"]))
                except Exception as error:  # noqa: BLE001
                    logging.exception(
                        "Failed to delete invalid web push subscription %s: %s",
                        subscription.get("id"),
                        error,
                    )

    if (
        email_failed
        or push_failed > invalid_tokens_removed + invalid_web_subscriptions_removed
    ):
        raise RuntimeError("Some deliveries failed; successful deliveries checkpointed")

    completion_fields = {
        "authDeleted": auth_deleted,
        "authAlreadyMissing": auth_already_missing,
        "webPushCleanupRemoved": web_push_cleanup_removed,
        "status": "DONE",
        "delivered": delivered,
        "pushFailed": push_failed,
        "webPushDelivered": web_push_delivered,
        "webPushFailed": web_push_failed,
        "emailed": emailed,
        "emailFailed": email_failed,
        "invalidTokensRemoved": invalid_tokens_removed,
        "invalidWebSubscriptionsRemoved": invalid_web_subscriptions_removed,
        "processedAtClient": now_ms(),
        "lastError": "Delivered only to maintenance-allowed roles"
        if maintenance_filtered
        else "",
    }

    # Persist terminal state before removing the document: a failed deletion must never resend.
    mark_job(document_name, **completion_fields)
    if DELETE_DONE_JOBS and DONE_JOB_TTL_SECONDS <= 0:
        try:
            delete_document(document_name)
            return
        except Exception as error:  # noqa: BLE001
            logging.exception(
                "Failed to delete completed job %s immediately: %s",
                job.get("id"),
                error,
            )
