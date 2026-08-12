#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
PID_FILE="${QIANTIE_PID_FILE:-$ROOT/.qiantie-backend.pid}"
LOG_FILE="${QIANTIE_LOG_FILE:-$ROOT/.qiantie-backend.log}"

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
print -r -- "$!" >"$PID_FILE"
