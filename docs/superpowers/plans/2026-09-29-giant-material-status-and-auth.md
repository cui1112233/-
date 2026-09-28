# 巨量素材状态条与授权提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在巨量素材测试页和批量工厂中复用一张可观察的阶段状态卡，并把青语授权未配置/失效转成不泄露凭据的明确提示。

**Architecture:** 新建一个纯展示型 `GiantMaterialStatusCard` 组件，接收阶段、文案、进度和统计，不负责网络请求。测试页和批量工厂各自把现有解析/OCR状态映射成同一组阶段数据；青语解析仍由现有客户端调用，授权错误沿用稳定错误码并只在界面显示安全文案。

**Tech Stack:** React, Ant Design-free JSX/CSS for the shared card, Vite, Node built-in test runner, existing giant-material extraction client.

## Global Constraints

- 本次只修改本地代码，不发布公网。
- 青语 `N8-Admin-Token` 只留在服务端配置，不写入前端、响应、日志或测试夹具。
- 本地 OCR/音频处理不因状态卡新增付费模型调用。
- 保留现有用户未提交改动，不执行重置、清理或整分支合并。
- 组件状态必须支持 `idle`、`resolving`、`reading`、`ocr`、`cleaning`、`success`、`error`、`cancelled`。

---

### Task 1: 建立共享状态模型和展示组件

**Files:**
- Create: `frontend/src/user/pages/GiantMaterialStatusCard.jsx`
- Create: `frontend/src/user/pages/GiantMaterialStatusCard.test.js`
- Modify: `frontend/src/user/pages/giant-material-test.css`

**Interfaces:**
- Consumes: `{ title, phase, label, detail, progress, stats, compact, error }`，其中 `phase` 是全局约束中的八种状态之一，`progress` 为 `null` 或 `{ value, max, indeterminate }`，`stats` 为可选字符串数组。
- Produces: `GiantMaterialStatusCard`，渲染标题、副标题、状态徽标、进度条和统计行；不发请求、不修改提取状态。

- [ ] **Step 1: Write the failing test**

  在 `GiantMaterialStatusCard.test.js` 中用源码契约测试锁定所有阶段和展示字段：

  ```js
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import fs from 'node:fs';

  const source = fs.readFileSync(new URL('./GiantMaterialStatusCard.jsx', import.meta.url), 'utf8');

  test('defines the shared giant material status phases and progress fields', () => {
    for (const phase of ['idle', 'resolving', 'reading', 'ocr', 'cleaning', 'success', 'error', 'cancelled']) {
      assert.match(source, new RegExp(`['"]${phase}['"]`));
    }
    assert.match(source, /indeterminate/);
    assert.match(source, /aria-label/);
    assert.match(source, /compact/);
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test frontend/src/user/pages/GiantMaterialStatusCard.test.js`

  Expected: FAIL because the component file does not exist.

- [ ] **Step 3: Write minimal implementation**

  Create the component with explicit phase metadata and safe numeric clamping:

  ```jsx
  const PHASES = {
    idle: { label: '待执行', tone: 'muted' }, resolving: { label: '连接中', tone: 'loading' },
    reading: { label: '读取中', tone: 'loading' }, ocr: { label: '识别中', tone: 'loading' },
    cleaning: { label: '整理中', tone: 'loading' }, success: { label: '已完成', tone: 'success' },
    error: { label: '失败', tone: 'error' }, cancelled: { label: '已取消', tone: 'warning' }
  };

  export function GiantMaterialStatusCard({ title = '滚屏 OCR', phase = 'idle', detail = '', progress = null, stats = [], compact = false }) {
    const meta = PHASES[phase] || PHASES.idle;
    const max = Math.max(1, Number(progress?.max) || 1);
    const value = Math.min(max, Math.max(0, Number(progress?.value) || 0));
    return <section className={`giant-material-status-card is-${meta.tone}${compact ? ' is-compact' : ''}`}>
      <div className="giant-material-status-heading"><strong>{title}</strong><span>{meta.label}</span></div>
      <p>{detail}</p>
      {progress ? <progress aria-label={`${title}进度`} max={max} value={progress.indeterminate ? undefined : value} /> : null}
      {stats.length ? <div className="giant-material-status-stats">{stats.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div> : null}
    </section>;
  }
  ```

  Add dark-theme, compact, success/error/warning, indeterminate-progress, and narrow-screen CSS in `giant-material-test.css` without changing existing stage selectors.

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test frontend/src/user/pages/GiantMaterialStatusCard.test.js`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/user/pages/GiantMaterialStatusCard.jsx frontend/src/user/pages/GiantMaterialStatusCard.test.js frontend/src/user/pages/giant-material-test.css
  git commit -m "feat(batch): add giant material status card"
  ```

### Task 2: Wire the full status sequence into the giant-material test page

**Files:**
- Modify: `frontend/src/user/pages/GiantMaterialTestPage.jsx`
- Modify: `frontend/src/user/pages/GiantMaterialTestPage.source.test.js`
- Modify: `frontend/src/user/pages/giantMaterialExtractionClient.js` only if the existing callbacks cannot distinguish resolve and extraction events; preserve the existing endpoint contract.

**Interfaces:**
- Consumes: `readGiantMaterialContent` callbacks `onResolved` and `onProgress`, existing `errorCode`, `material`, `result` state.
- Produces: stage data passed to `GiantMaterialStatusCard`; resolve errors map to `QINGYU_AUTH_NOT_CONFIGURED` or `QINGYU_AUTH_FAILED` copy, OCR errors map to the existing `ERROR_MESSAGES` copy.

- [ ] **Step 1: Write the failing source assertions**

  Extend `GiantMaterialTestPage.source.test.js`:

  ```js
  test('uses the shared status card and exposes Qingyu auth states', () => {
    assert.match(page, /GiantMaterialStatusCard/);
    assert.match(page, /正在请求青语素材接口/);
    assert.match(page, /QINGYU_AUTH_NOT_CONFIGURED/);
    assert.match(page, /QINGYU_AUTH_FAILED/);
    assert.match(page, /正在整理正文/);
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test frontend/src/user/pages/GiantMaterialTestPage.source.test.js`

  Expected: FAIL because the page still renders the inline `<progress>` and does not import the shared component.

- [ ] **Step 3: Write minimal implementation**

  Replace only the inline OCR status markup with `GiantMaterialStatusCard` and derive phase in this order: `errorCode` (`cancelled` versus `error`), `result` (`success`), `busy && !resolved` (`resolving`), `busy && resolved` (`ocr`), `resolved && !result` (`idle`/`reading` as appropriate). Pass indeterminate progress before duration is known; after progress events pass `seconds` as `value` and `durationSeconds` as `max`. Keep the existing four stage sections, metadata, result textarea, copy, and download behavior. Add a short `cleaning` status while the complete event has arrived and the result state is being committed if the client exposes that boundary; otherwise use `ocr` through completion and `success` once the result is present.

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test frontend/src/user/pages/GiantMaterialTestPage.source.test.js frontend/src/user/pages/giantMaterialExtractionClient.test.js`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/user/pages/GiantMaterialTestPage.jsx frontend/src/user/pages/GiantMaterialTestPage.source.test.js
  git commit -m "feat(batch): show giant material extraction status"
  ```

### Task 3: Reuse the compact status card in the batch factory modal

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`
- Modify: `frontend/src/user/pages/shuihuo-production.css` only for modal-specific spacing if the shared card CSS does not cover it.

**Interfaces:**
- Consumes: existing `giantMaterial`, `giantProgress`, `giantExtraction`, `giantBusy`, `busy`, `errorCode`, and `resolveGiantMaterialDraft`/`submit` state.
- Produces: compact shared card with phase `resolving`, `ocr`, `success`, `error`, or `idle`; existing buttons and intake behavior remain unchanged.

- [ ] **Step 1: Write the failing source assertions**

  Extend `BatchFactoryCreateModal.source.test.js`:

  ```js
  test('uses the shared giant material status card in compact mode', () => {
    assert.match(source, /GiantMaterialStatusCard/);
    assert.match(source, /compact/);
    assert.match(source, /正在解析巨量素材/);
    assert.match(source, /正在 OCR 读取滚屏正文/);
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`

  Expected: FAIL because the modal currently uses an Ant Design `Alert` for giant progress.

- [ ] **Step 3: Write minimal implementation**

  Import `GiantMaterialStatusCard`, replace only the giant-mode `Alert` block, and preserve the existing `Alert` for the resolved book metadata. Map `giantBusy && !giantProgress` to `resolving`, `giantBusy && giantProgress` to `ocr`, `giantExtraction` to `success`, and a visible `errorCode` to `error`; pass compact mode and stats such as `已处理 X / Y 秒`, `N 帧`, and `M 字`. Keep create/resolve buttons, content controls, and grouped manual-book behavior untouched.

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo-production.css
  git commit -m "feat(batch): reuse giant status card in intake modal"
  ```

### Task 4: Verify authorization boundaries, build, and local runtime

**Files:**
- Modify: `frontend/src/user/pages/giantMaterialExtractionClient.test.js` only if a missing stable error-code case is needed.
- Modify: `frontend/src/user/pages/GiantMaterialTestPage.source.test.js` or `BatchFactoryCreateModal.source.test.js` only for the exact final contract assertions.

**Interfaces:**
- Consumes: existing resolve/extract client responses and the shared card contracts from Tasks 1–3.
- Produces: tested evidence that auth errors remain safe strings and the local UI serves the new card in both entry points.

- [ ] **Step 1: Add failing auth safety assertions**

  Add cases to `giantMaterialExtractionClient.test.js` that return HTTP 401 with `QINGYU_AUTH_FAILED` and HTTP 503 with `QINGYU_UPSTREAM_FAILED`; assert the thrown message is the stable code and never contains a header name or token value.

- [ ] **Step 2: Run the focused tests and verify the new assertions fail if the contract regresses**

  Run: `node --test frontend/src/user/pages/giantMaterialExtractionClient.test.js`

  Expected after implementation: PASS for both auth cases and all existing stream cases.

- [ ] **Step 3: Run the complete targeted verification**

  ```bash
  node --test frontend/src/user/pages/GiantMaterialStatusCard.test.js frontend/src/user/pages/GiantMaterialTestPage.source.test.js frontend/src/user/pages/giantMaterialExtractionClient.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js lib/giant-material/scroll-extractor.test.mjs
  cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi
  cd ../frontend && npm test && npm run build
  ```

  Expected: all listed Node/Go tests pass, Vite build succeeds, and only existing non-blocking chunk-size/runtime-asset warnings remain.

- [ ] **Step 4: Verify local runtime without changing public deployment**

  Confirm the local containers remain healthy and the served frontend contains `GiantMaterialStatusCard`, `正在请求青语素材接口`, and `正在 OCR 读取滚屏正文`. Confirm `/api/build-info` reports `git_sha=local-v88`; do not run public deploy or push commands.

- [ ] **Step 5: Review the final diff**

  Run `git diff --check` and inspect `git status --short`; verify no token-like value, generated secret, or unrelated worktree file was staged by these commits.

