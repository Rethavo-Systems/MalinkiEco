#!/opt/bin/python3
"""Compatible entry point for the existing Entware installation."""

if __name__ == "__main__":
    import fcntl
    import logging
    import os
    import sys
    from logging.handlers import RotatingFileHandler

    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(levelname)s %(message)s",
        handlers=[
            RotatingFileHandler(
                "/tmp/rethavo-worker.log",
                maxBytes=262144,
                backupCount=2,
                encoding="utf-8",
            )
        ],
    )
    lock = open("/tmp/rethavo-worker.lock", "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("Worker is already running")
    try:
        os.environ["RETHAVO_HTTP_METRICS"] = "/tmp/rethavo-worker-http.json"
        from rethavo_worker.main import main

        raise SystemExit(main())
    except Exception as error:
        logging.error("Fatal startup/runtime failure (%s)", type(error).__name__)
        sys.exit(1)
