# Match Audio and Smart Unified Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the quick-director entry to “匹配音频”, optionally match the generated audio duration while preserving 10s/15s unit rules, and move automatic unified style into the “智能统一” image-prefix constraint preset.

**Architecture:** Keep the existing quick-director API and preset IDs for compatibility, but add explicit audio-total and constraint payload fields. Put shared semantic decisions in small testable helpers; the backend builds dynamic prompt rules, while the frontend reads audio metadata and assembles final cards from the selected constraint. The existing 10s/15s duration selector remains the per-unit rule and is never replaced by the audio total.

**Tech Stack:** Node.js built-in test runner, Express route helpers, React 18, Ant Design, Vite.

**Spec:** `docs/superpowers/specs/2026-09-04-match-audio-smart-unified.md`

## Global Constraints

- Audio matching is optional and must fail closed when no current generated audio duration exists.
- Audio target seconds use the generated audio duration rounded up to an integer.
- The selected `10s` or `15s` value remains the independent storyboard-unit rule.
- “智能统一” is the only automatic path that injects analyzed visual style into `【画面前缀】`.
- Final output must not contain an independent `统一风格：` field.
- Preserve the existing user-owned untracked file `public/batch-rewrite/v78-novel-fetch-v2.test.cjs`.

---

### Task 1: Add backend prompt rules and the Smart Unified system preset

**Files:**
- Create: `lib/script-generation-rules.js`
- Modify: `lib/system-preset-catalog.js`
- Modify: `routes/chat.js`
- Modify: `prompts/快速导演分镜.md`
- Test: `tests/script-generation-prompt-rules.test.js`

**Interfaces:**
- `lib/script-generation-rules.js` produces `SMART_UNIFIED_PREFIX_PRESET_ID`, `isSmartUnifiedPrefixEnabled(constraints)`, `normalizeAudioTargetSeconds(value)`, and `buildAudioMatchRules({ audioTotalSeconds, duration })`.
- `routes/chat.js` consumes those helpers and passes `constraints`, `audioTotalSeconds`, and the username/personal-prompt store into the quick-director prompt path.
- `lib/system-preset-catalog.js` publishes `script-constraint-prefix-smart-unified` in the existing `prefix` constraint category.

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_PRESETS } = require('../lib/system-preset-catalog');
const {
  SMART_UNIFIED_PREFIX_PRESET_ID,
  isSmartUnifiedPrefixEnabled,
  normalizeAudioTargetSeconds,
  buildAudioMatchRules
} = require('../lib/script-generation-rules');

test('smart unified is enabled only by the prefix system preset', () => {
  assert.equal(isSmartUnifiedPrefixEnabled({ prefix: { enabled: true, presetId: SMART_UNIFIED_PREFIX_PRESET_ID } }), true);
  assert.equal(isSmartUnifiedPrefixEnabled({ prefix: { enabled: true, presetId: 'script-constraint-prefix-live-action' } }), false);
  assert.equal(isSmartUnifiedPrefixEnabled({ prefix: { enabled: false, presetId: SMART_UNIFIED_PREFIX_PRESET_ID } }), false);
});

test('audio target rounds up a valid duration and rejects invalid values', () => {
  assert.equal(normalizeAudioTargetSeconds(28.01), 29);
  assert.equal(normalizeAudioTargetSeconds('28'), 28);
  assert.equal(normalizeAudioTargetSeconds(0), null);
  assert.equal(normalizeAudioTargetSeconds('bad'), null);
});

test('audio match rules keep the selected 10s or 15s unit rule', () => {
  const ten = buildAudioMatchRules({ audioTotalSeconds: 28, duration: '10s' });
  assert.match(ten, /总时长必须精确等于 28 秒/);
  assert.match(ten, /每个独立分镜单元不超过 10 秒/);
  assert.match(ten, /10s 模式无最低时长/);

  const fifteen = buildAudioMatchRules({ audioTotalSeconds: 28, duration: '15s' });
  assert.match(fifteen, /每个独立分镜单元原则上大于 10 秒且不超过 15 秒/);
  assert.match(fifteen, /空间切换和最终收尾可以短于 10 秒/);
});

test('system catalog contains the Smart Unified image-prefix preset and backend prompt', () => {
  const preset = SYSTEM_PRESETS.find(item => item.id === SMART_UNIFIED_PREFIX_PRESET_ID);
  assert.ok(preset);
  assert.equal(preset.name, '智能统一');
  assert.deepEqual(preset.protocolLock, { format: 'constraint', category: 'prefix', slot: 'script.constraint.prefix' });
  assert.match(preset.body, /不要在最终分镜中单独输出“统一风格”标题/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/script-generation-prompt-rules.test.js`

Expected: FAIL because `lib/script-generation-rules.js` and the new catalog preset do not exist yet.

- [ ] **Step 3: Write the minimal backend implementation**

Implement `normalizeAudioTargetSeconds` as `Math.ceil(Number(value))` for values in `1..600`, return `null` otherwise. Build the audio prompt with the exact total, the selected unit limit, the 10s/15s minimum rule, spatial boundary priority, and no-padding instruction. Add the Smart Unified preset body to `SCRIPT_CONSTRAINT_PRESETS`, map its ID to `script.constraint.prefix`, and update the quick-director prompt source to use shot-only output without a standalone unified-style field.

In `routes/chat.js`:

```js
const {
  SMART_UNIFIED_PREFIX_PRESET_ID,
  isSmartUnifiedPrefixEnabled,
  buildAudioMatchRules
} = require('../lib/script-generation-rules');
```

Use `isSmartUnifiedPrefixEnabled` in `buildConstraintWrapper`. Change quick-director prompt construction to accept personal prompt context, call `buildConstraintWrapper(..., 'shotlist', ...)`, and append `buildAudioMatchRules` only when `body.matchAudio === true` and `body.audioTotalSeconds` is valid.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/script-generation-prompt-rules.test.js`

Expected: PASS with all focused backend prompt tests green.

### Task 2: Add tested frontend audio/style decision helpers

**Files:**
- Create: `frontend/src/user/pages/scriptGenerationRules.js`
- Test: `tests/script-generation-rules-frontend.test.mjs`

**Interfaces:**
- `SMART_UNIFIED_PREFIX_PRESET_ID` is the frontend copy of the stable backend preset ID.
- `shouldInjectSmartUnifiedStyle(constraints)` returns a boolean.
- `normalizeAudioDurationSeconds(value)` returns a positive integer ceiling or `null`.
- `readAudioDurationFromUrl(url, { AudioCtor })` resolves the normalized duration from media metadata and rejects invalid metadata.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMART_UNIFIED_PREFIX_PRESET_ID,
  shouldInjectSmartUnifiedStyle,
  normalizeAudioDurationSeconds,
  readAudioDurationFromUrl
} from '../frontend/src/user/pages/scriptGenerationRules.js';

test('frontend Smart Unified decision follows the prefix switch and preset', () => {
  assert.equal(shouldInjectSmartUnifiedStyle({ prefix: { enabled: true, presetId: SMART_UNIFIED_PREFIX_PRESET_ID } }), true);
  assert.equal(shouldInjectSmartUnifiedStyle({ prefix: { enabled: true, presetId: 'other' } }), false);
  assert.equal(shouldInjectSmartUnifiedStyle({ prefix: { enabled: false, presetId: SMART_UNIFIED_PREFIX_PRESET_ID } }), false);
});

test('frontend audio duration is represented as an integer ceiling', () => {
  assert.equal(normalizeAudioDurationSeconds(28.01), 29);
  assert.equal(normalizeAudioDurationSeconds('28'), 28);
  assert.equal(normalizeAudioDurationSeconds(-1), null);
});

test('frontend reads audio metadata and releases the temporary media handlers', async () => {
  class FakeAudio {
    duration = 28.01;
    load() { queueMicrotask(() => this.onloadedmetadata()); }
  }
  assert.equal(await readAudioDurationFromUrl('blob:audio', { AudioCtor: FakeAudio }), 29);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/script-generation-rules-frontend.test.mjs`

Expected: FAIL because `frontend/src/user/pages/scriptGenerationRules.js` does not exist yet.

- [ ] **Step 3: Write the minimal frontend helper implementation**

Create the ESM helper with the stable preset ID, strict prefix check, integer duration normalization, and a metadata promise that calls `onloadedmetadata`/`onerror`, settles once, and clears handlers in both paths.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/script-generation-rules-frontend.test.mjs`

Expected: PASS.

### Task 3: Wire “匹配音频” into the React page and API payload

**Files:**
- Modify: `frontend/src/shared/api/generation.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Test: `tests/script-match-audio-ui-contract.test.js`

**Interfaces:**
- `generateQuickDirectorStoryboard` accepts `matchAudio`, `audioTotalSeconds`, and `constraints` and sends all three fields.
- `ScriptPage` stores `sourceAudioDurationSeconds` and `quickDirectorOptions.matchAudio`.
- The modal and toolbar use “匹配音频”; enabled generation requires a current generated audio duration.

- [ ] **Step 1: Write the failing UI/API contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('frontend/src/user/pages/ScriptPage.jsx', 'utf8');
const api = fs.readFileSync('frontend/src/shared/api/generation.js', 'utf8');

test('script page exposes the match-audio toggle and removes the old user-facing name', () => {
  assert.match(page, /title="匹配音频"/);
  assert.match(page, /title="匹配音频"[\s\S]*?disabled=\{quickDirecting\}/);
  assert.match(page, /title="匹配音频"[\s\S]*?<Switch/);
  assert.doesNotMatch(page, /title="快速导演分镜"/);
});

test('quick director API carries audio matching and selected constraints', () => {
  assert.match(api, /matchAudio/);
  assert.match(api, /audioTotalSeconds/);
  assert.match(api, /constraints/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/script-match-audio-ui-contract.test.js`

Expected: FAIL because the current page still uses “快速导演分镜” and the API omits the new payload fields.

- [ ] **Step 3: Write the minimal React/API implementation**

Import `readAudioDurationFromUrl` and `normalizeAudioDurationSeconds`. Add `sourceAudioDurationSeconds` state and initialize `quickDirectorOptions` with `matchAudio: false`. After `narrateSource` creates the audio URL, read its metadata and save the integer seconds; keep the audio preview if metadata reading fails but show a warning. Clear the duration when the source text changes or the audio URL is replaced.

Rename the toolbar icon, modal title, status messages, and task notifications. Add a modal switch explaining that audio total is exact while `10s/15s` remains the per-unit rule, show the current audio seconds, and block the action when enabled without audio. Pass `constraintsForFormat(constraints, 'shotlist', extraction)`, `matchAudio`, and `audioTotalSeconds` into `generateQuickDirectorStoryboard`; save the same request constraints into `outputConstraints` and history. Preserve quick-director internal IDs for compatibility.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/script-match-audio-ui-contract.test.js`

Expected: PASS.

### Task 4: Make final cards show Smart Unified only as a prefix

**Files:**
- Modify: `frontend/src/user/pages/scriptFinalSegment.js`
- Test: `tests/script-final-segment-contract.test.js`

**Interfaces:**
- Final card assembly uses `shouldInjectSmartUnifiedStyle(constraints)` before adding `extractInfo.visualStyle`.
- Manual prefix presets and personal/draft prefix text continue to render normally.
- No final-card assembly path emits a standalone `统一风格：` line.

- [ ] **Step 1: Write the failing contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('frontend/src/user/pages/scriptFinalSegment.js', 'utf8');

test('final segment delegates analyzed style to the Smart Unified selection', () => {
  assert.match(source, /shouldInjectSmartUnifiedStyle/);
  assert.doesNotMatch(source, /constraints\?\.prefix\?\.enabled === true \? text\(visualStyle\)/);
  assert.doesNotMatch(source, /统一风格：/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/script-final-segment-contract.test.js`

Expected: FAIL because the current final-card builder injects visual style whenever prefix is enabled and still contains the legacy standalone style path elsewhere in the file.

- [ ] **Step 3: Write the minimal final-card implementation**

Import `shouldInjectSmartUnifiedStyle` and replace the unconditional visual-style condition in `buildConstraintParts`. Keep the selected prefix body unchanged, so the Smart Unified preset body and runtime analyzed style appear together under `【画面前缀】`. Remove only the independent style output from this React final-card path.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/script-final-segment-contract.test.js`

Expected: PASS.

### Task 5: Full verification and handoff

**Files:**
- Verify: `lib/script-generation-rules.js`, `lib/system-preset-catalog.js`, `routes/chat.js`, `prompts/快速导演分镜.md`, `frontend/src/shared/api/generation.js`, `frontend/src/user/pages/ScriptPage.jsx`, `frontend/src/user/pages/scriptGenerationRules.js`, `frontend/src/user/pages/scriptFinalSegment.js`

- [ ] **Step 1: Run all new focused tests**

Run: `node --test tests/script-generation-prompt-rules.test.js tests/script-generation-rules-frontend.test.mjs tests/script-match-audio-ui-contract.test.js tests/script-final-segment-contract.test.js`

Expected: all new tests pass.

- [ ] **Step 2: Run syntax checks for changed Node files**

Run: `node --check lib/script-generation-rules.js; node --check lib/system-preset-catalog.js; node --check routes/chat.js`

Expected: exit code 0 for each file.

- [ ] **Step 3: Run the frontend build when dependencies are available**

Run: `npm --prefix frontend run build`

Expected: Vite exits 0. If dependencies are unavailable, report that limitation separately without changing unrelated dependency state.

- [ ] **Step 4: Run the complete Node regression suite**

Run: `node --test`

Expected: all unrelated baseline failures are recorded separately; the new focused tests remain green.

- [ ] **Step 5: Review the diff and report the exact user-visible changes**

Run: `git diff --check; git status --short`

Expected: no whitespace errors; only the planned files plus the saved plan/spec are changed, and the existing untracked user test remains untouched.
