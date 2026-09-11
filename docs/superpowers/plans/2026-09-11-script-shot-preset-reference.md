# 剧本分镜预设参考图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复并改造剧本分镜的参考图链路，使其按水货生产的预设名称标签自动绑定人物/场景，并让所有视频模型明确处理参考图能力。

**Architecture:** 将实体匹配和主图筛选集中在 `scriptVideoReferences.js`，由 `ScriptPage` 在渲染分镜和提交视频任务时复用同一份结果。`ShotOutputCards` 只负责显示预设名称标签，不持有星标或总开关状态；`routes/script-video.js` 负责校验图片能力并返回可识别的“不支持参考图”状态，前端在确认后才降级为空参考图。

**Tech Stack:** React, Ant Design, Express, Node.js built-in test runner, Vitest/Vite SSR contract tests, Git, Docker/ECS release scripts already present in the repository.

## Global Constraints

- 分镜标签必须显示在分镜卡片第一行，位于分镜标题与操作按钮之间。
- 标签复用水货生产的预设名称展示语义，不显示图片、不显示星标、不增加总开关。
- 只匹配当前分镜中实际出现的人物/场景名称或别名。
- 没有明确 `mainImageUrl` 的对象不显示、不绑定、不发送。
- 人物优先、场景其次、主图 URL 去重、最多 9 张。
- 所有视频模型统一接收参考图列表；模型不支持时返回明确状态，不得静默丢弃。
- 使用精确文案：`当前视频模型不支持参考图，是否允许无参考图生成`。
- 保留工作区已有改动，不使用 `git reset --hard`、`git checkout --` 或 `docker compose down -v`。
- 不提交 API Key、密码、私钥或其他凭据。

---

### Task 1: 建立自动预设绑定纯函数

**Files:**
- Create: `frontend/src/user/pages/scriptVideoReferences.js`
- Test: `frontend/src/user/pages/scriptVideoReferences.test.js`

**Interfaces:**
- Consumes: `shotText`, `extractInfo.characters`, `extractInfo.scenes`, each entity's name/alias fields and `mainImageUrl`.
- Produces: `collectShotReferenceDescriptors({ shotText, extractInfo, shotIndex }) -> Array<{ url, label, type }>` and `collectShotReferenceImages(options) -> string[]`.

- [ ] **Step 1: Write failing tests for strict matching and ordering**

```js
test('matches only named image-backed characters and scenes', async () => {
  const { collectShotReferenceDescriptors } = await import('./scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({
    shotText: '张高走进医院走廊。',
    extractInfo: {
      characters: [
        { id: 'c1', data: { 名称: '张高' }, mainImageUrl: 'https://img.example/zhang.png' },
        { id: 'c2', data: { 名称: '林悦' }, mainImageUrl: 'https://img.example/lin.png' }
      ],
      scenes: [{ id: 's1', data: { 场景名称: '医院走廊' }, mainImageUrl: 'https://img.example/hospital.png' }]
    }
  });
  assert.deepEqual(refs.map(item => item.label), ['张高', '医院走廊']);
});

test('does not fall back to unrelated image-backed entities', async () => {
  const { collectShotReferenceDescriptors } = await import('./scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({
    shotText: '一名年轻人抬头。',
    extractInfo: { characters: [{ data: { 名称: '张高' }, mainImageUrl: 'https://img.example/zhang.png' }] }
  });
  assert.deepEqual(refs, []);
});

test('matches aliases, removes duplicate URLs, and caps at nine', async () => {
  const { collectShotReferenceDescriptors } = await import('./scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({ shotText: '小张在客厅。', extractInfo: {
    characters: [{ data: { 名称: '张高', 别名: '小张' }, mainImageUrl: 'https://img.example/shared.png' }],
    scenes: [{ data: { 名称: '客厅' }, mainImageUrl: 'https://img.example/shared.png' }]
  }});
  assert.deepEqual(refs.map(item => item.label), ['张高']);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js`

Expected: FAIL because the helper file and exported collector do not yet exist.

- [ ] **Step 3: Implement the minimal pure helper**

Implement `entityData`, `entityNameCandidates`, `getEntityMedia`, `collectShotReferenceDescriptors`, and `collectShotReferenceImages`. Use the entity's primary name as `label`, accept legacy Chinese/English name fields and aliases, match any candidate against the current `shotText`, then filter missing/duplicate main-image URLs and slice to 9. Do not inspect other shots and do not include an all-image fallback.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js`

Expected: PASS for strict matching, no fallback, aliases, ordering, deduplication, and the nine-image cap.

- [ ] **Step 5: Commit the helper and tests**

```bash
git add frontend/src/user/pages/scriptVideoReferences.js frontend/src/user/pages/scriptVideoReferences.test.js
git commit -m "feat: add strict script preset reference matching"
```

### Task 2: Replace shot-card reference UI with preset name tags

**Files:**
- Modify: `frontend/src/user/components/ShotOutputCards.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Test: `tests/script-shot-output-ui-contract.test.js`
- Test: `tests/script-reference-thumbnail-contract.test.js`

**Interfaces:**
- Consumes: `cards`, `extractInfo`, and the collector from Task 1.
- Produces: a first-row `<div>` containing one plain preset-name tag per current shot reference; no reference state callback is required.

- [ ] **Step 1: Add failing source-contract assertions**

Assert that the card source imports `collectShotReferenceDescriptors`, renders `reference.label` in a preset tag located in the card header, contains neither `Star` nor `Switch` nor `onToggleReferenceImages`, and does not use `AntImage` for shot references. Assert that the empty reference section is not rendered when the collector returns no entries.

- [ ] **Step 2: Run the focused UI contract tests to verify the old implementation fails**

Run: `node --test tests/script-shot-output-ui-contract.test.js tests/script-reference-thumbnail-contract.test.js`

Expected: FAIL against the current minimal card component because it has no reference tags and current historical expectations still describe the removed star UI.

- [ ] **Step 3: Implement the preset-tag row**

Add a `references` value from `collectShotReferenceDescriptors({ shotText: card, extractInfo, shotIndex: index })`. Render it inside the existing header before the action `<Space>` using a class such as `script-shot-preset-tags`; each item is a non-icon button or tag-like element containing only `reference.label`. Do not add a card-level switch, per-tag star, `aria-pressed`, or disabled URL state.

- [ ] **Step 4: Add waterhuo-style tag CSS**

Add compact inline-flex tags with the existing dark-panel palette, rounded border, readable name text, and no image background. Keep wrapping safe for long names and prevent the action buttons from being pushed off-screen by using flex wrapping/min-width rules.

- [ ] **Step 5: Run UI contract tests and update stale assertions**

Run: `node --test tests/script-shot-output-ui-contract.test.js tests/script-reference-thumbnail-contract.test.js`

Expected: PASS with assertions aligned to the name-tag design; no test may require stars, a total switch, or image thumbnails in shot cards.

- [ ] **Step 6: Commit the shot-card presentation**

```bash
git add frontend/src/user/components/ShotOutputCards.jsx frontend/src/shared/styles/global.css tests/script-shot-output-ui-contract.test.js tests/script-reference-thumbnail-contract.test.js
git commit -m "feat: show script shot preset name tags"
```

### Task 3: Wire the same binding into ScriptPage generation and persistence

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/shared/api/scriptVideo.js`
- Test: `tests/script-reference-generation-contract.test.js`

**Interfaces:**
- Consumes: `collectShotReferenceImages` from Task 1 and the existing `createScriptVideo` API wrapper.
- Produces: `createScriptVideo({ prompt, modelKey, imageUrls })` with a per-shot list derived from the same collector rendered by the card.

- [ ] **Step 1: Write failing generation contract tests**

```js
test('script page renders tags from extract info and sends the same current-shot main images', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /collectShotReferenceImages/);
  assert.match(page, /imageUrls/);
  assert.match(page, /extractInfo/);
  assert.match(page, /shotIndex: index/);
});

test('script video API accepts imageUrls in its request payload', () => {
  const api = read('frontend/src/shared/api/scriptVideo.js');
  assert.match(api, /JSON\.stringify\(payload\)/);
});
```

- [ ] **Step 2: Run the focused contract test to verify it fails**

Run: `node --test tests/script-reference-generation-contract.test.js`

Expected: FAIL because `ScriptPage` currently submits only `{ prompt, modelKey }` and does not pass `extractInfo` to `ShotOutputCards`.

- [ ] **Step 3: Wire the collector into the page**

Import `collectShotReferenceImages`. Pass `extractInfo` to `ShotOutputCards`. In `generateVideoForShot`, compute `imageUrls: collectShotReferenceImages({ shotText: prompt, extractInfo, shotIndex: index })` and include it in `createScriptVideo`. Remove any legacy reference state, total-switch callbacks, and persistence fields if present; the displayed tags and payload must be derived from the same current data.

- [ ] **Step 4: Preserve history compatibility without stale toggle behavior**

Keep existing `extractInfo`, `output`, and `videoTasks` history fields. Ignore old `shotReferenceStates` data on restore so old star/total-switch state cannot disable or inject references. When a history entry is restored, tags are recalculated from its restored `extractInfo` and output.

- [ ] **Step 5: Run the focused generation contract test**

Run: `node --test tests/script-reference-generation-contract.test.js`

Expected: PASS and the page source contains one collector path shared by UI data and video payload data.

- [ ] **Step 6: Commit the page wiring**

```bash
git add frontend/src/user/pages/ScriptPage.jsx frontend/src/shared/api/scriptVideo.js tests/script-reference-generation-contract.test.js
git commit -m "feat: send automatic shot preset references"
```

### Task 4: Return explicit unsupported-reference status and confirmation fallback

**Files:**
- Modify: `routes/script-video.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Test: `tests/script-video-route.test.js`

**Interfaces:**
- Consumes: request body `{ prompt, modelKey, imageUrls, allowWithoutReferences }`.
- Produces: HTTP 409 JSON `{ ok: false, code: 'UNSUPPORTED_REFERENCE_IMAGES', status: 'unsupported_reference_images', error: '当前视频模型不支持参考图，是否允许无参考图生成' }` when image URLs exist and the selected adapter cannot accept them; a normal 202 task response only after `allowWithoutReferences === true` or when no URLs exist.

- [ ] **Step 1: Add failing route tests**

Add route-level coverage that a non-image-capable model with non-empty `imageUrls` returns HTTP 409 and the exact message without calling the provider; the same request with `allowWithoutReferences: true` submits with `image_urls` containing only the existing required first-frame URL; a capable model receives the supplied URLs.

- [ ] **Step 2: Run route tests to verify the new cases fail**

Run: `node --test tests/script-video-route.test.js`

Expected: FAIL because the current route always submits the configured YD payload and has no explicit capability/confirmation contract.

- [ ] **Step 3: Implement capability normalization and the 409 response**

Add a small route-local capability resolver for known script-video model keys. Treat the local executor as its existing bridge path; for provider adapters, require an explicit `supportsReferenceImages`/equivalent model capability input or the configured compatible default. If `imageUrls.length > 0`, capability is false, and `allowWithoutReferences` is not true, return the exact 409 JSON response before provider submission. If allowed, submit only the required default first-frame URL.

- [ ] **Step 4: Handle the frontend confirmation once**

In `generateVideoForShot`, submit with `imageUrls`. When the API error code is `UNSUPPORTED_REFERENCE_IMAGES`, open an Ant Design confirmation modal using the exact message. The “允许无参考图生成” action retries the same request with `imageUrls: []` and `allowWithoutReferences: true`; “取消生成” stops without creating a task. Prevent duplicate submissions while the modal/retry is active.

- [ ] **Step 5: Run route and page tests**

Run: `node --test tests/script-video-route.test.js tests/script-reference-generation-contract.test.js`

Expected: PASS for supported models, unsupported models, cancellation, and explicit no-reference fallback.

- [ ] **Step 6: Commit unsupported-model handling**

```bash
git add routes/script-video.js frontend/src/user/pages/ScriptPage.jsx tests/script-video-route.test.js
git commit -m "feat: confirm no-reference fallback for video models"
```

### Task 5: Full local verification and merge preparation

**Files:**
- Modify only files from Tasks 1–4 if test-driven corrections are required.
- Review: `git diff origin/integration/remote-workbench-20260819...HEAD`

- [ ] **Step 1: Run all focused tests**

Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js tests/script-reference-generation-contract.test.js tests/script-shot-output-ui-contract.test.js tests/script-reference-thumbnail-contract.test.js tests/script-video-route.test.js`

Expected: PASS with no tests requiring stars, total switches, generic fallback, or shot-card thumbnails.

- [ ] **Step 2: Run the frontend build**

Run: `npm --prefix frontend run build`

Expected: exit code 0 and a refreshed `frontend/dist` generated by the repository's normal build command.

- [ ] **Step 3: Inspect the final diff and existing worktree changes**

Run: `git status --short` and `git diff --check HEAD~4..HEAD`.

Expected: only the five feature commits contain the implementation changes; unrelated pre-existing modifications remain un-staged and uncommitted.

- [ ] **Step 4: Create a merge commit or fast-forward only after review**

Compare the feature commits against the current integration branch and merge only the validated commits into the requested release branch. Do not force-push and do not overwrite unrelated user changes.

### Task 6: ECS staged deployment and public verification

**Files/Systems:**
- Review deployment scripts and Docker/Compose files already in the repository.
- Modify no deployment configuration unless required by the validated build.

- [ ] **Step 1: Identify the exact target branch/SHA and current public baseline**

Record `git rev-parse HEAD`, the image tag/digest, and the public `/api/build-info` result separately. Do not treat local build success as public deployment.

- [ ] **Step 2: Build and stage the exact image**

Use the repository's existing manual ECS deployment method, tag the image with the validated SHA, and start it on an isolated staging port or isolated container name before touching the public container.

- [ ] **Step 3: Verify staged behavior**

Check authenticated script loading, generated shot-card name tags, absence of star/total-switch controls, strict image matching, supported-model reference submission, and the exact unsupported-model confirmation response.

- [ ] **Step 4: Cut over only after staged checks pass**

Update the public service using the existing reversible deployment procedure, then verify the served build-info SHA, HTML/JS assets, authenticated `/script` route, and one real video request path. Keep the previous image/container available for rollback.

- [ ] **Step 5: Report release evidence**

Report Git SHA, image digest, ECS container/service status, public build-info, and behavior checks separately. Do not claim complete release from build, HTTP 200, health check, or image existence alone.

