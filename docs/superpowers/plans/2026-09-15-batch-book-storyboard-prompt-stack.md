# Batch Book Storyboard Prompt Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each batch-book prompt cell as a horizontal storyboard viewer with stacked video/visual cards and scoped media actions.

**Architecture:** `InlineBookPrompts` retains the selected `video.id` and introduces one book-level `promptKind` viewing mode plus a local opened state. It derives available text from the selected VIDEO, passes explicit current-book/current-video callbacks upward, and uses the existing `saveVideoOverride`, production-stage, and modal state paths. The stylesheet replaces the generic Ant tabs with a two-layer card control and an expanded action panel.

**Tech Stack:** React, Ant Design, lucide/Ant Design icons, existing V11 API helpers, Node source tests, CSS.

## Global Constraints

- Outer workbench remains one row per novel; only its prompt cell changes.
- `分镜 : VIDEO = 1 : 1` remains a data rule and is not rendered as `分镜01 → VIDEO01` text.
- Opening and horizontal navigation default to video-prompt mode.
- Viewing mode is book-level: while visual mode is active, previous/next shows each storyboard's visual prompt; while video mode is active, it shows each storyboard's video prompt.
- The right corner always shows two stacked cards: video is pale blue, visual is pale green. Visual is actionable only when the selected storyboard has visual text.
- A missing video prompt displays `请生成视频提示词再查看`; no empty editor or fake action may appear.
- Expanded actions are limited to the selected storyboard and current media type. Video actions and visual actions never share candidate versions or overwrite each other.
- Regeneration controls are icon buttons. All generation remains subject to existing model/capability gates.

---

### Task 1: Add derived prompt-card state and regression tests

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx:336-366`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Interfaces:**
- Consumes: `book.videos[]` records with `id`, `videoPrompt`, `visualPrompt`, and `revision`.
- Produces: `InlineBookPrompts({ book, batchId, onSaved, onManage, onRegenerateVideo, onGenerateVideo, onViewVideoCandidates, onRegenerateVisual, onGenerateVisual, onViewVisualCandidates, ...capabilities })`.
- Maintains: `selectedVideoId`, `promptKind: 'video' | 'visual'`, and `opened: boolean` for one book row.

- [ ] **Step 1: Write failing source tests for the interaction contract**

Add tests that assert all of the following source-level contracts:

```js
assert.match(source, /const \[promptKind, setPromptKind\] = useState\('video'\)/);
assert.match(source, /const hasVisualPrompt = Boolean\(String\(visualPrompt \|\| ''\)\.trim\(\)\)/);
assert.match(source, /请生成视频提示词再查看/);
assert.match(source, /batch-factory-prompt-stack/);
assert.match(source, /batch-factory-prompt-card is-video/);
assert.match(source, /batch-factory-prompt-card is-visual/);
assert.match(source, /aria-label="重新生成视频提示词"/);
assert.match(source, /aria-label="重新生成画面提示词"/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
```

Expected: the new stacked-card test fails because the old component starts in `visual` mode and renders generic tabs.

- [ ] **Step 3: Replace generic tabs with explicit view state**

In `InlineBookPrompts`, initialize with:

```jsx
const [promptKind, setPromptKind] = useState('video');
const [opened, setOpened] = useState(false);
const hasVisualPrompt = Boolean(String(visualPrompt || '').trim());
const activePrompt = promptKind === 'visual' ? visualPrompt : videoPrompt;
const canOpenActivePrompt = promptKind === 'visual' ? hasVisualPrompt : Boolean(String(videoPrompt || '').trim());
```

On `book.id` change, reset `selectedVideoId` to its first VIDEO, `promptKind` to `video`, and `opened` to `false`. On previous/next selection, preserve `promptKind` and reset only `opened` to `false` so navigation stays in the selected media mode without exposing actions automatically.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
```

Expected: PASS including the new prompt-stack assertions.

- [ ] **Step 5: Commit Task 1**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
git commit -m "feat: track batch storyboard prompt card state"
```

### Task 2: Render the stacked cards and scoped expanded controls

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx:336-366`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx:786`
- Modify: `frontend/src/user/pages/shuihuo-production.css:543-553`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Interfaces:**
- Consumes: Task 1's `promptKind`, `opened`, `hasVisualPrompt`, current `video`, `saveVideoOverride`.
- Produces: a `batch-factory-prompt-stack` header with previous/next controls and always-visible blue/green stacked card buttons; an expanded action surface only after the selected active card is opened.
- Calls upward: `onManage(video.id)` for the centered editor; scoped callbacks use the current `video.id`.

- [ ] **Step 1: Write failing source tests for expanded-state separation**

Add assertions:

```js
assert.match(source, /onClick=\{\(\) => setOpened\(true\)\}/);
assert.match(source, /promptKind === 'video' \? '保存视频提示词' : '保存画面提示词'/);
assert.match(source, /生成视频/);
assert.match(source, /生成图片/);
assert.match(source, /查看视频候选版本/);
assert.match(source, /查看画面候选版本/);
assert.doesNotMatch(source, /图片提示词 · \{storyboardVideoLabel/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
```

Expected: the expanded-state separation test fails until old inline label/actions are removed.

- [ ] **Step 3: Render the interaction exactly by media type**

Replace the old toolbar, label and action row with:

```jsx
<div className="batch-factory-prompt-stack">
  <div className="batch-factory-prompt-navigation">{/* previous/next only */}</div>
  <div className="batch-factory-prompt-cards">
    <button className="batch-factory-prompt-card is-visual" disabled={!hasVisualPrompt} onClick={() => { if (hasVisualPrompt) { setPromptKind('visual'); setOpened(true); } }}>画面提示词</button>
    <button className="batch-factory-prompt-card is-video" onClick={() => { setPromptKind('video'); setOpened(true); }}>视频提示词</button>
  </div>
</div>
```

Render the inactive card first and active card last so the active card sits on top. When `opened && canOpenActivePrompt`, show the current text area and a media-specific action row. When video mode lacks a prompt, render `请生成视频提示词再查看` and only its icon regeneration action. When visual mode lacks a prompt, it cannot be selected, so no empty visual view exists.

Use Ant `ReloadOutlined` icon-only buttons with exact accessible labels `重新生成视频提示词` and `重新生成画面提示词`. Keep save/update calls as `saveVideoOverride(..., { patch: promptKind === 'video' ? { videoPrompt } : { visualPrompt }, ... })` so a video save cannot rewrite a visual prompt and vice versa.

- [ ] **Step 4: Pass real per-VIDEO callbacks at the workbench row**

At the row rendering point, pass callbacks that call existing helpers with the row book and current `video.id`:

```jsx
onRegenerateVideo={videoId => runBookStageAction(book, 'director', 'force', videoId)}
onGenerateVideo={videoId => runBookStageAction(book, 'video', 'missing', videoId)}
onViewVideoCandidates={videoId => { setPromptVideoId(videoId); setMediaBook(book); }}
onRegenerateVisual={videoId => runBookStageAction(book, 'director', 'force', videoId)}
onGenerateVisual={videoId => runBookStageAction(book, 'image', 'missing', videoId)}
onViewVisualCandidates={videoId => { setPromptVideoId(videoId); setMediaBook(book); }}
```

Before final code, inspect existing `runBookStageAction` stage support. If the service does not expose a distinct image action, disable the image button with the actual capability reason instead of passing an unsupported stage. The visual candidate callback must be wired to a media-version view that filters current `video.id` plus visual media type; do not reuse video candidates.

- [ ] **Step 5: Add stacked-card CSS**

Replace `.batch-factory-inline-prompt-tabs` styles with scoped rules:

```css
.batch-factory-prompt-cards { position: relative; width: 150px; height: 34px; }
.batch-factory-prompt-card { position: absolute; top: 0; right: 0; border-radius: 12px 12px 8px 8px; }
.batch-factory-prompt-card.is-video { background: #d9eeff; color: #24658f; }
.batch-factory-prompt-card.is-visual { right: 18px; top: 5px; background: #dff7ea; color: #277a57; }
.batch-factory-prompt-card.is-active { z-index: 2; transform: translateY(-2px); }
```

Add dark-theme border/shadow, disabled green-card opacity, focus rings, and responsive widths. The navigation contains only accessible left/right icon buttons; omit any `1/5`, label, or `分镜 → VIDEO` mapping string.

- [ ] **Step 6: Run tests and production build**

Run:

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
npm run build --prefix frontend
```

Expected: all source tests pass and Vite exits 0.

- [ ] **Step 7: Commit Task 2**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo-production.css frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
git commit -m "feat: add batch storyboard prompt stack"
```

### Task 3: Verify scoped behavior in the local candidate runtime

**Files:**
- Modify: none unless verification exposes a defect.
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Interfaces:**
- Consumes: completed prompt stack and existing local candidate at `http://127.0.0.1:5173/shuihuo-production`.
- Produces: browser evidence that stacked cards, book-level media mode, and scoped control visibility match the design.

- [ ] **Step 1: Build and replace only the local platform service**

Run the existing local review compose build/up command for `platform` with its current `qiantie-v88-local-13188` project and `deploy/local/docker-compose.batch-factory-v11.preview.yml`. Do not include `--remove-orphans` and do not operate on public ECS services.

- [ ] **Step 2: Inspect a book with multiple VIDEO records**

Open `http://127.0.0.1:5173/shuihuo-production` in the authenticated local browser and inspect one book with at least two VIDEO records.

Expected:

```text
right corner: blue video card in front, green visual card behind
navigation: left/right only; no 1/5 and no “分镜 → VIDEO” text
```

- [ ] **Step 3: Verify media-mode persistence across navigation**

Select the visual card on a VIDEO that has visual text, click next, and confirm the next VIDEO stays in visual mode. Select video, click previous, and confirm it remains video mode. Navigate to a VIDEO without visual text and confirm green remains visible but disabled while blue remains foreground.

- [ ] **Step 4: Verify expanded actions are scoped and gated**

Open video mode: assert only video save, icon regenerate, edit, generate-video and video-candidate actions appear. Open visual mode: assert only visual save, icon regenerate, edit, generate-image and visual-candidate actions appear. With a missing video prompt, assert the exact message `请生成视频提示词再查看` appears and no empty editor is rendered.

- [ ] **Step 5: Commit only if verification requires a defect fix**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo-production.css frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
git commit -m "fix: correct batch storyboard prompt stack behavior"
```
