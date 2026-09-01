#!/usr/bin/env bash
set -euo pipefail
manifest="${1:-}"
[[ -n "$manifest" && -f "$manifest" ]] || { echo "manifest path required" >&2; exit 2; }
node - "$manifest" <<'NODE'
const fs=require('fs'); const {renderRollback}=require('../lib/batch-factory-v11/release-contract');
const manifest=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); console.log(renderRollback(manifest));
NODE
