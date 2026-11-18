#!/opt/bin/python3
"""Single-instance supervisor with bounded restart delay and hang detection."""

import ctypes
import fcntl
import json
import logging
import os
import signal
import subprocess
import sys
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

BASE = Path(__file__).resolve().parent
STATE = Path(os.environ.get("RETHAVO_STATE_DIR", "/tmp"))
STATE.mkdir(parents=True, exist_ok=True)
PID = STATE / "rethavo-worker-supervisor.pid"
HEARTBEAT = STATE / "rethavo-worker.heartbeat"
STATUS = STATE / "rethavo-worker-status.json"
STALL_SECONDS = max(2, int(os.environ.get("RETHAVO_STALL_SECONDS", "300")))
DISABLED = BASE / ".stopped"
stopping = False
child = None


def child_setup():
    # Linux/Entware: terminate the child if the supervisor is killed unexpectedly.
    parent = os.getppid()
    if parent == 1:
        os._exit(1)
    if ctypes.CDLL(None).prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        os._exit(1)
    if os.getppid() != parent:
        os._exit(1)


def stop(*_):
    global stopping
    stopping = True
    if child and child.poll() is None:
        child.terminate()


def terminate_child():
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=35)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


def main():
    global child
    lock = open(STATE / "rethavo-worker-supervisor.lock", "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return 0
    PID.write_text(str(os.getpid()))
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(levelname)s %(message)s",
        handlers=[
            RotatingFileHandler(
                STATE / "rethavo-supervisor.log", maxBytes=65536, backupCount=1
            )
        ],
    )
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    delay = 2
    restarts = 0
    logging.info("Supervisor started pid=%s", os.getpid())
    try:
        while not stopping and not DISABLED.exists():
            HEARTBEAT.touch()
            started = time.monotonic()
            child = subprocess.Popen(
                [sys.executable, str(BASE / "router_worker.py")],
                cwd=BASE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                preexec_fn=child_setup,
                env={**os.environ, "RETHAVO_HEARTBEAT": str(HEARTBEAT)},
            )
            logging.info("Worker started pid=%s restart=%s", child.pid, restarts)
            STATUS.write_text(
                json.dumps(
                    {
                        "supervisorPid": os.getpid(),
                        "workerPid": child.pid,
                        "restarts": restarts,
                        "startedAt": time.time(),
                    }
                )
            )
            heartbeat_seen = HEARTBEAT.stat().st_mtime_ns
            last_progress = time.monotonic()
            while child.poll() is None and not stopping and not DISABLED.exists():
                # Worker updates heartbeat at loop and delivery checkpoints, not in a timer thread.
                current_heartbeat = HEARTBEAT.stat().st_mtime_ns
                if current_heartbeat != heartbeat_seen:
                    heartbeat_seen = current_heartbeat
                    last_progress = time.monotonic()
                if time.monotonic() - last_progress > STALL_SECONDS:
                    logging.warning("Worker stalled; restarting")
                    terminate_child()
                    break
                time.sleep(2)
            terminate_child()
            logging.info("Worker exited code=%s", child.returncode)
            restarts += 1
            if time.monotonic() - started > 300:
                delay = 2
            until = time.monotonic() + delay
            while not stopping and not DISABLED.exists() and time.monotonic() < until:
                time.sleep(1)
            delay = min(120, delay * 2)
    finally:
        terminate_child()
        PID.unlink(missing_ok=True)
        STATUS.unlink(missing_ok=True)
        lock.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
