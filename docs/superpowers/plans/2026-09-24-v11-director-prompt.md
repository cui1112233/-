# V11导演提示词 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable V11导演提示词 that uses the existing H3 director and timeline pipeline while rendering its submitted VIDEO prompt with Chinese display text.

**Architecture:** Register a second `batch.video-meta` system preset and recognize its protocol key as H3-capable in the Node bridge. The Go compiler retains all canonical millisecond data but chooses a Chinese presentation renderer only for `v11-director-normal`; the original H3 renderer remains unchanged for every other key.

**Tech Stack:** Node.js system-preset catalog and V11 bridge, Go H3 compiler, Go and Node built-in tests.

## Global Constraints

- Keep `batch-video-h3-director` untouched and selectable.
- New preset ID is `batch-video-v11-director`; protocol key is `v11-director-normal`.
- Both preset choices use `h3-structured-v1`, one H3 director document per non-empty source line, and the existing Canonical Timeline.
- Render only display text as whole seconds; retain millisecond data for segmentation, provider requests, merge, persistence and Trace.
- Do not include the old Node fallback sentence in the new preset path.

---

### Task 1: Register the independent selectable preset

**Files:**
- Create: `prompts/批量工厂-V11导演提示词.md`
- Modify: `lib/system-preset-catalog.js:488-490`
- Test: `lib/system-preset-catalog.test.js`

**Interfaces:**
- Consumes: `BATCH_PRESETS` and its `batch.video-meta` slot contract.
- Produces: published preset `batch-video-v11-director` with `protocolLock.key === 'v11-director-normal'`.

- [ ] **Step 1: Write the failing test**

```js
test('Batch Factory publishes V11 director as an independent H3 video preset', () => {
  const v11 = SYSTEM_PRESETS.find(preset => preset.id === 'batch-video-v11-director');
  assert.equal(v11?.name, 'V11导演提示词');
  assert.equal(v11?.protocolLock?.slot, 'batch.video-meta');
  assert.equal(v11?.protocolLock?.key, 'v11-director-normal');
  assert.match(v11?.body || '', /【批量工厂最终 Prompt 模板】/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='publishes V11 director as an independent H3 video preset' lib/system-preset-catalog.test.js`

Expected: FAIL because the preset does not exist.

- [ ] **Step 3: Write minimal implementation**

Create a system-preset body containing H3 JSON director requirements and a final-template marker with `{{storyboard}}`. Add the preset to `BATCH_PRESETS` with the required ID, name, source file, `video-meta` operation and `v11-director-normal` key.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='publishes V11 director as an independent H3 video preset' lib/system-preset-catalog.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prompts/批量工厂-V11导演提示词.md lib/system-preset-catalog.js lib/system-preset-catalog.test.js
git commit -m "feat(batch-factory): add V11 director preset"
```

### Task 2: Route the new preset through H3

**Files:**
- Modify: `routes/batch-factory-v11.js:503-506`
- Test: `routes/batch-factory-v11.test.js`

**Interfaces:**
- Consumes: effective video preset `{ presetId, presetKey, enabled }`.
- Produces: `h3VideoSelected(batch, book) === true` for `v11-director-normal` and `batch-video-v11-director`.

- [ ] **Step 1: Write the failing test**

```js
test('routes the selectable V11 director preset through the H3 pipeline', () => {
  const batch = { settingsState: { patch: { aiPromptConfig: { video: { presetId: 'batch-video-v11-director', presetKey: 'v11-director-normal', enabled: true } } } } };
  assert.equal(h3VideoSelected(batch, {}), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='routes the selectable V11 director preset through the H3 pipeline' routes/batch-factory-v11.test.js`

Expected: FAIL because only the original H3 key is recognized.

- [ ] **Step 3: Write minimal implementation**

Add the new preset ID and protocol key to `h3VideoSelected`; leave all ordinary video presets unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='routes the selectable V11 director preset through the H3 pipeline' routes/batch-factory-v11.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/batch-factory-v11.js routes/batch-factory-v11.test.js
git commit -m "feat(batch-factory): route V11 director through H3"
```

### Task 3: Render V11 prompt text in Chinese without losing precision

**Files:**
- Modify: `backend/internal/batchfactoryv11/h3_compiler.go:390-547`
- Test: `backend/internal/batchfactoryv11/h3_compiler_test.go`

**Interfaces:**
- Consumes: `H3VideoPreset.Key`, `H3DirectorDocument`, and `H3VideoSegment`.
- Produces: Chinese final prompt for `v11-director-normal`; unchanged legacy renderer otherwise.

- [ ] **Step 1: Write the failing test**

```go
func TestCompileH3VideoSegmentsRendersV11DirectorPromptInChinese(t *testing.T) {
  input := completeH3CompileInput(mustH3DirectorFixture(t), mustH3Timeline(t, mustH3DirectorFixture(t), 7420))
  input.Preset.Key = "v11-director-normal"
  compilation, err := CompileH3VideoSegments(input)
  if err != nil { t.Fatal(err) }
  prompt := compilation.Segments[0].CompiledPrompt
  for _, text := range []string{"总时长：", "时间：", "@我", "音频：", "声音设计：模式=", "发声角色="} {
    if !strings.Contains(prompt, text) { t.Fatalf("missing %q: %s", text, prompt) }
  }
  for _, text := range []string{"Total duration:", "Soundscape:", "00:00.000"} {
    if strings.Contains(prompt, text) { t.Fatalf("legacy display leaked %q: %s", text, prompt) }
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./backend/internal/batchfactoryv11 -run TestCompileH3VideoSegmentsRendersV11DirectorPromptInChinese -count=1`

Expected: FAIL because `v11-director-normal` currently uses the English renderer.

- [ ] **Step 3: Write minimal implementation**

Add a key-gated presentation renderer. It must display scene duration rounded to a whole second, each micro-shot range with floor-start/ceil-end integer clocks, roster slots as `@name`, and Chinese audio labels. Keep `H3VideoSegment` millisecond fields unchanged and retain the current renderer for all non-V11 keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./backend/internal/batchfactoryv11 -run 'TestCompileH3VideoSegments(RendersV11DirectorPromptInChinese|UsesRealH3SubmissionGrammarInsteadOfTraceDump)' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/batchfactoryv11/h3_compiler.go backend/internal/batchfactoryv11/h3_compiler_test.go
git commit -m "feat(batch-factory): render V11 director prompts in Chinese"
```

### Task 4: Verify and direct-deploy the exact V88 revision

**Files:**
- Modify: none

**Interfaces:**
- Consumes: current V88 commit and public `v88-node` image release configuration.
- Produces: authenticated public runtime with the exact Git SHA in `/api/runtime-build-info`.

- [ ] **Step 1: Run regression tests**

Run:

```bash
node --test lib/system-preset-catalog.test.js routes/batch-factory-v11.test.js
go test ./backend/internal/batchfactoryv11 -count=1
```

Expected: target suites pass; unrelated existing failures are reported without changing unrelated code.

- [ ] **Step 2: Build and release only affected services**

Build a Node image from the committed V88 source and a Go API image from the committed Go source. Update only the public compose image references, recreate only `v88-node` and the Go API service, and leave databases, worker volumes, works, videos and presets intact.

- [ ] **Step 3: Verify public identity and behavior**

Run `GET /api/runtime-build-info` inside the restarted Node container and through the public loopback route. Open the authenticated public system-presets page, verify that both director presets are listed, and do not generate, submit, upload or overwrite any book.

- [ ] **Step 4: Commit only source changes**

```bash
git status --short
git diff --check
```

Expected: all feature source changes have individual commits; preserve unrelated dirty files and generated frontend output.
