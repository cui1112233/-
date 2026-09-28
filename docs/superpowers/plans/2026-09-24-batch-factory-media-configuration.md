# Batch Factory Media Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Batch Factory independent image aspect ratio, video aspect ratio, and video resolution settings without changing existing batches or allowing square video output.

**Architecture:** Normalize the three new values at the Batch Factory settings boundary, retaining `aspectRatio` only as a backward-compatibility input. The UI reads/writes the new fields in batch-wide and book override forms. Image jobs receive `imageAspectRatio`; video compilation/submission receives `videoAspectRatio` and `videoResolution`.

**Tech Stack:** React, Ant Design, Node.js/Express, Batch Factory V11 bridge, node:test.

## Global Constraints

- Canonical maintained source is Git branch `v88`; production is a runtime copy only.
- Existing works, batches, books, videos, presets, automation, and publication settings must not be rewritten.
- Image aspect ratios are exactly `16:9`, `9:16`, `1:1`.
- Video aspect ratios are exactly `16:9`, `9:16`; square video is never submitted.
- Video resolutions are exactly `480p`, `720p`, `1080p`.
- Legacy `aspectRatio: '1:1'` becomes `videoAspectRatio: '9:16'` only as a read-time fallback.

---

### Task 1: Normalize independent media settings and video compilation

**Files:**
- Modify: `lib/batch-factory/store.js:normalizeSettings`
- Modify: `lib/batch-factory/video-prompt-compiler.js:compileVideoPrompt`
- Create: `lib/batch-factory/media-settings.js`
- Test: `lib/batch-factory/media-settings.test.js`
- Test: `lib/batch-factory/video-prompt-compiler.test.js`

**Interfaces:**
- Produces `normalizeMediaSettings(value)` returning `{ imageAspectRatio, videoAspectRatio, videoResolution }`.
- `compileVideoPrompt({ settings })` consumes `settings.videoAspectRatio` and emits `aspect_ratio` plus `resolution`.

- [ ] **Step 1: Write failing normalization tests**

```js
assert.deepEqual(normalizeMediaSettings({ aspectRatio: '1:1' }), {
  imageAspectRatio: '1:1', videoAspectRatio: '9:16', videoResolution: '720p'
});
assert.deepEqual(normalizeMediaSettings({ imageAspectRatio: '16:9', videoAspectRatio: '16:9', videoResolution: '1080p' }), {
  imageAspectRatio: '16:9', videoAspectRatio: '16:9', videoResolution: '1080p'
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `node --test lib/batch-factory/media-settings.test.js`

Expected: failure because `media-settings.js` does not exist.

- [ ] **Step 3: Add the pure normalizer and wire it into stored settings**

```js
function normalizeMediaSettings(value = {}) {
  const legacy = ['16:9', '9:16', '1:1'].includes(value.aspectRatio) ? value.aspectRatio : '9:16';
  return {
    imageAspectRatio: ['16:9', '9:16', '1:1'].includes(value.imageAspectRatio) ? value.imageAspectRatio : legacy,
    videoAspectRatio: ['16:9', '9:16'].includes(value.videoAspectRatio) ? value.videoAspectRatio : (legacy === '16:9' ? '16:9' : '9:16'),
    videoResolution: ['480p', '720p', '1080p'].includes(value.videoResolution) ? value.videoResolution : '720p'
  };
}
```

Spread the result from `normalizeSettings`; change `compileVideoPrompt` to use `videoAspectRatio` and add `resolution` to its returned object.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test lib/batch-factory/media-settings.test.js lib/batch-factory/video-prompt-compiler.test.js`

Commit: `git commit -m "feat(batch-factory): separate image and video media settings"`

### Task 2: Carry separate settings to image and video execution paths

**Files:**
- Modify: `routes/batch-factory-v11.js:generateBatchFactoryAssetImages`
- Modify: `routes/batch-factory-v11.js:batchAssetImageGenerationPath handler`
- Modify: `lib/batch-factory/video-prompt-compiler.js:compileVideoPrompt`
- Test: `routes/batch-factory-v11.test.js`

**Interfaces:**
- Image endpoint accepts `imageAspectRatio` and continues accepting legacy `aspectRatio`.
- Video task payload consumes `videoAspectRatio` and `videoResolution`; no request with `1:1` video aspect ratio is constructed.

- [ ] **Step 1: Add failing route tests**

```js
assert.equal(imageRequest.aspectRatio, '1:1');
assert.equal(videoRequest.aspect_ratio, '16:9');
assert.equal(videoRequest.resolution, '1080p');
assert.notEqual(videoRequest.aspect_ratio, '1:1');
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test routes/batch-factory-v11.test.js`

Expected: current code only passes shared `aspectRatio` and omits resolution.

- [ ] **Step 3: Implement parameter forwarding**

Pass `req.body.imageAspectRatio || req.body.aspectRatio` to asset generation. Ensure all provider submit calls use the compiler return object’s `aspect_ratio` and `resolution`, rather than reading legacy `aspectRatio` directly.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test routes/batch-factory-v11.test.js lib/batch-factory/media-settings.test.js`

Commit: `git commit -m "fix(batch-factory): submit independent media parameters"`

### Task 3: Expose settings in batch-wide unified configuration and book overrides

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx:BatchFactoryEngineSettingsForm`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryEngineSettingsDrawer.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/batchFactoryBookConfigRegions.js`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`
- Test: `frontend/src/user/pages/shuihuo/batchFactoryBookConfigRegions.test.js`

**Interfaces:**
- Forms save `imageAspectRatio`, `videoAspectRatio`, `videoResolution` at batch level.
- Book-level fields inherit the batch values until explicitly overridden.

- [ ] **Step 1: Add failing source and region tests**

```js
assert.match(source, /图片画幅/);
assert.match(source, /视频画幅/);
assert.match(source, /视频分辨率/);
assert.match(regionKeys, /imageAspectRatio/);
assert.match(regionKeys, /videoAspectRatio/);
assert.match(regionKeys, /videoResolution/);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/batchFactoryBookConfigRegions.test.js`

Expected: fields are absent.

- [ ] **Step 3: Replace shared controls with independent controls**

Use `Segmented` controls:

```jsx
<Segmented value={value.imageAspectRatio || value.aspectRatio || '9:16'} options={['16:9', '9:16', '1:1']} onChange={imageAspectRatio => patch({ imageAspectRatio })} />
<Segmented value={value.videoAspectRatio || (value.aspectRatio === '16:9' ? '16:9' : '9:16')} options={['16:9', '9:16']} onChange={videoAspectRatio => patch({ videoAspectRatio })} />
<Segmented value={value.videoResolution || '720p'} options={['480p', '720p', '1080p']} onChange={videoResolution => patch({ videoResolution })} />
```

Keep legacy `aspectRatio` untouched when editing existing batches; only new fields are written.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/batchFactoryBookConfigRegions.test.js`

Commit: `git commit -m "feat(batch-factory): add independent media controls"`

### Task 4: Full verification and release

**Files:**
- Modify: none unless a targeted regression is found.

- [ ] **Step 1: Run all touched focused tests**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test lib/batch-factory/media-settings.test.js lib/batch-factory/video-prompt-compiler.test.js routes/batch-factory-v11.test.js frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/batchFactoryBookConfigRegions.test.js`

Expected: zero failures.

- [ ] **Step 2: Build the frontend**

Run: `npm --prefix frontend run build && git diff --check`

Expected: Vite build succeeds; only generated `frontend/dist` changes remain unstaged.

- [ ] **Step 3: Integrate to canonical branch**

Run: `git push origin HEAD:v88 && git fetch origin v88 && git merge-base --is-ancestor HEAD origin/v88`

Expected: exit code 0 and remote `v88` has the exact release SHA.

- [ ] **Step 4: Deploy only the V88 Node release and verify**

Build or stage from the exact `origin/v88` SHA, recreate only `v88-node` without `--remove-orphans`, then verify public `/api/build-info` reports that SHA and `/shuihuo-production` returns HTTP 200.

- [ ] **Step 5: Authenticated acceptance**

In Batch Factory unified configuration, save image `1:1`, video `16:9`, and `1080p`; reopen it to confirm values persist. Create one image request and one video request, verifying image receives `1:1` while video receives `16:9 / 1080p`.
