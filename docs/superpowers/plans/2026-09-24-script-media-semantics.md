# Script Media Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image generation and video generation use independent script media settings, including H3 orientation and resolution mapping.

**Architecture:** `scriptDefaults` remains the source of the independent image ratio, video ratio, and video resolution fields. A Node mapper translates only H3's video fields to its accepted horizontal or vertical resolution name. Seedance, YD, and the local executor receive the video settings unchanged.

**Tech Stack:** React, Node.js, node:test, Express.

## Global Constraints

- Image ratios are `16:9`, `9:16`, and `1:1`; they never affect video submission.
- Video ratios are `16:9` and `9:16`; video resolutions are `480p`, `720p`, and `1080p`.
- H3 maps `480p` to its 480 tier and `720p` or `1080p` to its 768 tier while preserving the selected video orientation.
- Existing tasks, assets, and saved defaults are not modified.
- The source reaches Git `v88` before deployment from the exact merged SHA.

---

### Task 1: H3 mapping helper and route regression test

**Files:**
- Modify: `routes/script-video.js:125-135,307-320`
- Modify: `routes/script-video.test.js`

**Interfaces:**
- Produces: `resolveH3VideoMedia({ aspectRatio, resolution }) -> { aspectRatio, resolution }`.

- [ ] **Step 1: Write the failing test**

```js
test('maps H3 video settings without reading the image ratio', () => {
  assert.deepEqual(resolveH3VideoMedia({ aspectRatio: '16:9', resolution: '1080p' }), { aspectRatio: '16:9', resolution: '768p横' });
  assert.deepEqual(resolveH3VideoMedia({ aspectRatio: '9:16', resolution: '480p' }), { aspectRatio: '9:16', resolution: '480p竖' });
});
```

- [ ] **Step 2: Verify RED**

Run `node --test --test-name-pattern='maps H3 video settings' routes/script-video.test.js` and expect failure because the mapper is absent.

- [ ] **Step 3: Implement the smallest mapper**

```js
function resolveH3VideoMedia({ aspectRatio, resolution } = {}) {
  const horizontal = aspectRatio === '16:9';
  const tier = resolution === '480p' ? '480p' : '768p';
  return { aspectRatio: horizontal ? '16:9' : '9:16', resolution: `${tier}${horizontal ? '横' : '竖'}` };
}
```

Use its `resolution` before the existing H3 request validator. Export it for the regression test.

- [ ] **Step 4: Verify GREEN**

Run `node --test routes/script-video.test.js` and expect all route tests to pass.

- [ ] **Step 5: Commit**

Commit `routes/script-video.js` and `routes/script-video.test.js` as `fix(script): map H3 video media settings`.

### Task 2: Independent UI payload and H3 capability copy

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx:570-581,1943-1948`
- Create: `frontend/src/user/pages/ScriptPage.media-settings.source.test.js`

**Interfaces:**
- Consumes: `scriptVideoAspectRatio`, `scriptVideoResolution`, and `scriptVideoModelKey`.
- Produces: an independent video payload and visible H3 mapping explanation.

- [ ] **Step 1: Write the failing source test**

```js
test('does not hard-code vertical H3 media settings', () => {
  assert.doesNotMatch(source, /minimax-h3-video' \? '480p竖'/);
  assert.match(source, /H3.*768p/);
  assert.match(source, /aspectRatio: scriptVideoAspectRatio/);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test frontend/src/user/pages/ScriptPage.media-settings.source.test.js` and expect the hard-coded H3 setting assertion to fail.

- [ ] **Step 3: Implement the smallest UI change**

Always send `scriptVideoResolution` and `scriptVideoAspectRatio` as the video payload. Add a short H3-only explanation beside unified video controls: selected orientation is preserved and 720p/1080p is submitted at H3's 768p tier. Do not send `scriptImageAspectRatio` in a video payload.

- [ ] **Step 4: Verify GREEN**

Run `node --test frontend/src/user/pages/ScriptPage.media-settings.source.test.js` and expect it to pass.

- [ ] **Step 5: Commit**

Commit the page and source test as `fix(script): keep video settings independent from images`.

### Task 3: Validate, integrate, and release from V88

**Files:**
- Verify: `routes/config.script-defaults.test.js`
- Verify: `routes/script-video.test.js`
- Verify: `frontend/src/user/pages/ScriptPage.media-settings.source.test.js`

- [ ] **Step 1: Run targeted tests and frontend build**

Run the config, route, and UI source test files together; then run the frontend Vite build and diff validation. All tests must pass and the build must exit 0.

- [ ] **Step 2: Push the exact V88 lineage**

Push the current commit to `v88`, fetch it, and verify the current commit is an ancestor of `origin/v88`.

- [ ] **Step 3: Deploy and verify exact SHA**

Deploy the frontend and Node runtime from the merged SHA only. Do not restart Go, Worker, compatibility service, or persistent volumes. Reload Nginx after Node recreation. Confirm build-info reports the merged SHA and public `/script` and `/shuihuo-production` return 200.
