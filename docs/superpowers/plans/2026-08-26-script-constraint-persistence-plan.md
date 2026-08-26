# Script Constraint Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply every child constraint to the current script generation independently, make the master switch persist choices only for future generations, and prohibit standalone character/scene setup in every mode when base setup is off.

**Architecture:** The client keeps current and completed-output constraint snapshots separate. The server uses `baseSetup.enabled` as the sole authority for entity cards. Built-in prompt templates become conditional, and seeded published system prompts receive an idempotent guard instead of being overwritten.

**Tech Stack:** React, Ant Design, Express/CommonJS, `node:test`, Vite, Docker Compose.

## Global Constraints

- `后续剧本输出约束` controls persistence only; child switches always apply to the current request.
- Full `人物与场景` or `基础设定` blocks require `baseSetup.enabled === true`.
- Timeline names, actions, and locations required by the novel remain allowed.
- Preserve administrator-authored prompt text and unrelated dirty worktree changes.
- Release order: tests, frontend build, focused Git commits and push, Docker deploy, health check, formal URL verification.

## File Structure

- `frontend/src/user/pages/scriptConstraints.js`: normalization and future-persistence boundary.
- `frontend/src/user/pages/ScriptPage.jsx`: current, persisted, and output constraint snapshots.
- `routes/chat.js`: server prompt entity-card gate.
- `frontend/src/user/pages/scriptFinalSegment.js`: final-card setup-block stripping.
- `prompts/剧情模式.md`, `prompts/画布模式.md`, `prompts/分镜模式.md`, `prompts/剧本模式.md`, `prompts/Q版模式.md`: conditional setup wording.
- `lib/system-preset-catalog.js`: old published format-preset guard migration.
- `tests/script-constraint-persistence.test.js`, `tests/script-format-q版.test.js`, `tests/script-final-segment.test.js`, `tests/system-preset-catalog.test.js`: regression coverage.

### Task 1: Separate current settings from future persistence

**Files:**
- Modify: `frontend/src/user/pages/scriptConstraints.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Create: `tests/script-constraint-persistence.test.js`

**Interfaces:** Produce `constraintsForNextGeneration(value)`. Keep `currentConstraints` for the API request and `outputConstraints` for completed-card rendering/history.

- [ ] **Step 1: Write the failing pure-state test**

```js
test('one-off constraint choices are not persisted for the next generation', async () => {
  const { constraintsForNextGeneration } = await constraintsModule();
  const next = constraintsForNextGeneration({ enabled: false, baseSetup: { enabled: true }, quality: { enabled: true, body: '4K' } });
  assert.equal(next.baseSetup.enabled, false);
  assert.equal(next.quality.enabled, false);
});
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/script-constraint-persistence.test.js`

Expected: FAIL because `constraintsForNextGeneration` is not exported.

- [ ] **Step 3: Implement the boundary**

```js
export function constraintsForNextGeneration(value) {
  const normalized = normalizeScriptConstraints(value);
  return normalized.enabled ? normalized : normalizeScriptConstraints(DEFAULT_SCRIPT_CONSTRAINTS);
}
```

Send `currentConstraints`, attach that snapshot to output/history, and save only `constraintsForNextGeneration(currentConstraints)` to local draft storage. After a one-off run, clear current constraints but keep output constraints for the displayed cards.

- [ ] **Step 4: Correct modal semantics**

Remove the automatic parent `enabled: true` mutation from `updateDraftConstraint`. Rename the master label to `后续剧本输出约束`; explain it saves the selected child choices for the next run and that child switches always apply to this run.

- [ ] **Step 5: Verify green and commit**

Run: `node --test tests/script-constraint-persistence.test.js tests/script-constraint-normalize.test.js tests/script-draft-persistence-contract.test.js`

Expected: PASS.

```bash
git add frontend/src/user/pages/scriptConstraints.js frontend/src/user/pages/ScriptPage.jsx tests/script-constraint-persistence.test.js
git commit -m "fix: separate script constraint persistence"
```

### Task 2: Gate character and scene cards at the server boundary

**Files:**
- Modify: `routes/chat.js`
- Modify: `tests/script-format-q版.test.js`

**Interfaces:** `buildScriptMessages` emits entity cards only if `body.constraints.baseSetup.enabled === true`; individual enabled layers work even when `constraints.enabled === false`.

- [ ] **Step 1: Write failing message tests**

```js
test('base setup disabled removes entity cards from all formats', () => {
  for (const format of ['screenplay', 'storyboard', 'shortdrama', 'shotlist', 'q版']) {
    const prompt = buildMessagesFor(format, { enabled: false, baseSetup: { enabled: false } })[1].content;
    assert.doesNotMatch(prompt, /## 人物信息|## 场景信息|主角白名单/);
  }
});
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/script-format-q版.test.js`

Expected: FAIL because the current user message appends entity cards unconditionally.

- [ ] **Step 3: Implement one `hasBaseSetup` gate**

```js
const hasBaseSetup = body.constraints?.baseSetup?.enabled === true;
```

Only serialize characters, scenes, and protagonists when true. Make `buildConstraintWrapper` inspect each child switch directly, not `constraints.enabled`. When false, append a final guard forbidding `【基础设定】`, `【人物与场景】`, entity cards, `统一人物`, and `场景环境` blocks while allowing plot-required timeline details.

- [ ] **Step 4: Verify green and commit**

Run: `node --test tests/script-format-q版.test.js tests/script-constraint-normalize.test.js`

Expected: PASS.

```bash
git add routes/chat.js tests/script-format-q版.test.js
git commit -m "fix: gate script entity setup by current constraint"
```

### Task 3: Remove final-card leakage and make source templates conditional

**Files:**
- Modify: `frontend/src/user/pages/scriptFinalSegment.js`
- Modify: `tests/script-final-segment.test.js`
- Modify: `prompts/剧情模式.md`, `prompts/画布模式.md`, `prompts/分镜模式.md`, `prompts/剧本模式.md`, `prompts/Q版模式.md`

**Interfaces:** Produce `stripStandaloneSetupSections(value)` before optional `buildBaseSetupText` injection.

- [ ] **Step 1: Write the failing card test**

```js
test('disabled base setup strips model-created 人物与场景 blocks', async () => {
  const { buildFinalSegmentCard } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const card = buildFinalSegmentCard('【人物与场景】\n林溪：完整外形。\n场景：农家小院。\n【时间轴】\n00:00-00:10 | 林溪转身。', { extractInfo, constraints: { baseSetup: { enabled: false } }, duration: '10s' });
  assert.doesNotMatch(card, /人物与场景|完整外形|农家小院/);
  assert.match(card, /00:00-00:10 \| 林溪转身/);
});
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/script-final-segment.test.js`

Expected: FAIL because cleanup currently only recognizes `【基础设定】` and unbracketed legacy headings.

- [ ] **Step 3: Implement cleanup and wording**

Strip `【人物与场景】`, `[人物与场景]`, `人物卡`, and `场景卡` until `【时间轴】`, `【画面内容】`, `镜头画面`, a timeline row, or a new segment. Preserve timeline references. Change all five templates to request a format-specific setup block only when the system supplied base setup.

- [ ] **Step 4: Verify green and commit**

Run: `node --test tests/script-final-segment.test.js tests/script-shot-prompt-contract.test.js`

Expected: PASS.

```bash
git add frontend/src/user/pages/scriptFinalSegment.js tests/script-final-segment.test.js prompts/剧情模式.md prompts/画布模式.md prompts/分镜模式.md prompts/剧本模式.md prompts/Q版模式.md
git commit -m "fix: remove standalone setup when script constraint is off"
```

### Task 4: Upgrade old published system prompt bodies safely

**Files:**
- Modify: `lib/system-preset-catalog.js`
- Modify: `tests/system-preset-catalog.test.js`

**Interfaces:** Produce `BASE_SETUP_GUARD_MARKER` and `BASE_SETUP_GUARD`. `seedSystemPresets` appends the guard once to published system screenplay, storyboard, shortdrama, shotlist, and q版 presets without replacing existing text.

- [ ] **Step 1: Write the failing migration test**

```js
test('adds the base setup guard without replacing an old custom screenplay body', t => {
  const store = createStore(t);
  const draft = store.createDraft('owner', customFormatPreset('script-format-screenplay', 'CUSTOM_BODY'));
  store.publish('owner', draft.id, draft.version);
  seedSystemPresets(store, 'owner');
  assert.match(store.getPublished('script-format-screenplay').body, /^CUSTOM_BODY[\s\S]*基础设定未启用/);
});
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/system-preset-catalog.test.js`

Expected: FAIL because the current catalog migrates only the Q mini-character guard.

- [ ] **Step 3: Implement the marker migration**

For only the five fixed system format IDs, append the guard as a new published version when the marker is absent. Do not migrate extraction, mode, quick-director, or user-created preset IDs.

- [ ] **Step 4: Verify green and commit**

Run: `node --test tests/system-preset-catalog.test.js`

Expected: PASS.

```bash
git add lib/system-preset-catalog.js tests/system-preset-catalog.test.js
git commit -m "fix: migrate published script setup guards"
```

### Task 5: Validate, synchronize Git, and deploy Docker

**Files:** No production edits; do not stage unrelated dirty files.

- [ ] **Step 1: Run the affected suite**

```bash
node --test tests/script-constraint-persistence.test.js tests/script-constraint-normalize.test.js tests/script-draft-persistence-contract.test.js tests/script-format-q版.test.js tests/script-final-segment.test.js tests/script-shot-prompt-contract.test.js tests/system-preset-catalog.test.js
git diff --check
```

Expected: PASS with no whitespace errors.

- [ ] **Step 2: Build the frontend**

Run: `npm --prefix frontend run build`

Expected: exit 0; existing brand asset and large-chunk warnings may remain but cannot be build failures.

- [ ] **Step 3: Push focused commits**

Run: `git push`

Expected: current branch updated on its configured remote.

- [ ] **Step 4: Deploy and verify Docker**

```bash
bash scripts/deploy-test-docker.sh up
bash scripts/deploy-test-docker.sh health
curl -fsS -o /dev/null -w 'script HTTP %{http_code}\n' http://10.0.101.164:3000/script
```

Expected: health contains `"ok":true` and the script page returns HTTP 200. Treat the deploy script's final self-call permission message as nonfatal only when containers were recreated and the separate health check passes.

- [ ] **Step 5: Browser acceptance**

Enable only base setup and confirm it appears in a final card. Disable it and confirm independent setup headings disappear while the timeline remains. Enable `后续剧本输出约束`, reload, and confirm child switches restore; disable it, generate once, reload, and confirm they reset.

## Plan Self-Review

- Coverage: Tasks 1-4 implement state semantics, server input, final output, source templates, and published-prompt compatibility; Task 5 covers tests, Git, Docker, and the formal URL.
- Placeholder scan: no `TBD`, `TODO`, or ambiguous action remains.
- Consistency: `constraintsForNextGeneration`, `currentConstraints`, `outputConstraints`, `hasBaseSetup`, and `BASE_SETUP_GUARD_MARKER` each have one defined responsibility.
