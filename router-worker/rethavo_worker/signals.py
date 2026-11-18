from __future__ import annotations

import json
import logging
import random
import threading
import time
from typing import Any

from . import transport as requests
from .config import (
    FIRESTORE_FALLBACK_SCAN_INTERVAL_SECONDS,
    JOB_COLLECTION,
    MAX_JOBS_PER_CYCLE,
    SIGNAL_PATH,
    STREAM_RECONNECT_DELAY_SECONDS,
)
from .firebase import (
    get_document,
    now_ms,
    rtdb_delete,
    rtdb_headers,
    rtdb_patch,
    rtdb_url,
    run_collection_query,
    status_in_filter,
)
from .jobs import mark_job, process_job
from .lifecycle import stop_event

last_firestore_fallback_scan_ms = 0
next_firestore_scan_monotonic = 0.0

signal_lock = threading.Lock()

inflight_signals: set[str] = set()

signal_state: dict[str, dict[str, Any]] = {}


def add_or_update_signal(signal_key: str, signal_data: dict[str, Any]) -> None:
    if not isinstance(signal_data, dict):
        return
    current = signal_state.get(signal_key, {})
    current.update(signal_data)
    signal_state[signal_key] = current


def handle_stream_event(payload: dict[str, Any], event_type: str = "put") -> None:
    path = str(payload.get("path") or "/").strip("/")
    data = payload.get("data")
    with signal_lock:
        if not path and event_type == "put":
            synthetic = {
                k: v for k, v in signal_state.items() if k.startswith("firestore:")
            }
            signal_state.clear()
            signal_state.update(synthetic)
            if isinstance(data, dict):
                signal_state.update(
                    {str(k): dict(v) for k, v in data.items() if isinstance(v, dict)}
                )
            return
        updates = (
            data.items() if not path and isinstance(data, dict) else [(path, data)]
        )
        for key, value in updates:
            parts = str(key).split("/")
            signal_key = parts[0]
            if not signal_key:
                continue
            if len(parts) == 1:
                if value is None:
                    signal_state.pop(signal_key, None)
                elif isinstance(value, dict):
                    if event_type == "put":
                        signal_state[signal_key] = dict(value)
                    else:
                        add_or_update_signal(signal_key, value)
            else:
                current = signal_state.setdefault(signal_key, {})
                for part in parts[1:-1]:
                    current = current.setdefault(part, {})
                if value is None:
                    current.pop(parts[-1], None)
                else:
                    current[parts[-1]] = value


def stream_signal_updates() -> None:
    failures = 0
    while not stop_event.is_set():
        connected_at = time.monotonic()
        try:
            with requests.get(
                rtdb_url(SIGNAL_PATH),
                headers=rtdb_headers(stream=True),
                stream=True,
                timeout=(10, 75),
            ) as response:
                response.raise_for_status()
                event_type = ""
                data_lines: list[str] = []

                for raw_line in response.iter_lines(chunk_size=1, decode_unicode=True):
                    if stop_event.is_set():
                        return
                    if raw_line is None:
                        continue

                    line = str(raw_line)
                    if not line:
                        if event_type in {"put", "patch"} and data_lines:
                            try:
                                handle_stream_event(
                                    json.loads("\n".join(data_lines)), event_type
                                )
                            except Exception as error:  # noqa: BLE001
                                logging.exception(
                                    "Failed to handle RTDB event: %s", error
                                )
                        if event_type in {"cancel", "auth_revoked"}:
                            raise RuntimeError("RTDB stream authorization ended")
                        event_type = ""
                        data_lines = []
                        continue

                    if line.startswith("event:"):
                        event_type = line.split(":", 1)[1].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line.split(":", 1)[1].lstrip())
        except Exception as error:  # noqa: BLE001
            logging.warning("RTDB stream disconnected (%s)", type(error).__name__)
        failures = 0 if time.monotonic() - connected_at > 60 else failures + 1
        stop_event.wait(
            min(120, STREAM_RECONNECT_DELAY_SECONDS * 2 ** min(failures, 5))
            + random.uniform(0, 2)
        )


def acquire_due_signals() -> list[tuple[str, dict[str, Any]]]:
    current_time = now_ms()
    due: list[tuple[str, dict[str, Any]]] = []
    with signal_lock:
        for signal_key, signal_data in signal_state.items():
            if signal_key in inflight_signals:
                continue
            try:
                due_at_client = int(
                    signal_data.get("dueAtClient")
                    or signal_data.get("createdAtClient")
                    or 0
                )
            except (TypeError, ValueError):
                due_at_client = 0
            if due_at_client > current_time:
                continue
            inflight_signals.add(signal_key)
            due.append((signal_key, dict(signal_data)))
            if len(due) >= MAX_JOBS_PER_CYCLE:
                break
    return due


def release_signal(signal_key: str) -> None:
    with signal_lock:
        inflight_signals.discard(signal_key)


def process_due_signals() -> None:
    batch = acquire_due_signals()
    try:
        for signal_key, signal in batch:
            if stop_event.is_set():
                break
            try:
                process_signal(signal_key, signal)
            except Exception as error:
                logging.warning("Signal processing deferred (%s)", type(error).__name__)
                # A failed read/ack must not monopolize the queue or hammer Firebase.
                with signal_lock:
                    if signal_key in signal_state:
                        signal_state[signal_key]["dueAtClient"] = now_ms() + 30_000
    finally:
        for signal_key, _ in batch:
            release_signal(signal_key)


def remove_signal(signal_key: str) -> None:
    if not signal_key.startswith("firestore:"):
        rtdb_delete(f"{SIGNAL_PATH}/{signal_key}")
    with signal_lock:
        signal_state.pop(signal_key, None)
        inflight_signals.discard(signal_key)


def reschedule_signal(
    signal_key: str, due_at_client: int, last_error: str = ""
) -> None:
    rtdb_patch(
        f"{SIGNAL_PATH}/{signal_key}",
        {
            "dueAtClient": due_at_client,
            "lastError": last_error,
            "updatedAtClient": now_ms(),
        },
    )
    with signal_lock:
        current = signal_state.get(signal_key, {})
        current.update(
            {
                "dueAtClient": due_at_client,
                "lastError": last_error,
                "updatedAtClient": now_ms(),
            }
        )
        signal_state[signal_key] = current


def recover_orphan_jobs() -> None:
    global last_firestore_fallback_scan_ms, next_firestore_scan_monotonic

    current_time = now_ms()
    current_monotonic = time.monotonic()
    if current_monotonic < next_firestore_scan_monotonic:
        return

    # Throttle attempts too: a failed query previously retried every main-loop tick.
    next_firestore_scan_monotonic = (
        current_monotonic + FIRESTORE_FALLBACK_SCAN_INTERVAL_SECONDS
    )
    try:
        jobs = run_collection_query(
            JOB_COLLECTION,
            filters=[status_in_filter("PENDING", "RETRY", "PROCESSING")],
            limit=200,
        )
        last_firestore_fallback_scan_ms = current_time
        if not jobs:
            return

        with signal_lock:
            for job in jobs:
                signal_key = f"firestore:{job['id']}"
                if signal_key in signal_state:
                    continue
                signal_state[signal_key] = {
                    "jobId": job["id"],
                    "creatorId": str(job.get("createdById") or ""),
                    "createdAtClient": int(job.get("createdAtClient") or current_time),
                    "dueAtClient": int(job.get("nextAttemptAtClient") or current_time),
                    "synthetic": True,
                }
        logging.info("Recovered %s orphaned Firestore jobs into local queue", len(jobs))
    except Exception as error:  # noqa: BLE001
        logging.exception("Failed to recover orphan Firestore jobs: %s", error)


def process_signal(signal_key: str, signal: dict[str, Any]) -> None:
    job_id = str(signal.get("jobId") or "").strip()
    if not job_id:
        remove_signal(signal_key)
        return

    job = get_document(JOB_COLLECTION, job_id)
    if not job:
        remove_signal(signal_key)
        return

    status = str(job.get("status") or "PENDING").strip().upper()
    if status == "PROCESSING":
        recover_at = int(job.get("processingStartedAtClient") or 0) + 900_000
        if now_ms() < recover_at:
            with signal_lock:
                signal_state.setdefault(signal_key, dict(signal))["dueAtClient"] = (
                    recover_at
                )
            return
    elif status not in {"PENDING", "RETRY"}:
        remove_signal(signal_key)
        return

    due_at_client = int(
        job.get("nextAttemptAtClient") or signal.get("dueAtClient") or 0
    )
    if due_at_client > now_ms():
        with signal_lock:
            signal_state.setdefault(signal_key, dict(signal))["dueAtClient"] = (
                due_at_client
            )
        if int(signal.get("dueAtClient") or 0) != due_at_client and not str(
            signal_key
        ).startswith("firestore:"):
            reschedule_signal(signal_key, due_at_client)
        return

    logging.info("Processing job=%s", job.get("id"))
    try:
        process_job(job)
    except Exception as error:  # noqa: BLE001
        logging.warning("Job %s failed (%s)", job_id, type(error).__name__)
        attempts = int(job.get("attempts") or 0) + 1
        delay_ms = min(300_000, 15_000 * max(1, attempts))
        next_due_at_client = now_ms() + delay_ms
        mark_job(
            str(job["_document_name"]),
            status="FAILED" if attempts >= 8 else "RETRY",
            attempts=attempts,
            nextAttemptAtClient=next_due_at_client,
            lastError=type(error).__name__,
        )
        if attempts >= 8:
            remove_signal(signal_key)
            return
        if str(signal_key).startswith("firestore:"):
            with signal_lock:
                current = signal_state.get(signal_key, {})
                current.update(
                    {
                        "dueAtClient": next_due_at_client,
                        "lastError": type(error).__name__,
                    }
                )
                signal_state[signal_key] = current
        else:
            reschedule_signal(signal_key, next_due_at_client, type(error).__name__)
        return

    # A failed RTDB acknowledgement must not turn a completed job back into RETRY.
    remove_signal(signal_key)
