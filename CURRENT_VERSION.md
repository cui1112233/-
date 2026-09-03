# V88 Current Version

- Branch: `v88`
- Status: integration branch, not production/default
- Base source: `master@fc1f5a96364518f0f14073fd5195363ef0e15a77`
- Batch Factory source candidate: `d9c3a164053473c55704fa0ba904041366564b61`
- Integration policy: preserve all base website functions; selectively overlay only verified feature/runtime source; do not merge historical candidate branch history wholesale.
- Production: unchanged
- Default branch: unchanged

## Included in the V88 consolidation line

- Go Batch Factory V11 backend and MySQL/storage/runtime support
- Local-executor server integration required by Batch Factory V11 video production
- Maintained desktop local executor source under `local-executor/`
- Doubao live-page Video-tab compatibility: AI Creation can discover/click ARIA `role="tab"` controls before VIDEO prompt entry
- Shared Yizhan branding asset used by the web favicon and Windows executor packaging
- Batch Factory V11 frontend workbench subtree
- Batch Factory V11 browser API client
- Node-to-Go runtime wiring required for V11 APIs
- V88 local-executor regression workflow

## Explicitly preserved from master base

All unrelated website routes and source files remain from the exact base commit unless they are selectively brought into V88 as verified consolidation work, including Novel Fetch, Script, Agent, account/member/team, TTS, Shuihuo production, pet, settings and other existing website functions.

## Development rule

New feature development and bug fixes must target the V88 lineage. Older V78/release/feature branches are reference sources only and must not receive new maintained fixes.

## Promotion rule

Do not switch production or the GitHub default branch to `v88` until V88 verification is complete and the user explicitly approves promotion.
