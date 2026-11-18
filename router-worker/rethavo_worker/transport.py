"""One keep-alive connection pool per thread, without unsafe POST retries."""

import json
import os
import threading
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

import requests

from .lifecycle import progress

_local = threading.local()
_lock = threading.Lock()
_counts = Counter()
_cooldowns = {}
_started_at = time.time()
_metrics_path = Path(
    os.environ.get("RETHAVO_HTTP_METRICS", "/tmp/rethavo-worker-http.json")
)


def _record(key):
    if not os.environ.get("RETHAVO_HTTP_METRICS"):
        return
    with _lock:
        _counts[key] += 1
        try:
            temporary = _metrics_path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(
                    {
                        "startedAt": _started_at,
                        "updatedAt": time.time(),
                        "counts": dict(_counts),
                    }
                )
            )
            temporary.replace(_metrics_path)
        except OSError:
            pass  # Diagnostics must never interrupt delivery.


def session():
    if not hasattr(_local, "session"):
        _local.session = requests.Session()
    return _local.session


def request(method, *args, **kwargs):
    if threading.current_thread() is threading.main_thread():
        progress()
    url = str(args[0] if args else kwargs.get("url", ""))
    host = urlparse(url).hostname or "unknown"
    firebase = host == "firestore.googleapis.com" or host.endswith(
        (".firebaseio.com", ".firebasedatabase.app")
    )
    service = (
        "firestore"
        if host == "firestore.googleapis.com"
        else "rtdb"
        if firebase
        else "other"
    )
    if firebase:
        with _lock:
            deferred_until = _cooldowns.get(host, 0)
        if time.monotonic() < deferred_until:
            raise requests.exceptions.RequestException(
                "Firebase requests temporarily deferred after throttling"
            )
    _record(f"{service}.{method.upper()}.attempts")
    response = session().request(method, *args, **kwargs)
    if firebase and response.status_code in {429, 503}:
        try:
            retry_after = float(response.headers.get("Retry-After", "300"))
        except ValueError:
            retry_after = 300
        with _lock:
            _cooldowns[host] = time.monotonic() + min(3600, max(300, retry_after))
        _record(f"{service}.throttled")
    return response


def get(*args, **kwargs):
    return request("GET", *args, **kwargs)


def post(*args, **kwargs):
    return request("POST", *args, **kwargs)


def patch(*args, **kwargs):
    return request("PATCH", *args, **kwargs)


def delete(*args, **kwargs):
    return request("DELETE", *args, **kwargs)
