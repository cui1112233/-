# Script Inline Asset Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authors select a visual `@` person/scene near the text cursor and render every matching `@名称` in script editors as an inline main-image asset chip without changing the plain-text video contract.

**Architecture:** Add a small pure mention-projection module and a reusable controlled `contentEditable` `ScriptMentionEditor`. The editor serializes every editing operation back to the existing plain-text `@名称` value and reports text offsets for the existing candidate filtering logic. `ScriptPage` will use it for total-script and shot editors, with a single anchored visual candidate menu and no bottom mention toolbar.

**Tech Stack:** React 18, Vite, Ant Design, native DOM Range/Selection APIs, Node built-in test runner. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-23-script-inline-asset-mentions-design.md`

## Global Constraints

- Apply only to the V88 `ScriptPage` total-script and shot editing flows.
- Persist, copy, split and submit only plain text `@名称`; never persist HTML, images, or rich-text JSON.
- Resolve a chip only when its name uniquely matches a current character or scene; unknown names remain text.
- Use the entity `mainImageUrl` as the thumbnail and retain existing `collectShotReferenceImages` / nine-image / disabled-reference behavior.
- The only mention entry point is typing `@` in the editor; remove the bottom `@ 素材` and referenced-material toolbar.
- No network request, upload, or external video job may run while filtering or rendering mentions.
- Use fixed thumbnail dimensions and lazy image loading; do not add a rich-text dependency.

## Review Focus

- A pasted or generated `@名称` must become a chip immediately once a same-name left asset has a main image; Task 1 test covers projection.
- Duplicate character/scene names must stay plain text rather than silently bind to the wrong image; Task 1 test covers ambiguous labels.
- Existing `@名称` must re-render when an entity receives or changes its main image; Task 2 source contract covers candidates as a live prop and Task 3 integration passes fresh entity data.
- Composition events for Chinese IME must not rebuild the DOM during composition or lose uncommitted characters; Task 2 test covers composition guards.
- Deleting directly before or after a chip must serialize a whole `@名称`, not leave orphan image markup or change the generated-video prompt; Task 2 tests deletion normalization and Task 3 retains reference tests.

---

## File Structure

- Create `frontend/src/user/pages/scriptInlineMentions.js` — pure parsing, unique entity resolution, DOM-independent canonical text helpers.
- Create `frontend/src/user/pages/scriptInlineMentions.test.js` — Node contracts for the projection and canonicalization helpers.
- Create `frontend/src/user/components/ScriptMentionEditor.jsx` — controlled content-editable renderer, selection mapping and input/IME/paste handlers.
- Create `frontend/src/user/components/ScriptMentionEditor.test.js` — source-level component contracts suitable for the current Node-only test environment.
- Modify `frontend/src/user/pages/ScriptPage.jsx` — use the shared editor and visual cursor-anchored candidate menu for full script and shots; remove legacy bottom UI.
- Modify `frontend/src/user/pages/scriptOutputMentionUi.test.js` — replace the obsolete bottom-toolbar expectation with total-editor integration contracts.
- Modify `frontend/src/user/pages/scriptShotMentions.test.js` — retain old helper coverage and add shared visual-menu assumptions only if a pure helper changes.

### Task 1: Build the canonical mention projection

**Files:**
- Create: `frontend/src/user/pages/scriptInlineMentions.js`
- Create: `frontend/src/user/pages/scriptInlineMentions.test.js`

**Interfaces:**
- Consumes: `text: string`, `entities: Array<{ id: string, name?: string, mainImageUrl?: string, data?: object }>` and `getEntityMedia(entity)` supplied by the caller.
- Produces: `buildInlineMentionSegments(text, candidates): Array<{ type: 'text', value: string } | { type: 'mention', value: string, name: string, kind: 'character'|'scene', imageUrl: string }>` and `canonicalTextFromSegments(segments): string`.

- [ ] **Step 1: Write the failing pure-module tests**

```js
test('projects a pasted matching mention with its current main image', () => {
  assert.deepEqual(buildInlineMentionSegments('镜头里有@妻子。', [
    { kind: 'character', item: { id: 'c1', name: '妻子' }, imageUrl: '/wife.png' }
  ]), [
    { type: 'text', value: '镜头里有' },
    { type: 'mention', value: '@妻子', name: '妻子', kind: 'character', imageUrl: '/wife.png' },
    { type: 'text', value: '。' }
  ]);
});

test('leaves an ambiguous name as text', () => {
  assert.deepEqual(buildInlineMentionSegments('@客厅', [
    { kind: 'character', item: { id: 'c1', name: '客厅' }, imageUrl: '/a.png' },
    { kind: 'scene', item: { id: 's1', name: '客厅' }, imageUrl: '/b.png' }
  ]), [{ type: 'text', value: '@客厅' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test frontend/src/user/pages/scriptInlineMentions.test.js`

Expected: FAIL because `scriptInlineMentions.js` does not exist.

- [ ] **Step 3: Implement the pure projection and serialization helpers**

```js
const MENTION_TOKEN = /@([\u4e00-\u9fffA-Za-z0-9_-]+)/g;

export function buildInlineMentionSegments(text, candidates = []) {
  const value = String(text || '');
  const byName = new Map();
  for (const candidate of candidates) {
    const name = String(candidate?.item?.name || '').trim();
    if (!name) continue;
    byName.set(name, [...(byName.get(name) || []), candidate]);
  }
  // Emit a mention segment only when byName.get(name) has exactly one item.
}

export function canonicalTextFromSegments(segments = []) {
  return segments.map(segment => segment.type === 'mention' ? `@${segment.name}` : segment.value).join('');
}
```

Use `@名称` as every mention segment's `value`, keep image URL empty when a unique entity lacks a main image, and never mutate the candidate arrays.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --test frontend/src/user/pages/scriptInlineMentions.test.js frontend/src/user/pages/scriptShotMentions.test.js`

Expected: PASS; pasted, generated and historical text are represented by the same pure projection, while existing cursor replacement helpers still pass.

- [ ] **Step 5: Commit the tested pure module**

```bash
git add frontend/src/user/pages/scriptInlineMentions.js frontend/src/user/pages/scriptInlineMentions.test.js
git commit -m "feat(script): project inline asset mentions"
```

### Task 2: Create the controlled inline editor

**Files:**
- Create: `frontend/src/user/components/ScriptMentionEditor.jsx`
- Create: `frontend/src/user/components/ScriptMentionEditor.test.js`

**Interfaces:**
- Consumes: `{ value: string, candidates: Array, editable: boolean, placeholder?: string, onChange(nextText: string): void, onQueryChange({ text: string, cursor: number, rect: DOMRect | null }): void }`.
- Produces: a `contentEditable` editor that renders `buildInlineMentionSegments(value, candidates)` and sends canonical plain text through `onChange`.

- [ ] **Step 1: Write failing component contracts**

```js
test('renders a controlled contentEditable editor with non-editable mention chips', () => {
  assert.match(source, /contentEditable=\{editable\}/);
  assert.match(source, /contentEditable=\{false\}/);
  assert.match(source, /buildInlineMentionSegments\(value, candidates\)/);
  assert.match(source, /loading="lazy"/);
});

test('guards Chinese composition and accepts only plain text paste', () => {
  assert.match(source, /onCompositionStart/);
  assert.match(source, /onCompositionEnd/);
  assert.match(source, /clipboardData\.getData\('text\/plain'\)/);
});
```

- [ ] **Step 2: Run the component contract test to verify it fails**

Run: `node --test frontend/src/user/components/ScriptMentionEditor.test.js`

Expected: FAIL because the component source does not exist.

- [ ] **Step 3: Implement selection-safe content editing**

```jsx
<div
  ref={editorRef}
  className="script-mention-editor"
  contentEditable={editable}
  suppressContentEditableWarning
  role="textbox"
  aria-multiline="true"
  onInput={handleInput}
  onPaste={handlePaste}
  onCompositionStart={() => { composingRef.current = true; }}
  onCompositionEnd={handleCompositionEnd}
>
  {segments.map(renderSegment)}
</div>
```

Render each mention as `<span contentEditable={false} data-mention-name={segment.name}>`; include an image only when `segment.imageUrl` exists, otherwise render a type-specific visual placeholder. Implement DOM selection-to-text-offset and text-offset-to-selection helpers in this component. During composition, only retain the browser DOM; at `compositionend`, serialize `editorRef.current.innerText`, call `onChange`, then issue one query update. In `handlePaste`, prevent default, insert `event.clipboardData.getData('text/plain')` at the selection, serialize and issue `onChange`.

- [ ] **Step 4: Run focused editor contracts and projection tests**

Run: `node --test frontend/src/user/components/ScriptMentionEditor.test.js frontend/src/user/pages/scriptInlineMentions.test.js`

Expected: PASS; the editor has no dependency beyond React and its source contains the required IME, plain-paste, lazy-image and non-editable-chip protections.

- [ ] **Step 5: Commit the shared editor**

```bash
git add frontend/src/user/components/ScriptMentionEditor.jsx frontend/src/user/components/ScriptMentionEditor.test.js
git commit -m "feat(script): add inline mention editor"
```

### Task 3: Integrate cursor-anchored visual selection in ScriptPage

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx:29,119-187,1552-1610,1631-1700`
- Modify: `frontend/src/user/pages/scriptOutputMentionUi.test.js`
- Modify: `frontend/src/user/pages/scriptShotMentions.test.js`

**Interfaces:**
- Consumes: `ScriptMentionEditor` from Task 2 and `buildInlineMentionSegments` candidates derived from `extractInfo.characters`, `extractInfo.scenes` and `getEntityMedia`.
- Produces: identical inline visual `@` behavior in total-script and shot editors, while `output` and `editingShot.text` remain strings consumed by existing save and video paths.

- [ ] **Step 1: Replace the obsolete UI test with failing integration expectations**

```js
test('the total script editor uses the inline editor and has no bottom mention toolbar', () => {
  assert.match(source, /<ScriptMentionEditor/);
  assert.doesNotMatch(source, /aria-label="打开人物与场景素材候选"/);
  assert.doesNotMatch(source, /aria-label="当前全文已引用素材"/);
});

test('ScriptPage renders a cursor-anchored candidate menu with creation and image cards', () => {
  assert.match(source, /可能@的内容/);
  assert.match(source, /创建主体/);
  assert.match(source, /candidateImageUrl/);
  assert.match(source, /anchorRect/);
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `node --test frontend/src/user/pages/scriptOutputMentionUi.test.js`

Expected: FAIL because ScriptPage still uses `Input.TextArea` and its bottom `@ 素材` toolbar.

- [ ] **Step 3: Replace both textarea mention flows and render the visual menu**

```jsx
<ScriptMentionEditor
  value={output}
  candidates={mentionCandidates}
  editable={editingOutput}
  onChange={next => updateOutputDraft(next)}
  onQueryChange={({ text, cursor, rect }) => syncOutputMentionSelection(text, cursor, rect)}
/>
```

Derive each `mentionCandidates` item as `{ kind, item, imageUrl: getEntityMedia(item).mainImageUrl }`. Add `anchorRect` to the total-editor and shot-editor mention state. Render one reusable menu component with heading `可能@的内容`, a first `＋ 创建主体` item that opens the existing entity editor in the active kind context, then candidate rows with thumbnail/placeholder, name, type and a non-destructive more button. Position it with `position: fixed` from `anchorRect`; flip above when `anchorRect.bottom + menuHeight` exceeds `window.innerHeight`. Keep `ArrowUp`, `ArrowDown`, `Enter`, and `Escape` behavior; use the existing `insertActiveShotMention` to update only the active token. Remove the `@ 素材` button and `outputMentionLabels` toolbar completely. Use the same component for the shot modal, wiring it to `editingShot.text` and its existing save flow.

- [ ] **Step 4: Run integration and existing video-reference regressions**

Run: `node --test frontend/src/user/pages/scriptOutputMentionUi.test.js frontend/src/user/pages/scriptShotMentions.test.js frontend/src/user/pages/scriptInlineMentions.test.js frontend/src/user/components/ScriptMentionEditor.test.js frontend/src/user/pages/scriptVideoReferences.test.js`

Expected: PASS; full and shot editor source contracts use the shared editor, no bottom mention controls remain, and `@名称` still yields the same main-image video references.

- [ ] **Step 5: Commit the ScriptPage integration**

```bash
git add frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/scriptOutputMentionUi.test.js frontend/src/user/pages/scriptShotMentions.test.js
git commit -m "feat(script): show visual asset mentions inline"
```

### Task 4: Verify the user-visible build and source boundaries

**Files:**
- Modify only if required by build output: `frontend/src/user/components/ScriptMentionEditor.jsx` or `frontend/src/user/pages/ScriptPage.jsx`

**Interfaces:**
- Consumes: all commits from Tasks 1–3.
- Produces: a Vite build that contains the inline editor and preserves existing video reference contracts.

- [ ] **Step 1: Run the complete scoped regression set**

Run: `node --test frontend/src/user/pages/scriptShotMentions.test.js frontend/src/user/pages/scriptInlineMentions.test.js frontend/src/user/components/ScriptMentionEditor.test.js frontend/src/user/pages/scriptOutputMentionUi.test.js frontend/src/user/pages/scriptVideoReferences.test.js frontend/src/user/pages/scriptEntityImages.test.js`

Expected: PASS with no skipped or failing tests.

- [ ] **Step 2: Build the frontend**

Run: `npm --prefix frontend run build`

Expected: exit code 0 and generated `frontend/dist` assets; do not add generated `dist` artifacts to the feature commit unless repository policy already tracks them.

- [ ] **Step 3: Inspect the final diff for unintended scope**

Run: `git diff origin/v88...HEAD --check && git diff --name-only origin/v88...HEAD`

Expected: only the new mention module/component/tests, `ScriptPage.jsx`, and the design/plan documentation; no Go, deployment, database, worker, TOS-upload or generated-output changes.

- [ ] **Step 4: Commit any source-only build correction if one was necessary**

```bash
git add frontend/src/user/components/ScriptMentionEditor.jsx frontend/src/user/pages/ScriptPage.jsx
git commit -m "fix(script): complete inline mention build"
```

- [ ] **Step 5: Record verification evidence before release authorization**

Run: `git status --short && git log --oneline origin/v88..HEAD`

Expected: clean source worktree except ignored build artifacts, with the exact implementation commits ready for review. Do not push, deploy, create user assets, upload images, or generate video in this task.

## Self-Review

- Spec coverage: Tasks 1–2 implement plain-text projection and inline chips; Task 3 implements the cursor-positioned menu, create entry, full/shot coverage, no-bottom-toolbar requirement and dynamic entity image props; Tasks 3–4 preserve and test video-image collection; Task 4 covers performance-related dependency and scope constraints through source/build review.
- Placeholder scan: no unfinished markers or unspecified test steps are present.
- Type consistency: candidates have `{ kind, item, imageUrl }` throughout Tasks 1–3; canonical editor output is `string`; existing `insertActiveShotMention` remains the sole text insertion helper.
- Review focus coverage: each listed failure mode is assigned to Task 1, 2 or 3 tests.

## Execution Handoff

Plan complete. Its tasks are sequential because the page integration depends on the canonical projection and editor component interfaces. Native execution is recommended: it is faster and avoids cross-agent conflicts in `ScriptPage.jsx`, while final verification can still be done independently. No release is included in this plan.
