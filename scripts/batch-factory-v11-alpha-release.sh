#!/usr/bin/env bash
set -euo pipefail
if [[ " ${*:-} " != *" --dry-run "* ]]; then
  echo "This workline does not deploy :3000. Use --dry-run here and release from the approved deployment workflow." >&2
  exit 2
fi
node -e 'console.log(JSON.stringify({ok:true,mode:"dry-run",note:"validation-only; no deployment performed"}))'
