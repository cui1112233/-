#!/bin/sh
set -eu

display_number="${XVFB_DISPLAY_NUM:-99}"
log_file="/tmp/qiantie-xvfb-${$}.log"
xvfb_pid=""
node_pid=""

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ -n "$node_pid" ]; then
    kill "$node_pid" 2>/dev/null || true
    wait "$node_pid" 2>/dev/null || true
  fi
  if [ -n "$xvfb_pid" ]; then
    kill "$xvfb_pid" 2>/dev/null || true
    wait "$xvfb_pid" 2>/dev/null || true
  fi
  rm -f "$log_file"
  exit "$status"
}
trap cleanup EXIT INT TERM

while [ "$display_number" -lt 120 ] && [ -e "/tmp/.X${display_number}-lock" ]; do
  display_number=$((display_number + 1))
done
if [ "$display_number" -ge 120 ]; then
  echo "no free Xvfb display available" >&2
  exit 1
fi

display=":${display_number}"
socket="/tmp/.X11-unix/X${display_number}"
Xvfb "$display" -screen 0 1280x1024x24 -nolisten tcp >"$log_file" 2>&1 &
xvfb_pid=$!

ready=0
attempt=0
while [ "$attempt" -lt 100 ]; do
  if [ -e "$socket" ]; then
    ready=1
    break
  fi
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  echo "Xvfb failed to become ready" >&2
  cat "$log_file" >&2 2>/dev/null || true
  exit 1
fi

export DISPLAY="$display"
node src/server.js &
node_pid=$!
wait "$node_pid"
