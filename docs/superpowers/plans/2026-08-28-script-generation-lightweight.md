# Script Generation Lightweight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将剧本生成收敛为两次轻量模型调用，并以当前用户确认的 JSON 素材作为后续生成的唯一依据。

**Architecture:** 第一次 `/api/chat` 调用生成规范化人物、场景和风格 JSON；前端允许编辑并保存带版本的素材。第二次调用只发送原文、最新素材、元提示词、星标白名单及时长预设，返回固定标题纯文本；前端按标题切卡并在本地追加后置提示词。重生成携带上一版结果但不覆盖旧版本，历史记录保留素材和输出版本。

**Tech Stack:** Node.js/Express, React, existing `/api/chat`, preset store, history API, Node test runner, Vite build.

## Global Constraints

- JSON 是系统唯一权威数据源；Markdown 仅用于展示、下载、备份和人工审阅。
- 第二次模型请求不得发送质量、限制、负面提示词。
- 分镜输出使用 `### 分镜一` 标题协议，并兼容 `### 分镜 1` 与 `### Shot 1`。
- 生成失败不得覆盖上一版成功结果。
- 10 秒/15 秒规则来自预设库，不由代码拼装复杂时长约束。

### Task 1: Define and normalize the material JSON contract

**Files:**
- Create: `lib/script-generation/material-contract.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Test: `tests/script-material-contract.test.js`

**Interfaces:**
- `normalizeMaterialState(input) -> { characters, scenes, visualStyle, protagonistIds, version }`
- `serializeMaterialState(state) -> string`
- Preserve stable entity IDs, user edits, additions, and `starred`/protagonist flags.

- [ ] Write failing tests for stable IDs, new entities, starred flags, version increments, and invalid JSON rejection.
- [ ] Run `node --test tests/script-material-contract.test.js` and confirm failure.
- [ ] Implement the normalizer and wire existing extraction/edit state through it.
- [ ] Run the focused test and the existing entity-management tests; confirm pass.
- [ ] Commit `feat: add versioned script material contract`.

### Task 2: Reduce chat payload to the two-call generation protocol

**Files:**
- Modify: `frontend/src/shared/api/generation.js`
- Modify: `routes/chat.js`
- Test: `tests/script-generation-payload.test.js`

**Interfaces:**
- `generateScript({ novelText, material, mode, format, duration, metaPrompts, previousOutput })` sends current material JSON and starred IDs.
- `buildScriptMessages(body, ...)` excludes post-processing constraint text and includes previous output only for regeneration.

- [ ] Add failing tests asserting current material is sent, previous output is conditional, and quality/restriction/negative text is absent.
- [ ] Run the focused test and confirm failure.
- [ ] Implement the minimal client/server payload changes while retaining existing auth and preset lookup.
- [ ] Run all `script-constraints*`, `script-protagonist*`, and focused payload tests.
- [ ] Commit `feat: slim script generation chat payload`.

### Task 3: Parse titled output into durable storyboard cards

**Files:**
- Create: `frontend/src/user/pages/scriptShotOutput.js` helpers if parser is not already isolated
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Test: `tests/script-storyboard-card-parser.test.js`

**Interfaces:**
- `parseStoryboardCards(output) -> Array<{ id, title, text, fields, needsReview }>`.
- Recognize Chinese and legacy English numbered headings; preserve unparsed output and mark review instead of dropping it.

- [ ] Write failing tests for Chinese headings, spaced headings, English legacy headings, missing headings, and missing fields.
- [ ] Run focused tests and confirm failure.
- [ ] Implement parser integration for first generation and regeneration.
- [ ] Append quality/restriction/negative prompts after parsing, locally only.
- [ ] Run focused parser, shot-output, and shot-prompt tests.
- [ ] Commit `feat: parse titled script output into cards`.

### Task 4: Persist material/output versions and safe regeneration

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/shared/api/history.js`
- Modify: existing history storage route/store used by `saveHistory`
- Test: `tests/script-material-versioning.test.js`

**Interfaces:**
- History entries store `materialVersion`, `material`, `sourceText`, `output`, and `previousOutputId` where applicable.
- Failed regeneration leaves the current successful output and history pointer unchanged.

- [ ] Add failing tests for edit → version increment → regenerate with latest material, rollback after failure, and Markdown export/import boundaries.
- [ ] Run focused tests and confirm failure.
- [ ] Implement persistence and non-destructive regeneration.
- [ ] Verify existing draft/history persistence tests and run the full script test suite.
- [ ] Commit `feat: persist script material and output versions`.

### Task 5: Preset-based duration and end-to-end verification

**Files:**
- Modify: script preset catalog/seed files where 10s and 15s rules are defined
- Test: `tests/script-duration-preset-contract.test.js`
- Test: `tests/script-generation-e2e-contract.test.js`

**Interfaces:**
- Duration selection resolves exactly one published 10s or 15s preset.
- End-to-end contract verifies two model calls, latest JSON material, card splitting, post-processing-only constraints, and preserved history on regeneration failure.

- [ ] Add failing preset and end-to-end contract tests.
- [ ] Run them and confirm failure.
- [ ] Add or correct the two duration presets and wire selection without code-side duration prompt assembly.
- [ ] Run focused tests, `npm --prefix frontend run build`, and the complete Node test suite.
- [ ] Commit `test: verify lightweight script generation flow`.

