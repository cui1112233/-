# 原版 H3 导演预设转换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原 H3 导演工程转换为批量工厂中可选择、可编辑、可追溯的“H3 导演分镜视频提示词”预设，而不是隐藏在编译器中的固定文案。

**Architecture:** 原 `outline.batch.system` 提供导演模型规则；原 `h3.normal.template` 映射为该预设的最终模板语义。批量工厂继续持有不可变事实：视频原文、真实配音、确定性时间线、结构校验、冻结与 Trace；预设持有可编辑导演语言和字段排列。

**Tech Stack:** Node.js、系统预设目录、Go H3 编译适配器、node:test。

## Global Constraints

- 不覆盖管理员修改过的已发布 H3 视频预设正文。
- 不复制原 H3 服务、数据库或任务中心。
- 每个“视频原文”非空行仍对应一个导演卡；最终时长及 10/15 秒切段仍由后端确定性计算。
- 新预设规则保留原 H3 的人物 slot、微镜头、动作、机位、运镜、结构化连续性与语义权重。
- 基础设定、画面前缀、画面限制只控制最终 Prompt 注入/展示层，不能删除导演事实。

---

### Task 1: 锁定原版导演规则与模板的预设装载

**Files:**
- Modify: `prompts/批量工厂-H3导演分镜视频提示词.md`
- Modify: `lib/system-preset-catalog.js:33-53,715-717`
- Test: `lib/system-preset-catalog.test.js`

**Interfaces:**
- Consumes: 原版 `outline.batch.system__v78.3.0.59.txt` 与 `h3.normal.template__v78.3.0.59.txt`。
- Produces: `batch-video-h3-director` 的默认正文，含原版导演规则与 `{{visual_baseline}}`、`{{asset_definitions}}`、`{{storyboard}}`、`{{visual_restriction}}` 模板槽位。

- [ ] **Step 1: Write the failing test**

```js
test('ships the H3 director preset from the original H3 rule contract', () => {
  const h3 = catalog.find(item => item.id === 'batch-video-h3-director');
  assert.match(h3.body, /每个非空原文行恰好对应一个外层timeline_segment/);
  assert.match(h3.body, /character_slot_ids/);
  assert.match(h3.body, /"timeline_segments"/);
  assert.match(h3.body, /{{storyboard}}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/system-preset-catalog.test.js`

Expected: FAIL because the current shortened rule does not preserve the original `timeline_segments` contract.

- [ ] **Step 3: Write minimal implementation**

Replace the system-owned H3 preset source with an adapted copy of the original director rule. Preserve all original director requirements; replace only Go render placeholders with Batch Factory’s user-message inputs and existing final-template variables. Update the legacy-body upgrader to replace only the known shortened system body, never a user-edited body.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/system-preset-catalog.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add prompts/批量工厂-H3导演分镜视频提示词.md lib/system-preset-catalog.js lib/system-preset-catalog.test.js && git commit -m "feat(batch-factory): ship original H3 director preset"`

### Task 2: 让预设正文真正进入导演调用与 Trace

**Files:**
- Modify: `routes/batch-factory-v11.js:1180-1210,1260-1325`
- Test: `routes/batch-factory-v11.test.js`

**Interfaces:**
- Consumes: 有版本的 `batch-video-h3-director` 正文与书级配置。
- Produces: 冻结预设正文/版本进入导演调用与 Trace；最终编译只消费导演数据和预设模板槽位。

- [ ] **Step 1: Write the failing test**

```js
test('director stage sends the selected H3 preset body and freezes its revision', async () => {
  const trace = await runDirectorWithPreset('batch-video-h3-director', 9);
  assert.equal(trace.director.preset.id, 'batch-video-h3-director');
  assert.equal(trace.director.preset.version, 9);
  assert.match(trace.director.systemPrompt, /timeline_segments/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test routes/batch-factory-v11.test.js`

Expected: FAIL because the current H3 compiler owns a fixed `h3-structured-v1` format rather than a frozen preset-controlled director body.

- [ ] **Step 3: Write minimal implementation**

Load the selected video-preset body into the director-model request and persist `{ id, name, version, bodyDigest }` in the stage trace. Keep backend field validation and deterministic time allocation; do not let final compilation invent fixed Scene/Shot/Audio prose.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test routes/batch-factory-v11.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add routes/batch-factory-v11.js routes/batch-factory-v11.test.js && git commit -m "feat(batch-factory): drive H3 director from preset"`

### Task 3: 编译只填模板，不再强制 H3 文案格式

**Files:**
- Modify: `backend/internal/batchfactoryv11/h3_compiler.go`
- Test: `backend/internal/batchfactoryv11/h3_compiler_test.go`

**Interfaces:**
- Consumes: 已校验的导演数据、Canonical Timeline 和预设最终模板。
- Produces: 按预设模板字段排列的冻结 `compiled_prompt` 与 Trace；未选择的约束层不注入。

- [ ] **Step 1: Write the failing test**

```go
func TestCompileUsesPresetStoryboardTemplateWithoutFixedSceneShotAudioLabels(t *testing.T) {
  out := mustCompile(t, CompileInput{Preset: preset("{{storyboard}}"), Timeline: fixtureTimeline()})
  if strings.Contains(out.Prompt, "【Scene】") { t.Fatal("fixed H3 label leaked") }
  if !strings.Contains(out.Prompt, "镜头正文") { t.Fatal("director content missing") }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./backend/internal/batchfactoryv11 -run TestCompileUsesPresetStoryboardTemplateWithoutFixedSceneShotAudioLabels`

Expected: FAIL because current canonical compiler unconditionally renders fixed H3 labels.

- [ ] **Step 3: Write minimal implementation**

Render only the selected preset template variables. Preserve standardized `VIDEO` container metadata, source slices, measured/request duration and Trace outside the editable text. Reject an incompatible selected template with a clear validation error rather than silently applying the fixed H3 layout.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./backend/internal/batchfactoryv11 -run TestCompileUsesPresetStoryboardTemplateWithoutFixedSceneShotAudioLabels`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add backend/internal/batchfactoryv11/h3_compiler.go backend/internal/batchfactoryv11/h3_compiler_test.go && git commit -m "feat(batch-factory): render director prompts from preset templates"`

### Task 4: 回归 H3、普通视频预设与约束开关

**Files:**
- Test: `routes/batch-factory-v11.test.js`
- Test: `backend/internal/batchfactoryv11/h3_compiler_test.go`

- [ ] **Step 1: Write the failing regression test**

```js
test('switching video presets retains director facts but changes only the final template', async () => {
  const result = await recompileWithSecondPreset();
  assert.deepEqual(result.director.character_slot_ids, ['C001']);
  assert.notEqual(result.firstPrompt, result.secondPrompt);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test routes/batch-factory-v11.test.js && go test ./backend/internal/batchfactoryv11`

Expected: FAIL before the preset-controlled compilation behavior is complete.

- [ ] **Step 3: Write minimal implementation**

Repair only failures that prove lost director facts, missing trace revisions, wrong template selection, or an injection-layer switch leaking into director facts.

- [ ] **Step 4: Run targeted verification**

Run: `node --test lib/system-preset-catalog.test.js routes/batch-factory-v11.test.js && go test ./backend/internal/batchfactoryv11`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add lib/system-preset-catalog.test.js routes/batch-factory-v11.test.js backend/internal/batchfactoryv11/h3_compiler_test.go && git commit -m "test(batch-factory): cover H3 director preset pipeline"`
