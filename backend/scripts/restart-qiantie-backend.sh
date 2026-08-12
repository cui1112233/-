#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
PID_FILE="${QIANTIE_PID_FILE:-$ROOT/.qiantie-backend.pid}"
LOG_FILE="${QIANTIE_LOG_FILE:-$ROOT/.qiantie-backend.log}"
ADDR="${QIANTIE_ADDR:-127.0.0.1:4000}"

if [[ "$ADDR" != *:* ]]; then
  print -u2 -- "QIANTIE_ADDR must use host:port form"
  exit 1
fi

HOST="${ADDR%:*}"
PORT="${ADDR##*:}"

if [[ -z "$HOST" || "$PORT" != <-> || "$PORT" -lt 1 || "$PORT" -gt 65535 ]]; then
  print -u2 -- "QIANTIE_ADDR must use a valid host:port form"
  exit 1
fi

if lsof -nP -iTCP@"$HOST":"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  print -u2 -- "qiantie backend address $ADDR already has a listener; refusing to start another process"
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  pid="$(<"$PID_FILE")"
  if [[ "$pid" == <-> ]] && ps -p "$pid" >/dev/null 2>&1; then
    print -u2 -- "qiantie backend PID $pid is already running; stop it manually before starting another process"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

umask 077
nohup "$ROOT/scripts/run-qiantie-backend.sh" >>"$LOG_FILE" 2>&1 < /dev/null &
child_pid=$!
print -r -- "$child_pid" >"$PID_FILE"

for _ in {1..100}; do
  if curl --fail --silent --show-error --max-time 1 "http://$HOST:$PORT/healthz" >/dev/null 2>&1; then
    exit 0
  fi
  if ! kill -0 "$child_pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    print -u2 -- "qiantie backend exited before becoming healthy; see $LOG_FILE"
    exit 1
  fi
  sleep 0.1
done

rm -f "$PID_FILE"
print -u2 -- "qiantie backend did not become healthy within 10 seconds; see $LOG_FILE"
exit 1
