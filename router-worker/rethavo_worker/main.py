from __future__ import annotations

import logging
import signal as signals_os
import threading
from logging.handlers import RotatingFileHandler

from .config import (
    APP_NAME,
    EMAIL_ENABLED,
    ENABLE_FCM_PUSH,
    LOG_FORMAT,
    MAIN_LOOP_SLEEP_SECONDS,
    PROJECT_ID,
    WEB_PUSH_ENABLED,
    WORKER_ID,
)
from .jobs import cleanup_finished_jobs
from .lifecycle import progress, stop, stop_event
from .signals import (
    process_due_signals,
    recover_orphan_jobs,
    stream_signal_updates,
)


def main() -> int:
    log = RotatingFileHandler(
        "/tmp/rethavo-worker.log", maxBytes=262144, backupCount=2, encoding="utf-8"
    )
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, handlers=[log])
    signals_os.signal(signals_os.SIGTERM, stop)
    signals_os.signal(signals_os.SIGINT, stop)
    progress()
    logging.info(
        "%s router worker started: worker=%s project=%s",
        APP_NAME,
        WORKER_ID,
        PROJECT_ID,
    )
    logging.info(
        "Notification channels: email=%s web_push=%s fcm=%s",
        "on" if EMAIL_ENABLED else "off",
        "on" if WEB_PUSH_ENABLED else "off",
        "on" if ENABLE_FCM_PUSH else "off",
    )
    if not EMAIL_ENABLED:
        logging.warning(
            "Email delivery disabled: RESEND_API_KEY or RESEND_FROM is missing"
        )
    if not WEB_PUSH_ENABLED:
        logging.warning(
            "Web push disabled: pywebpush or VAPID configuration is missing"
        )

    # Initial network failures must not prevent the main recovery loop.
    try:
        cleanup_finished_jobs(force=True)
    except Exception:
        logging.warning("Startup cleanup deferred")
    recover_orphan_jobs()

    stream_thread = threading.Thread(
        target=stream_signal_updates,
        name="rtdb-signal-stream",
        daemon=True,
    )
    stream_thread.start()

    while not stop_event.is_set():
        progress()
        try:
            recover_orphan_jobs()
            process_due_signals()
            cleanup_finished_jobs()
            stop_event.wait(MAIN_LOOP_SLEEP_SECONDS)
        except KeyboardInterrupt:
            logging.info("Worker stopped manually")
            return 0
        except Exception as error:  # noqa: BLE001
            logging.warning("Main loop retry (%s)", type(error).__name__)
            stop_event.wait(MAIN_LOOP_SLEEP_SECONDS)

    return 0
