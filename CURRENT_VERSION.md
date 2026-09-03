# V88 Current Version

- Branch: `v88`
- Status: integration branch, not production/default
- Base source: `master@fc1f5a96364518f0f14073fd5195363ef0e15a77`
- Batch Factory source candidate: `d9c3a164053473c55704fa0ba904041366564b61`
- Integration policy: preserve all base website functions; selectively overlay only Batch Factory V11 and required runtime wiring; do not merge the candidate branch history wholesale.
- Production: unchanged
- Default branch: unchanged

## Included from the Batch Factory candidate

- Go Batch Factory V11 backend and MySQL/storage/runtime support
- Local-executor integration required by Batch Factory V11 video production
- Batch Factory V11 frontend workbench subtree
- Batch Factory V11 browser API client
- Node-to-Go runtime wiring required for V11 APIs
- Batch Factory V11 verification workflows

## Explicitly preserved from master base

All unrelated website routes and source files remain from the exact base commit, including Novel Fetch, Script, Agent, account/member/team, TTS, Shuihuo production, pet, settings and other existing website functions.

## Promotion rule

Do not switch production or the GitHub default branch to `v88` until V88 verification is complete and the user explicitly approves promotion.
