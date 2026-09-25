# Batch Assets and Smart Unified Single-Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One asset-stage text-model request persists both assets and the optional smart-unified visual baseline.

**Architecture:** Node makes the single structured model call and sends parsed assets plus an optional baseline through the signed V11 bridge. Go remains the persistence authority. Invalid baseline data cannot fail a valid asset extraction.

## Task 1: Combined response contract

- [ ] Add a failing Node test that a response containing `assets` and `smart_unified_analysis` is parsed into independent asset and baseline values.
- [ ] Run `node --test routes/batch-factory-v11.test.js --test-name-pattern='combined asset'` and confirm RED.
- [ ] Add `parseCombinedAssetAnalysis(content, preset)` to validate assets and reuse existing smart-unified parsing.
- [ ] Re-run the focused test and commit `feat(batch): parse combined asset and style analysis`.

## Task 2: One-call asset execution

- [ ] Add a failing stage test with smart unified enabled that asserts exactly one model request and persistence of both outputs.
- [ ] Replace the separate asset request plus `refreshSmartUnifiedNonBlocking` call with one structured request.
- [ ] Accept an optional `smartUnifiedStyle` in the asset-stage bridge request; persist valid data and return a non-blocking reason for absent or invalid data.
- [ ] Run Node and Go focused tests and commit `feat(batch): combine asset extraction and visual baseline`.

## Task 3: UI state and release

- [ ] Add a frontend source test for “视觉基线未获取，不影响资产提取”.
- [ ] Replace the inaccurate “只能重新生成导演分镜” pending instruction with combined-stage status; retain explicit standalone refresh.
- [ ] Run focused tests and `cd frontend && npm run build`.
- [ ] Commit generated frontend output, push `v88`, verify `git merge-base --is-ancestor HEAD origin/v88`, then release that exact SHA and verify its runtime label.
