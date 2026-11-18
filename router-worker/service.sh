#!/opt/bin/sh
set -eu
BASE=/opt/rethavo-systems-router
PIDFILE=/tmp/rethavo-worker-supervisor.pid
alive() {
  [ -r "$PIDFILE" ] || return 1
  pid=$(cat "$PIDFILE")
  case "$pid" in ''|*[!0-9]*) return 1;; esac
  [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\000' ' ' < "/proc/$pid/cmdline" | grep -F "$BASE/supervisor.py" >/dev/null
}
start() {
  [ ! -f "$BASE/.stopped" ] || return 0
  alive && return 0
  /opt/bin/python3 "$BASE/supervisor.py" >/dev/null 2>&1 &
}
stop() {
  touch "$BASE/.stopped"
  if alive; then
    kill "$pid"
    count=0
    while alive && [ "$count" -lt 45 ]; do sleep 1; count=$((count + 1)); done
    if alive; then echo 'Supervisor did not stop; inspect before restarting'; return 1; fi
  fi
}
case "${1:-status}" in
  start) rm -f "$BASE/.stopped"; start;;
  ensure) start;;
  stop) stop;;
  restart) stop; rm -f "$BASE/.stopped"; start;;
  status|check) if alive; then echo 'Supervisor running'; else echo 'Stopped'; exit 1; fi;;
  *) echo 'Usage: start|stop|restart|status|ensure'; exit 2;;
esac
