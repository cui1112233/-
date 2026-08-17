# 水货生产真实按钮第一阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让水货生产工作台的行内播放、图片/视频/配音入口、批量范围和任务日志均调用已有真实链路，并在依赖不完整时说明不可用原因。

**Architecture:** 复用现有 Go 任务、Redis 队列、Worker、对象存储和媒体记录。前端新增三个纯函数模块，分别负责音频选择、任务依赖判定和批量范围计算；`StoryboardRow` 仅管理行内音频元素，`BatchTaskModal` 仅提交已有批量 API，`TaskDrawer` 仅展示已有项目任务。浏览器不读取 Provider 请求模板、endpoint、ObjectKey 或凭据。

**Tech Stack:** React 18, Ant Design, Vite, Node built-in test runner, existing Go task API.

---

## 文件结构

- Create: `frontend/src/user/pages/shuihuo/mediaPlayback.js`，选择分镜可播放音频。
- Create: `frontend/src/user/pages/shuihuo/taskReadiness.js`，把健康快照转换为可展示的任务可用性和安全提示。
- Create: `frontend/src/user/pages/shuihuo/batchSelection.js`，计算批量选中范围。
- Modify: `frontend/src/user/pages/shuihuo/StoryboardRow.jsx`，真实播放和暂停行内音频。
- Modify: `frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx`，向行和批量弹窗传递统一状态。
- Modify: `frontend/src/user/pages/shuihuo/BatchTaskModal.jsx`，增加范围选择。
- Modify: `frontend/src/user/pages/shuihuo/TaskDrawer.jsx`，增加可用性说明和手动刷新。
- Modify: `tests/shuihuo-reference-alignment-contract.test.js`，扩展 UI 合同。
- Create: `tests/shuihuo-media-playback.test.mjs`、`tests/shuihuo-task-readiness.test.mjs`、`tests/shuihuo-batch-selection.test.mjs`，覆盖纯函数。

### Task 1: 建立音频选择与行内播放

**Files:**
- Create: `frontend/src/user/pages/shuihuo/mediaPlayback.js`
- Modify: `frontend/src/user/pages/shuihuo/StoryboardRow.jsx`
- Create: `tests/shuihuo-media-playback.test.mjs`
- Modify: `tests/shuihuo-reference-alignment-contract.test.js`

- [ ] **Step 1: 写失败的音频选择测试。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { primaryAudioForSegment } from '../frontend/src/user/pages/shuihuo/mediaPlayback.js';

test('primaryAudioForSegment prefers primary audio in the requested segment', () => {
  const media = [
    { id: 1, kind: 'audio', segmentId: 3 },
    { id: 2, kind: 'audio', segmentId: 3, isPrimary: true },
    { id: 3, kind: 'audio', segmentId: 4, isPrimary: true },
    { id: 4, kind: 'image', segmentId: 3, isPrimary: true }
  ];
  assert.equal(primaryAudioForSegment(media, 3)?.id, 2);
  assert.equal(primaryAudioForSegment(media, 9), null);
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `node --test tests/shuihuo-media-playback.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `mediaPlayback.js`.

- [ ] **Step 3: 实现音频选择函数。**

Create `frontend/src/user/pages/shuihuo/mediaPlayback.js`:

```js
function publicMedia(item) {
  return item?.media || item;
}

export function primaryAudioForSegment(media, segmentId) {
  const audio = (media || []).map(publicMedia)
    .filter(item => item?.kind === 'audio' && item.segmentId === segmentId);
  return audio.find(item => item.isPrimary === true) || audio[0] || null;
}
```

- [ ] **Step 4: 让 `StoryboardRow` 控制真实 audio 元素。**

1. 将 React 导入改为 `useEffect, useRef, useState`，并导入 `primaryAudioForSegment`。
2. 扩展 `MediaPreview` 的 `audioRef`、`onAudioPlay`、`onAudioPause` props；audio 标签为：

```jsx
<audio controls ref={audioRef} src={url} aria-label="分镜配音" onPlay={onAudioPlay} onPause={onAudioPause} onEnded={onAudioPause} />
```

3. 在 `StoryboardRow` 使用：

```js
const audioElements = useRef(new Map());
const primaryAudio = primaryAudioForSegment(actualMedia, segment.id);

useEffect(() => () => {
  audioElements.current.forEach(audio => audio.pause());
  audioElements.current.clear();
}, []);

async function toggleAudioPlayback() {
  if (!primaryAudio) return;
  const audio = audioElements.current.get(primaryAudio.id);
  if (!audio) { message.warning('配音正在加载，请稍后再试'); return; }
  try {
    if (audio.paused) await audio.play();
    else audio.pause();
  } catch (error) {
    message.error(error.message || '配音播放失败');
  }
}
```

4. 每个音频 `MediaPreview` 注册 `audioRef={element => { if (element) audioElements.current.set(item.id, element); else audioElements.current.delete(item.id); }}`。播放按钮使用 `onClick={toggleAudioPlayback}` 和 `disabled={!primaryAudio}`。保留原生 `controls` 作为无障碍降级。

- [ ] **Step 5: 写行内播放 UI 合同。**

Append to `tests/shuihuo-reference-alignment-contract.test.js`:

```js
test('row play button controls a real loaded audio element instead of being decorative', () => {
  assert.match(row, /primaryAudioForSegment/);
  assert.match(row, /audioElements = useRef\(new Map\(\)\)/);
  assert.match(row, /async function toggleAudioPlayback\(\)/);
  assert.match(row, /await audio\.play\(\)/);
  assert.match(row, /audio\.pause\(\)/);
  assert.match(row, /onClick=\{toggleAudioPlayback\}/);
});
```

- [ ] **Step 6: 验证并提交。**

Run: `node --test tests/shuihuo-media-playback.test.mjs tests/shuihuo-reference-alignment-contract.test.js`

Expected: PASS.

```bash
git add frontend/src/user/pages/shuihuo/mediaPlayback.js frontend/src/user/pages/shuihuo/StoryboardRow.jsx tests/shuihuo-media-playback.test.mjs tests/shuihuo-reference-alignment-contract.test.js
git commit -m "feat: make storyboard audio playback real"
```

### Task 2: 统一依赖可用性与安全原因

**Files:**
- Create: `frontend/src/user/pages/shuihuo/taskReadiness.js`
- Modify: `frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StoryboardRow.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchTaskModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/TaskDrawer.jsx`
- Create: `tests/shuihuo-task-readiness.test.mjs`

- [ ] **Step 1: 写失败的依赖判定测试。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskReadiness } from '../frontend/src/user/pages/shuihuo/taskReadiness.js';

const ready = { database: { ready: true }, redis: { ready: true }, storage: { ready: true }, enabledModelKinds: ['image', 'video', 'audio'] };

test('taskReadiness identifies the first missing safe dependency', () => {
  assert.deepEqual(taskReadiness({ ...ready, redis: { ready: false } }, 'image', { confirmed: true }), { ready: false, reason: 'Redis 队列未配置或不可用' });
  assert.deepEqual(taskReadiness(ready, 'video', { confirmed: true, hasPrimaryImage: false }), { ready: false, reason: '请先上传或选择主图片' });
  assert.deepEqual(taskReadiness(ready, 'audio', { confirmed: true }), { ready: true, reason: '' });
});

test('taskReadiness never returns provider configuration or credentials', () => {
  const result = taskReadiness({ ...ready, redis: { ready: false, reason: 'redis://user:secret@example' } }, 'image', { confirmed: true });
  assert.doesNotMatch(result.reason, /secret|redis:\/\//i);
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `node --test tests/shuihuo-task-readiness.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `taskReadiness.js`.

- [ ] **Step 3: 实现安全的统一可用性函数。**

Create `frontend/src/user/pages/shuihuo/taskReadiness.js`:

```js
const modelLabel = { image: '图片', video: '视频', audio: '配音', text: '文本' };

export function taskReadiness(snapshot, kind, { confirmed = true, hasPrimaryImage = true } = {}) {
  if (!confirmed) return { ready: false, reason: '请先确认分镜' };
  if (!snapshot?.database?.ready) return { ready: false, reason: '数据库未就绪' };
  if (!snapshot?.redis?.ready) return { ready: false, reason: 'Redis 队列未配置或不可用' };
  if (!snapshot?.storage?.ready) return { ready: false, reason: '素材存储未就绪' };
  if (!(snapshot.enabledModelKinds || []).includes(kind)) return { ready: false, reason: `管理员尚未启用${modelLabel[kind] || '对应'}模型` };
  if (kind === 'video' && !hasPrimaryImage) return { ready: false, reason: '请先上传或选择主图片' };
  return { ready: true, reason: '' };
}
```

- [ ] **Step 4: 替换重复布尔逻辑。**

In `CommentaryWorkbench.jsx`, derive `imageAvailability`, `videoAvailability`, and `audioAvailability` with `taskReadiness(readiness, kind, { confirmed })`; pass each full object to `StoryboardRow` and `BatchTaskModal`.

In `StoryboardRow.jsx`, use `imageAvailability.reason`, `videoAvailability.reason`, and `audioAvailability.reason` as tooltips. In `BatchTaskModal.jsx`, accept `availability`, render an `Alert` when it is false, and disable confirmation. In `TaskDrawer.jsx`, calculate with `taskReadiness(readiness, kind, { confirmed: Boolean(segmentId), hasPrimaryImage: !segmentId || primaryImageSegmentIds.has(segmentId) })` and use its safe reason in the existing alert.

- [ ] **Step 5: 验证并提交。**

Run: `node --test tests/shuihuo-task-readiness.test.mjs tests/shuihuo-production-ui-contract.test.js tests/shuihuo-reference-alignment-contract.test.js`

Expected: PASS.

```bash
git add frontend/src/user/pages/shuihuo/taskReadiness.js frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx frontend/src/user/pages/shuihuo/StoryboardRow.jsx frontend/src/user/pages/shuihuo/BatchTaskModal.jsx frontend/src/user/pages/shuihuo/TaskDrawer.jsx tests/shuihuo-task-readiness.test.mjs
git commit -m "feat: explain shuihuo task readiness"
```

### Task 3: 让批量范围和项目任务日志可操作

**Files:**
- Create: `frontend/src/user/pages/shuihuo/batchSelection.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchTaskModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx`
- Modify: `frontend/src/user/pages/shuihuo/TaskDrawer.jsx`
- Create: `tests/shuihuo-batch-selection.test.mjs`
- Modify: `tests/shuihuo-reference-alignment-contract.test.js`

- [ ] **Step 1: 写失败的批量范围测试。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBatchSegmentIds } from '../frontend/src/user/pages/shuihuo/batchSelection.js';

const segments = [
  { id: 1, orderIndex: 1, confirmed: true },
  { id: 2, orderIndex: 2, confirmed: true },
  { id: 3, orderIndex: 3, confirmed: false },
  { id: 4, orderIndex: 4, confirmed: true }
];
const media = [
  { kind: 'image', segmentId: 1, isPrimary: true },
  { kind: 'video', segmentId: 1 },
  { kind: 'image', segmentId: 2, isPrimary: true }
];

test('selectBatchSegmentIds respects confirmation, video primary images, completion and range', () => {
  assert.deepEqual(selectBatchSegmentIds({ segments, media, kind: 'video', scope: 'all' }), [1, 2]);
  assert.deepEqual(selectBatchSegmentIds({ segments, media, kind: 'video', scope: 'incomplete' }), [2]);
  assert.deepEqual(selectBatchSegmentIds({ segments, media, kind: 'image', scope: 'range', start: 2, end: 4 }), [2, 4]);
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `node --test tests/shuihuo-batch-selection.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `batchSelection.js`.

- [ ] **Step 3: 实现批量范围纯函数。**

Create `frontend/src/user/pages/shuihuo/batchSelection.js`:

```js
function mediaItem(item) { return item?.media || item; }

export function selectBatchSegmentIds({ segments = [], media = [], kind, scope, start, end, selectedIds = [] }) {
  const allMedia = media.map(mediaItem);
  const primaryImageIDs = new Set(allMedia.filter(item => item?.kind === 'image' && item.isPrimary && item.segmentId).map(item => item.segmentId));
  const completedIDs = new Set(allMedia.filter(item => item?.kind === kind && item.segmentId).map(item => item.segmentId));
  const eligible = segments.filter(segment => segment.confirmed && (kind !== 'video' || primaryImageIDs.has(segment.id)));
  if (scope === 'incomplete') return eligible.filter(segment => !completedIDs.has(segment.id)).map(segment => segment.id);
  if (scope === 'range') return eligible.filter(segment => segment.orderIndex >= start && segment.orderIndex <= end).map(segment => segment.id);
  if (scope === 'selected') return eligible.filter(segment => selectedIds.includes(segment.id)).map(segment => segment.id);
  return eligible.map(segment => segment.id);
}
```

- [ ] **Step 4: 接入批量范围控件和刷新按钮。**

In `BatchTaskModal.jsx`:

1. Add scope state: `all`, `incomplete`, `range`, `selected`, plus numeric `start` and `end`.
2. When the modal opens, initialize to `selected` for a row action with one `initialSegmentIds`; otherwise initialize to `all` for toolbar actions.
3. Use `selectBatchSegmentIds` when scope, range, segments, media, or manual checks change. Keep checkboxes only in `selected` mode; their disabled rule remains confirmation plus video-primary-image eligibility.
4. Render `批量范围` as an AntD `Select`; render two `InputNumber` fields only for `range`; show generated selection count. `submit()` uses computed IDs, not stale local state.
5. After HTTP 207 partial submission, switch to `selected` and keep only failed eligible IDs checked.

In `CommentaryWorkbench.jsx`, toolbar batch actions pass `initialScope="all"`; row actions pass `initialScope="selected"`.

In `TaskDrawer.jsx`, add a text `刷新` button in the drawer `extra` area. It calls `refresh`, disables while busy, and reports `读取任务中心失败` on rejection. Keep automatic polling only while backend reports `queued` or `running`; do not create a fake progress percentage.

- [ ] **Step 5: 写批量和日志 UI 合同。**

Append to `tests/shuihuo-reference-alignment-contract.test.js`:

```js
test('batch controls expose concrete scope choices and the task drawer keeps manual refresh', () => {
  for (const label of ['全部已确认', '未完成', '指定编号范围', '手工勾选', '批量范围']) {
    assert.match(batchModal, new RegExp(label));
  }
  assert.match(batchModal, /selectBatchSegmentIds/);
  assert.match(batchModal, /scope === 'range'/);
  assert.match(drawer, />刷新</);
  assert.match(drawer, /await refresh\(\)/);
  assert.doesNotMatch(drawer, /百分比/);
});
```

- [ ] **Step 6: 验证并提交。**

Run: `node --test tests/shuihuo-batch-selection.test.mjs tests/shuihuo-production-ui-contract.test.js tests/shuihuo-reference-alignment-contract.test.js`

Expected: PASS.

```bash
git add frontend/src/user/pages/shuihuo/batchSelection.js frontend/src/user/pages/shuihuo/BatchTaskModal.jsx frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx frontend/src/user/pages/shuihuo/TaskDrawer.jsx tests/shuihuo-batch-selection.test.mjs tests/shuihuo-reference-alignment-contract.test.js
git commit -m "feat: add shuihuo batch scopes and task refresh"
```

### Task 4: 构建、浏览器与运行依赖验证

**Files:**
- Modify: none unless a verification failure identifies a defect in Tasks 1-3.

- [ ] **Step 1: 运行第一阶段完整静态验证。**

Run: `node --test tests/shuihuo-media-playback.test.mjs tests/shuihuo-task-readiness.test.mjs tests/shuihuo-batch-selection.test.mjs tests/shuihuo-production-ui-contract.test.js tests/shuihuo-reference-alignment-contract.test.js`

Expected: all Node tests pass.

Run: `npm --prefix frontend run build`

Expected: Vite exits 0.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 2: 验证服务与浏览器交互，不提交收费模型任务。**

Run: `lsof -nP -iTCP:3000 -sTCP:LISTEN`

Expected: the local service listens on port 3000.

Run: `curl -si http://127.0.0.1:3000/shuihuo-production | head -20`

Expected: HTTP 200 for the workbench route.

In the authenticated browser, open one existing `/shuihuo-production` project and verify:

1. Existing audio play icon starts and pauses the downloaded audio; browser autoplay rejection shows an error rather than false success.
2. Image/video/audio buttons show the exact safe reason when health is incomplete.
3. Batch scope changes the selected count as expected and the task drawer refreshes manually.
4. No task is submitted unless the reviewer clicks the final submit button and the runtime is configured.

- [ ] **Step 3: Record runtime limitation accurately.**

If health still reports Redis unavailable or missing audio/video models, leave controls disabled and report that static/UI verification passed while real generation remains blocked by missing server dependencies. Do not add a mock-success route.

- [ ] **Step 4: Commit only verification-driven fixes.**

Run: `git status --short`

Run: `git diff --check`

Expected: any additional commit contains only a narrow regression fix and its test; pre-existing unrelated worktree changes remain untouched.
