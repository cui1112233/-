#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="${1:-}"
sha="${2:-}"

if [ -z "$release_dir" ] || [ -z "$sha" ]; then
  echo "usage: prepare-release.sh <release_dir> <sha>" >&2
  exit 2
fi

case "$release_dir" in
  */current|*/current/*)
    echo "refusing to prepare a release inside current" >&2
    exit 3
    ;;
esac

mkdir -p "$release_dir"
printf '%s\n' "$sha" > "$release_dir/RELEASE-SHA"
