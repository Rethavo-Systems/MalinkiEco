"""Process-local shutdown and progress signals; runtime state lives in RAM."""

import os
import threading
from pathlib import Path

stop_event = threading.Event()
heartbeat_path = Path(
    os.environ.get("RETHAVO_HEARTBEAT", "/tmp/rethavo-worker.heartbeat")
)


def progress():
    heartbeat_path.touch()


def stop(*_):
    stop_event.set()
