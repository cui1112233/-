#!/usr/bin/env bash
set -Eeuo pipefail

echo 'Retired: V88 public traffic cannot be cut over to a host-stage process.' >&2
echo 'Use scripts/deploy-v88-public-unified.sh with paired immutable Node and Go images.' >&2
exit 64
