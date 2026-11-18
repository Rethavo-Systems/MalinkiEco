from __future__ import annotations

import os
from pathlib import Path

from google.oauth2 import service_account

try:
    from pywebpush import WebPushException, webpush
except ImportError:  # pragma: no cover - depends on router runtime
    WebPushException = Exception  # type: ignore[assignment]
    webpush = None


SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/firebase.database",
    "https://www.googleapis.com/auth/firebase.messaging",
    "https://www.googleapis.com/auth/userinfo.email",
]

LOG_FORMAT = "[%(asctime)s] %(levelname)s %(message)s"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file(
    Path(
        os.environ.get(
            "RETHAVO_ENV",
            str(Path(__file__).resolve().parent.parent / "router_worker.env"),
        )
    )
)


def get_env(name: str, default: str = "", required: bool = False) -> str:
    value = str(os.environ.get(name, default)).strip()
    if required and not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def get_env_bool(name: str, default: str = "false") -> bool:
    return get_env(name, default).lower() not in {"", "0", "false", "no", "off"}


PROJECT_ID = get_env("FIREBASE_PROJECT_ID", required=True)

SERVICE_ACCOUNT_PATH = get_env("FIREBASE_SERVICE_ACCOUNT_JSON_PATH", required=True)

RTDB_URL = get_env(
    "RTDB_URL", "https://malinkiecodb-default-rtdb.firebaseio.com/"
).rstrip("/")

RESEND_API_KEY = get_env("RESEND_API_KEY")

RESEND_FROM = get_env("RESEND_FROM")

APP_NAME = get_env("APP_NAME", "Rethavo Systems")

WORKER_ID = get_env("WORKER_ID", "keenetic-router")

JOB_COLLECTION = get_env("JOB_COLLECTION", "notification_jobs")

USER_COLLECTION = get_env("USER_COLLECTION", "users")

USER_DEVICES_COLLECTION = get_env("USER_DEVICES_COLLECTION", "user_devices")

WEB_PUSH_SUBSCRIPTIONS_COLLECTION = get_env(
    "WEB_PUSH_SUBSCRIPTIONS_COLLECTION", "web_push_subscriptions"
)

SIGNAL_PATH = (
    get_env("SIGNAL_PATH", "notification_signals").strip("/") or "notification_signals"
)

MAX_JOBS_PER_CYCLE = int(get_env("MAX_JOBS_PER_CYCLE", "10") or "10")

DELETE_DONE_JOBS = get_env_bool("DELETE_DONE_JOBS", "true")

DONE_JOB_TTL_SECONDS = int(get_env("DONE_JOB_TTL_SECONDS", "0") or "0")

FAILED_JOB_TTL_SECONDS = int(get_env("FAILED_JOB_TTL_SECONDS", "86400") or "86400")

CLEANUP_INTERVAL_SECONDS = int(get_env("CLEANUP_INTERVAL_SECONDS", "21600") or "21600")

USERS_CACHE_TTL_SECONDS = int(get_env("USERS_CACHE_TTL_SECONDS", "300") or "300")

USER_DEVICES_CACHE_TTL_SECONDS = int(
    get_env("USER_DEVICES_CACHE_TTL_SECONDS", "120") or "120"
)

STREAM_RECONNECT_DELAY_SECONDS = int(
    get_env("STREAM_RECONNECT_DELAY_SECONDS", "5") or "5"
)

MAIN_LOOP_SLEEP_SECONDS = max(1, int(get_env("MAIN_LOOP_SLEEP_SECONDS", "1") or "1"))

FIRESTORE_FALLBACK_SCAN_INTERVAL_SECONDS = min(
    86400,
    max(
        300, int(get_env("FIRESTORE_FALLBACK_SCAN_INTERVAL_SECONDS", "1800") or "1800")
    ),
)

WEB_PUSH_SUBSCRIPTIONS_CACHE_TTL_SECONDS = int(
    get_env("WEB_PUSH_SUBSCRIPTIONS_CACHE_TTL_SECONDS", "120") or "120"
)

ENABLE_FCM_PUSH = get_env_bool("ENABLE_FCM_PUSH", "false")

WEB_PUSH_VAPID_PRIVATE_KEY = get_env("WEB_PUSH_VAPID_PRIVATE_KEY")

WEB_PUSH_VAPID_SUBJECT = get_env("WEB_PUSH_VAPID_SUBJECT", "mailto:info@rethavo.ru")

APP_BASE_URL = get_env("APP_BASE_URL", "https://malinkieco.rethavo.ru/").strip()

APP_GATE_CACHE_TTL_SECONDS = int(get_env("APP_GATE_CACHE_TTL_SECONDS", "30") or "30")

MAINTENANCE_ALLOWED_ROLES = {"ADMIN", "TESTER"}

FIRESTORE_BASE_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents"

FCM_SEND_URL = f"https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send"

RESEND_SEND_URL = "https://api.resend.com/emails"

IDENTITY_TOOLKIT_DELETE_URL = (
    f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT_ID}/accounts:delete"
)

EMAIL_ENABLED = bool(RESEND_API_KEY and RESEND_FROM)

WEB_PUSH_ENABLED = bool(
    webpush and WEB_PUSH_VAPID_PRIVATE_KEY and WEB_PUSH_VAPID_SUBJECT
)

credentials = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_PATH,
    scopes=SCOPES,
)
