# Script Inline Image Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render primary-image subjects as inline thumbnail-plus-name labels, retain text-only `@名称`, and submit only valid image references with video generation.

**Architecture:** Prompt state remains canonical plain text. A shared contenteditable component renders a visual label only for a named asset with `mainImageUrl`, then serializes the label back to `@名称`. `scriptVideoReferences` remains the sole source of video attachments.

**Tech Stack:** React 18, Ant Design, DOM contenteditable, Node test runner, Vite.

## Global Constraints

- No migration, new asset store, or provider payload format.
- A missing primary image must remain ordinary `@名称` and must not upload an image.
- Both full-script and single-shot editing use the same component.
- Preserve existing reference ordering, disabled state, deduplication and H3 nine-image cap.

---

### Task 1: Canonical mention utilities

**Files:**
- Create: `frontend/src/user/components/inlineMentionDocument.js`
- Create: `frontend/src/user/components/inlineMentionDocument.test.js`
- Modify: `frontend/src/user/components/mentionAssetMenu.js`

**Interfaces:** `buildInlineMentionNodes(text, assets)` emits text nodes and `{ kind: 'mention', name, imageUrl, text: '@名称' }`; `serializeInlineMentionRoot(root)` emits canonical text; `replaceMentionToken(text, target, asset)` returns `{ text, caret }`.

- [ ] **Step 1: Write the failing model tests**

```js
assert.deepEqual(buildInlineMentionNodes('@妻子 看向 @老公', assets), [
  { kind: 'mention', text: '@妻子', name: '妻子', imageUrl: 'wife.png' },
  { kind: 'text', text: ' 看向 @老公' }
]);
assert.deepEqual(replaceMentionToken('画面：@老', { start: 3, end: 5 }, { name: '老公', hasImage: false }), { text: '画面：@老公 ', caret: 7 });
```

- [ ] **Step 2: Run RED**

Run: `node --test frontend/src/user/components/inlineMentionDocument.test.js`

Expected: missing module failure.

- [ ] **Step 3: Implement and run GREEN**

Implement token replacement with `@${asset.name} `, emit labels only from `hasImage && mainImageUrl`, and serialize `data-mention-name` as `@名称`. Run: `node --test frontend/src/user/components/inlineMentionDocument.test.js frontend/src/user/components/mentionAssetMenu.test.js`.

- [ ] **Step 4: Commit**

Run: `git add frontend/src/user/components/inlineMentionDocument.js frontend/src/user/components/inlineMentionDocument.test.js frontend/src/user/components/mentionAssetMenu.js frontend/src/user/components/mentionAssetMenu.test.js && git commit -m "feat(script): model inline image mentions"`

### Task 2: Shared inline editor

**Files:**
- Create: `frontend/src/user/components/InlineMentionEditor.jsx`
- Create: `frontend/src/user/components/InlineMentionEditor.test.js`
- Modify: `frontend/src/shared/styles/global.css`

**Interfaces:** Props are `value`, `assets`, `onChange`, `onMentionTarget`, `ariaLabel`; ref exposes `replaceTarget(target, asset)`. Primary-image labels are atomic `contentEditable={false}` spans.

- [ ] **Step 1: Write failing editor tests**

```js
assert.match(source, /contentEditable={false}/);
assert.match(source, /data-mention-name/);
assert.match(source, /serializeInlineMentionRoot/);
```

- [ ] **Step 2: Run RED**

Run: `node --test frontend/src/user/components/InlineMentionEditor.test.js`

Expected: missing component failure.

- [ ] **Step 3: Implement and run GREEN**

Render contenteditable nodes, call `onChange(serializeInlineMentionRoot(root))`, and derive the popup target/anchor from DOM Selection and Range. Preserve newlines. Style a compact 20px thumbnail/name chip and use text fallback on failed image load. Run: `node --test frontend/src/user/components/InlineMentionEditor.test.js frontend/src/user/components/inlineMentionDocument.test.js`.

- [ ] **Step 4: Commit**

Run: `git add frontend/src/user/components/InlineMentionEditor.jsx frontend/src/user/components/InlineMentionEditor.test.js frontend/src/shared/styles/global.css && git commit -m "feat(script): render inline image mention labels"`

### Task 3: Adopt it in both script surfaces

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/user/pages/scriptAtAssetMenu.source.test.js`
- Modify: `frontend/src/user/pages/scriptModelAndMention.source.test.js`
- Test: `frontend/src/user/pages/scriptShotCardEdit.test.js`

**Interfaces:** full output and shot modal use `InlineMentionEditor`; menu selection calls `outputEditorRef.current.replaceTarget(outputMention, asset)` or `shotEditorRef.current.replaceTarget(shotMention, asset)`; missing-image and create actions retain `openEntityEditor` and `addEntity`.

- [ ] **Step 1: Write failing source contracts**

```js
assert.match(source, /<InlineMentionEditor[\s\S]*ariaLabel="完整剧本编辑"/);
assert.match(source, /<InlineMentionEditor[\s\S]*ariaLabel="分镜提示词编辑"/);
assert.match(source, /outputEditorRef\.current\?\.replaceTarget\(outputMention, asset\)/);
```

- [ ] **Step 2: Run RED, implement, then run GREEN**

Run: `node --test frontend/src/user/pages/scriptAtAssetMenu.source.test.js frontend/src/user/pages/scriptModelAndMention.source.test.js`. Replace both textarea surfaces, clear the popup before existing image/create modals, then rerun those tests plus `frontend/src/user/pages/scriptShotCardEdit.test.js`.

- [ ] **Step 3: Commit**

Run: `git add frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/scriptAtAssetMenu.source.test.js frontend/src/user/pages/scriptModelAndMention.source.test.js frontend/src/user/pages/scriptShotCardEdit.test.js && git commit -m "feat(script): use inline mentions in both editors"`

### Task 4: Prove video attachments use only primary images

**Files:**
- Modify: `frontend/src/user/pages/scriptVideoReferences.js`
- Modify: `frontend/src/user/pages/scriptVideoReferences.test.js`

**Interfaces:** retain `collectShotReferenceDescriptors` and `buildScriptVideoPayload` signatures.

- [ ] **Step 1: Write failing behavior tests**

```js
assert.deepEqual(collectShotReferenceImages({ shotText: '@妻子看向镜子', extractInfo: withPrimaryWife }), ['https://cdn/wife.png']);
assert.deepEqual(collectShotReferenceImages({ shotText: '@老公转身', extractInfo: withNoPrimaryHusband }), []);
```

- [ ] **Step 2: Run RED, implement, then run GREEN**

Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js`. Restrict mention-derived references to explicit `mainImageUrl`, retain disabled-state filtering, URL deduplication and nine-image cap, then rerun the test.

- [ ] **Step 3: Full focused verification and commit**

Run: `node --test frontend/src/user/components/mentionAssetMenu.test.js frontend/src/user/components/inlineMentionDocument.test.js frontend/src/user/components/InlineMentionEditor.test.js frontend/src/user/pages/scriptAtAssetMenu.source.test.js frontend/src/user/pages/scriptModelAndMention.source.test.js frontend/src/user/pages/scriptShotCardEdit.test.js frontend/src/user/pages/scriptVideoReferences.test.js && npm --prefix frontend run build`

Run: `git add frontend/src/user/pages/scriptVideoReferences.js frontend/src/user/pages/scriptVideoReferences.test.js && git commit -m "fix(script): attach inline mention primary images"`

### Task 5: Publish and accept in browser

**Files:** generated `frontend/dist/**` only; do not stage unrelated generated changes.

- [ ] **Step 1: Build and deploy only the public frontend overlay**

Create the dist archive, base the overlay image on the current public Node image, update `QIANTIE_NODE_IMAGE` and `QIANTIE_RELEASE_SHA`, and SSH-run `docker compose up -d --no-deps v88-node`. Do not use GitHub Actions, migrations, full-stack recreation or `--remove-orphans`.

- [ ] **Step 2: Verify runtime and acceptance**

Run: `curl -fsS http://115.190.156.223:3000/api/runtime-build-info`. In a disposable prompt, test one image-backed mention, one text-only mention, video request references, and image-removal fallback. Report exact SHA and evidence boundaries.
