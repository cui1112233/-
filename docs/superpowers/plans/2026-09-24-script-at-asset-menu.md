# Script At Asset Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the script editor's fixed `@` candidate strip with a cursor-anchored asset menu that resolves existing image assets and routes missing assets or images into the existing asset editor.

**Architecture:** `ScriptPage` retains token parsing, selection replacement and asset state. A focused `MentionAssetMenu` component receives a virtual caret anchor, filtered character/scene records and callbacks; it never owns asset persistence. The existing `EntityEditor` and `EntityImagePanel` continue to create assets and upload/generate primary images.

**Tech Stack:** React, Ant Design, existing ScriptPage entity helpers, Node built-in source tests, Vite.

## Global Constraints

- Work only on Git branch `v88`; commit source changes before public deployment.
- Reuse existing account-scoped character/scene, image upload and AI image generation paths.
- Do not modify batch-factory, Shuihuo production, H3 prompts, existing works, video records or presets.
- Keep user-entered `@名称` text unchanged when no asset or primary image can be resolved.
- Public release is SSH only; do not use GitHub Actions.

---

### Task 1: Define menu data and editor state

**Files:**
- Create: `frontend/src/user/components/MentionAssetMenu.jsx`
- Create: `frontend/src/user/components/mentionAssetMenu.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx:140-322`
- Test: `frontend/src/user/pages/scriptAtAssetMenu.source.test.js`

**Interfaces:**
- Consumes: `MentionTarget = { start, end, query, anchorRect }` and normalized entity records.
- Produces: `findMentionTarget(input, value)`, `filterMentionAssets(target, characters, scenes)`, and `MentionAssetMenu` callbacks `onSelect(asset)`, `onAddImage(asset)`, `onCreate(type, name)`.

- [ ] **Step 1: Write the failing test**

```js
test('uses a cursor anchor and separates image-ready assets from missing-image assets', () => {
  assert.match(page, /findMentionTarget\(input, value\)/);
  assert.match(page, /anchorRect/);
  assert.match(menu, /asset\.mainImageUrl/);
  assert.match(menu, /onAddImage\(asset\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/scriptAtAssetMenu.source.test.js`

Expected: FAIL because the parser and component do not exist.

- [ ] **Step 3: Write minimal implementation**

```js
export function findMentionTarget(input, value) {
  const caret = input?.selectionStart ?? String(value || '').length;
  const match = String(value || '').slice(0, caret).match(/@([\u4e00-\u9fffA-Za-z0-9_-]*)$/);
  return match ? { start: caret - match[0].length, end: caret, query: match[1], anchorRect: readCaretRect(input, caret) } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/user/pages/scriptAtAssetMenu.source.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/components/MentionAssetMenu.jsx frontend/src/user/components/mentionAssetMenu.js frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/scriptAtAssetMenu.source.test.js
git commit -m "feat(script): add anchored asset mention menu"
```

### Task 2: Reuse entity editor for create and add-image routes

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx:980-1037,1644-1664`
- Test: `frontend/src/user/pages/scriptAtAssetMenu.source.test.js`

**Interfaces:**
- Consumes: `onCreate(type, name)` and `onAddImage(asset)` from `MentionAssetMenu`.
- Produces: `addEntity(type, initialName = '')` and `openEntityEditor(type, id, options)`.

- [ ] **Step 1: Write the failing test**

```js
test('prefills the selected missing mention name when creating a character or scene', () => {
  assert.match(page, /function addEntity\(type, initialName = ''\)/);
  assert.match(page, /名称: initialName/);
  assert.match(page, /onCreate=\{\(type, name\) => addEntity\(type, name\)\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/scriptAtAssetMenu.source.test.js`

Expected: FAIL because new entities always start with an empty name.

- [ ] **Step 3: Write minimal implementation**

```js
function addEntity(type, initialName = '') {
  const data = type === 'characters'
    ? { 名称: initialName, 身份: '', 外形: '', 性格: '' }
    : { 名称: initialName, 时段: '', 氛围: '', 描述: '' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/user/pages/scriptAtAssetMenu.source.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/scriptAtAssetMenu.source.test.js
git commit -m "feat(script): route missing mentions to asset editor"
```

### Task 3: Integrate menu into both output editors and regression-check

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx:1398-1425`
- Modify: the existing script-page stylesheet containing `.legacy-output`
- Test: `frontend/src/user/pages/scriptAtAssetMenu.source.test.js`
- Test: `frontend/src/user/pages/scriptModelAndMention.source.test.js`

**Interfaces:**
- Consumes: the Task 1 menu and Task 2 callbacks.
- Produces: one `@` experience in complete-output and per-shot editors; no fixed candidate strip below either editor.

- [ ] **Step 1: Write the failing test**

```js
test('renders one anchored menu instead of the old fixed output candidate strip', () => {
  assert.match(page, /<MentionAssetMenu/);
  assert.doesNotMatch(page, /<Space wrap style=\{\{ marginBottom: 8 \}\}>/);
  assert.match(page, /onCreate=\{\(type, name\) => addEntity\(type, name\)\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/scriptAtAssetMenu.source.test.js`

Expected: FAIL because the old fixed strip still renders.

- [ ] **Step 3: Write minimal implementation**

```jsx
<MentionAssetMenu
  target={outputMention}
  characters={extractInfo.characters}
  scenes={extractInfo.scenes}
  onSelect={asset => insertOutputMention(formatEntity(asset))}
  onAddImage={asset => openEntityEditor(asset.type, asset.id, { focusImages: true })}
  onCreate={(type, name) => addEntity(type, name)}
/>
```

- [ ] **Step 4: Run scoped regression and build**

Run: `node --test frontend/src/user/pages/scriptAtAssetMenu.source.test.js frontend/src/user/pages/scriptModelAndMention.source.test.js frontend/src/user/pages/scriptModelSelection.test.js frontend/src/user/pages/scriptShotCardEdit.test.js routes/script-model-selection.source.test.js && npm --prefix frontend run build && git diff --check`

Expected: all tests pass, build exits 0, and no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/scriptAtAssetMenu.source.test.js frontend/src/user/pages/scriptModelAndMention.source.test.js
git commit -m "feat(script): use image-aware mention menu"
```

### Task 4: Publish the frontend-only release

**Files:**
- Modify: none in Git; publish the already committed `frontend/dist` overlay.

**Interfaces:**
- Consumes: the exact final `v88` commit SHA and current public Node image.
- Produces: public `/api/runtime-build-info` reporting that SHA and a verified authenticated `/script` page.

- [ ] **Step 1: Build the final frontend**

Run: `npm --prefix frontend run build`

Expected: exit 0.

- [ ] **Step 2: Deploy only the static frontend overlay by SSH**

Use the existing `v88-public` Node image as base, copy only `frontend/dist`, update `QIANTIE_NODE_IMAGE` and `QIANTIE_RELEASE_SHA`, then run `docker compose up -d --no-deps v88-node`.

- [ ] **Step 3: Verify public runtime and page**

Run: `curl -fsS http://115.190.156.223:3000/api/runtime-build-info`

Expected: `git_sha` equals the final committed SHA; refresh authenticated `/script`, put the caret after `@`, and verify image-ready assets, missing-image action, and create action appear without editing unrelated text.

