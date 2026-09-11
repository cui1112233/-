# Script Entity Double-Column Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/script` 的人物/场景编辑弹窗中加入双栏布局，使左侧保留信息编辑，右侧支持主图预览、缩略图切换、放大、删除、上传和 AI 生成。

**Architecture:** 保留 `ScriptPage.jsx` 对人物字段和保存回调的所有权，把图片草稿规则提取到纯函数模块，把图片展示/交互提取为独立的 `EntityImagePanel`。图片接口通过统一的 `novelPanel` API 模块调用；编辑器关闭前只维护本地草稿，完成时一次性写回 `imageUrls` 与 `mainImageUrl`。

**Tech Stack:** React, Ant Design, lucide-react, Node test runner, existing authenticated `apiRequest` bridge, existing `/api/novel-panel/reference-assets/*` routes.

## Global Constraints

- 不改变人物/场景实体结构、分镜参考图匹配规则或 H3 请求协议。
- 图片预览必须走现有鉴权图片访问地址，不暴露受保护文件。
- AI 生成结果追加到图片列表，不覆盖已有主图。
- 删除图片只删除编辑草稿中的引用；本次不删除服务器物理文件。
- 不新增粘贴图片地址输入。
- 只提交本次功能相关文件，保留工作区其他未提交改动。

---

### Task 1: 建立图片草稿规则与 API 边界

**Files:**
- Create: `frontend/src/user/pages/scriptEntityImages.js`
- Create: `frontend/src/user/pages/scriptEntityImages.test.js`
- Create: `frontend/src/shared/api/novelPanel.js`

**Interfaces:**
- `normalizeEntityImages(entity) -> { imageUrls: string[], mainImageUrl: string }`
- `appendEntityImage(state, url) -> { imageUrls, mainImageUrl }`
- `selectEntityImage(state, url) -> { imageUrls, mainImageUrl }`
- `removeEntityImage(state, url) -> { imageUrls, mainImageUrl }`
- API exports `uploadReferenceAsset(payload)` and `generateReferenceAsset(payload)` returning the existing JSON response.

- [ ] **Step 1: Write failing unit tests** for empty state, single-image auto-main, append without replacing main, selection, deleting main with fallback, and deleting the final image.

```js
test('append selects the only image but preserves an existing main image', () => {
  assert.deepEqual(appendEntityImage({ imageUrls: ['a'], mainImageUrl: 'a' }, 'b'), {
    imageUrls: ['a', 'b'], mainImageUrl: 'a'
  });
});

test('removing the main image selects the next remaining image', () => {
  assert.deepEqual(removeEntityImage({ imageUrls: ['a', 'b'], mainImageUrl: 'a' }, 'a'), {
    imageUrls: ['b'], mainImageUrl: 'b'
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test frontend/src/user/pages/scriptEntityImages.test.js`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the pure image-state helpers**

Normalize URLs by trimming, removing blanks, and de-duplicating. If `mainImageUrl` is not in `imageUrls`, use the first image only when exactly one image exists; otherwise leave it empty until the user chooses a main image. `removeEntityImage` must choose the first remaining image when the removed URL was the main image.

- [ ] **Step 4: Implement authenticated API wrappers**

Use `apiRequest('/api/novel-panel/reference-assets/upload', { method: 'POST', body: JSON.stringify(payload) })` and the same pattern for `/generate`; do not log payloads or API keys.

- [ ] **Step 5: Run focused tests**

Run: `node --test frontend/src/user/pages/scriptEntityImages.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the isolated helper/API change**

```bash
git add frontend/src/user/pages/scriptEntityImages.js frontend/src/user/pages/scriptEntityImages.test.js frontend/src/shared/api/novelPanel.js
git commit -m "feat: add script entity image draft rules"
```

### Task 2: Build the right-side image panel

**Files:**
- Create: `frontend/src/user/components/EntityImagePanel.jsx`
- Create: `tests/script-entity-editor-images-ui.test.js`
- Modify: `frontend/src/shared/styles/global.css`
- Modify: `lib/novel-panel/premium-store.js`
- Modify: `routes/novel-panel.js`

**Interfaces:**
- Props: `{ assetType, assetId, fields, novelText, images, onChange, disabled }`.
- Calls `onChange({ imageUrls, mainImageUrl })` after local upload or generation succeeds.

- [ ] **Step 1: Write the UI contract tests** checking `.entity-editor-layout`, `.entity-editor-image-panel`, `主图预览`, `上传图片`, `AI生成`, thumbnail buttons, and delete controls.

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `node --test tests/script-entity-editor-images-ui.test.js`

Expected: FAIL because the component and class names do not exist.

- [ ] **Step 3: Add immutable image revisions at the storage boundary**

Extend the reference-asset storage contract so each upload or AI generation creates a unique `source`/candidate revision instead of overwriting the existing `main` file. Return the revision URL and keep the current `mainImageUrl` unchanged until the user selects the new thumbnail. Preserve existing `main`/`thumb` compatibility for older assets.

- [ ] **Step 4: Implement the panel**

Use Ant Design `Image` for clickable zoom preview, a hidden file input accepting PNG/JPEG/WebP, a large empty state when no main image exists, and a thumbnail grid. Clicking a thumbnail calls `selectEntityImage`; delete buttons call `removeEntityImage` and stop propagation. Upload the file as a data URL with `{ asset_type: assetType === 'characters' ? 'character' : 'scene', asset_id: assetId, variant: 'source', data_url }`; add the returned URL to the draft. Generate with `{ asset_type, asset_id, description: Object.values(fields).join('\\n'), novel_text: novelText }` and append the returned URL.

- [ ] **Step 5: Add authenticated preview loading and responsive styles**

Load protected image URLs through the existing authenticated bridge and render object URLs, revoking them on replacement/unmount. Create a two-column grid with a minimum left width of 0 and a fixed right preview column on desktop; switch to one column under 720px. Mark the main thumbnail with an accent border and keep delete controls as sibling controls rather than nested interactive elements.

- [ ] **Step 6: Run the UI contract test**

Run: `node --test tests/script-entity-editor-images-ui.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the panel**

```bash
git add frontend/src/user/components/EntityImagePanel.jsx tests/script-entity-editor-images-ui.test.js frontend/src/shared/styles/global.css
git commit -m "feat: add script entity image panel"
```

### Task 3: Integrate the panel into the editor without changing save semantics

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `tests/script-entity-management.test.js`

**Interfaces:**
- `EntityEditor` owns `{ fields, imageUrls, mainImageUrl }` draft state.
- Existing `onChange(fields)` callback receives a merged object containing image fields.

- [ ] **Step 1: Add an integration assertion** that the editor renders the image panel and that the completion callback includes `imageUrls` and `mainImageUrl`.

- [ ] **Step 2: Run the focused integration test and verify it fails**

Run: `node --test tests/script-entity-management.test.js`

Expected: FAIL because `EntityEditor` currently only renders the field list and only saves `fields`.

- [ ] **Step 3: Integrate draft image state**

Initialize image state with `normalizeEntityImages(entity)`, render the field editor and enrichment actions in the left column, render `EntityImagePanel` in the right column, and call `onChange({ ...fields, imageUrls, mainImageUrl })` on completion. Reset image state whenever a new entity is opened. Keep delete entity, fullscreen, enrichment, and cancel behavior unchanged.

- [ ] **Step 4: Preserve entity compatibility**

Ensure string-only legacy entities still render a description field and can save with `imageUrls: []` and `mainImageUrl: ''`. Ensure new entities receive a stable temporary asset ID for upload/generation and that image operations are disabled until the entity has an ID; after completion, normal entity creation remains unchanged.

- [ ] **Step 5: Run the integration test**

Run: `node --test tests/script-entity-management.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the integration**

```bash
git add frontend/src/user/pages/ScriptPage.jsx tests/script-entity-management.test.js
git commit -m "feat: integrate double-column script entity editor"
```

### Task 4: Full verification and merge preparation

**Files:**
- Modify only files from Tasks 1–3 if verification exposes a defect.

- [ ] **Step 1: Run all focused tests**

Run: `node --test frontend/src/user/pages/scriptEntityImages.test.js tests/script-entity-editor-images-ui.test.js tests/script-entity-management.test.js tests/script-shot-output-ui-contract.test.js`

Expected: PASS.

- [ ] **Step 2: Run the frontend build**

Run: `npm --prefix frontend run build`

Expected: successful production bundle.

- [ ] **Step 3: Inspect the diff**

Run: `git diff --check HEAD~3..HEAD` and `git status --short`.

Expected: no whitespace errors; unrelated existing modifications remain untouched.

- [ ] **Step 4: Verify the final behavior**

Open `/script`, edit both a character and a scene, verify empty state, upload, AI generation, thumbnail selection, zoom preview, delete fallback, cancel, and save. Confirm the resulting scene/character data still feeds the existing storyboard reference logic.

- [ ] **Step 5: Merge only the feature commits**

If the current branch is the intended integration branch, fast-forward the feature commits already on it and report the commit IDs. Do not reset, force-push, or stage unrelated worktree files. If a separate target branch is required, merge the three feature commits with `git merge --no-ff` only after confirming its exact name.
