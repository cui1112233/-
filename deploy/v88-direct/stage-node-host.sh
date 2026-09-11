#!/usr/bin/env bash
set -Eeuo pipefail

echo 'Retired: V88 public releases must use the unified Docker Compose runner.' >&2
echo 'Use scripts/deploy-v88-public-unified.sh with paired immutable Node and Go images.' >&2
exit 64
