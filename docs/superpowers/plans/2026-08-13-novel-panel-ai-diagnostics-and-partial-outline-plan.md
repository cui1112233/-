# 小说面板 AI 诊断与部分分镜保留 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小说面板能脱敏记录 AI 请求诊断，并在整段分镜中只保留通过原文质量校验的分镜，避免因个别坏结果丢弃整批可用内容。

**Architecture:** 新增账号隔离的小说面板 AI 诊断存储，由 `routes/novel-panel.js` 的统一 AI 操作包装器在开始、成功、失败和质量闸门完成时写入事件。质量闸门模块增加逐镜验证入口：它复用现有可拍摄性、人物手动选角和原文引用规则，但不要求单镜覆盖整篇原文；整段接口先跑全量闸门，失败后才逐镜筛选并返回明确的 `partial` 合同。工作台只复用既有状态提示和错误弹窗，不改页面布局。

**Tech Stack:** Node.js、Express、现有 JSON 原子写入工具、V77 原生 JavaScript 工作台、`node:test`。

---

## 文件结构

- Create: `lib/novel-panel/ai-diagnostic-store.js`
  - 每账号受控诊断事件读写、字段白名单、滚动保留和脱敏。
- Modify: `routes/novel-panel.js`
  - 在模型操作生命周期记录诊断；暴露当前账号诊断读取接口；增加整段分镜的逐镜保留响应。
- Modify: `lib/novel-panel/quality-gate.js`
  - 提供不依赖“覆盖整篇原文”的逐镜质量入口，仍使用现有原文引用、可拍摄性和手动选角规则。
- Modify: `public/novel-panel/workbench/app.js`
  - 识别 `partial: true`，只提交服务端已筛选的镜头，并使用现有状态区域展示数量、原因和诊断 ID。
- Modify: `frontend/src/shared/api/client.js`
  - 增加读取当前账号小说面板诊断的 API 客户端函数。
- Modify: `frontend/src/user/pages/IssueLogPage.jsx`
  - 合并显示原有客户端问题日志与小说面板 AI 诊断，沿用现有列表布局。
- Modify: `tests/novel-panel-stability.test.js`
  - 覆盖诊断记录、账号隔离、超时分类、部分保留、全失败和单镜全有或全无。
- Modify: `tests/novel-panel-asset-contract.test.js`
  - 覆盖工作台 `partial` 提示和问题记录页读取诊断的静态契约。

## Task 1: 账号隔离的诊断存储

**Files:**
- Create: `lib/novel-panel/ai-diagnostic-store.js`
- Test: `tests/novel-panel-stability.test.js`

- [ ] **Step 1: 写入失败测试，规定诊断字段和隔离边界**

在 `tests/novel-panel-stability.test.js` 导入 `createNovelPanelAiDiagnosticStore`，添加测试。测试必须断言：同一账号只保留最新 100 条；另一账号无法从 `listForUser` 读取本账号事件；持久化 JSON 中不存在 `apiKey`、`authorization`、`novel_text`、`prompt` 或 Bearer token。

```js
test('novel-panel AI diagnostics are redacted, bounded, and isolated by account', t => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-diagnostics-'));
  t.after(() => fs.rmSync(usersDir, { recursive: true, force: true }));
  const diagnostics = createNovelPanelAiDiagnosticStore({ usersDir, maxEntries: 2 });

  diagnostics.record('choushiyiguai', {
    operation: 'outline', model: 'test-model', base_url_host: 'relay.example',
    timeout_seconds: 400, request_chars: 88, system_chars: 44, max_tokens: 16000,
    outcome: 'failed', category: 'upstream_timeout', error: 'Authorization: Bearer secret-token api_key=sk-secret novel_text=private'
  });
  diagnostics.record('choushiyiguai', { operation: 'outline', outcome: 'success', category: 'success' });
  diagnostics.record('choushiyiguai', { operation: 'analyze', outcome: 'success', category: 'success' });
  diagnostics.record('choushiyiguai1', { operation: 'outline', outcome: 'success', category: 'success' });

  const mine = diagnostics.listForUser('choushiyiguai');
  assert.equal(mine.length, 2);
  assert.equal(diagnostics.listForUser('choushiyiguai1').length, 1);
  assert.doesNotMatch(JSON.stringify(mine), /secret-token|sk-secret|private|novel_text|api_key|authorization/i);
});
```

- [ ] **Step 2: 运行测试，确认当前缺少实现**

Run: `node --test --test-name-pattern='novel-panel AI diagnostics are redacted, bounded, and isolated by account' tests/novel-panel-stability.test.js`

Expected: FAIL，提示无法导入 `createNovelPanelAiDiagnosticStore`。

- [ ] **Step 3: 实现最小诊断存储**

创建 `lib/novel-panel/ai-diagnostic-store.js`。使用现有 `readJsonOrMissing` 和 `writeJsonAtomic`，路径固定为 `path.join(usersDir, username, 'novel-panel', 'ai-diagnostics.json')`。只持久化白名单字段；`record()` 必须在内部生成 ID 和时间，调用方不得控制它们。

```js
const ALLOWED_FIELDS = [
  'operation', 'model', 'base_url_host', 'timeout_seconds', 'request_chars',
  'system_chars', 'max_tokens', 'http_status', 'elapsed_ms', 'outcome',
  'category', 'error', 'outline_returned', 'outline_accepted',
  'outline_rejected', 'partial', 'gate_summary'
];

function createNovelPanelAiDiagnosticStore({ usersDir, maxEntries = 100 } = {}) {
  function record(username, event = {}) {
    const entry = normalizeDiagnostic(event);
    const entries = read(username);
    write(username, [entry, ...entries].slice(0, maxEntries));
    return entry;
  }
  return { record, listForUser(username, limit = 50) { return read(username).slice(0, clampLimit(limit)); } };
}
```

`normalizeDiagnostic()` 必须从 `ALLOWED_FIELDS` 拷贝字段，并对字符串调用本模块的 `redact()`。`redact()` 至少覆盖 `Authorization: Bearer ...`、`api_key=...`、`apiKey=...`、`sk-...` 和 `novel_text=...`，字符串限制为 500 字符。`request_chars`、`system_chars`、`max_tokens`、`http_status`、`elapsed_ms` 只保留非负安全整数；`partial` 只保留布尔值。

- [ ] **Step 4: 运行存储测试，确认通过**

Run: `node --test --test-name-pattern='novel-panel AI diagnostics are redacted, bounded, and isolated by account' tests/novel-panel-stability.test.js`

Expected: PASS。

- [ ] **Step 5: 记录检查点，不创建提交**

当前仓库已有大量与本任务无关的未提交改动。运行：

```bash
git diff --check -- lib/novel-panel/ai-diagnostic-store.js tests/novel-panel-stability.test.js
git status --short -- lib/novel-panel/ai-diagnostic-store.js tests/novel-panel-stability.test.js
```

Expected: 无空白错误；不执行 `git add` 或 `git commit`。

## Task 2: 统一模型操作诊断与读取接口

**Files:**
- Modify: `routes/novel-panel.js:1-170`
- Modify: `app.js:33-50`
- Test: `tests/novel-panel-stability.test.js`

- [ ] **Step 1: 写入失败测试，规定 504 诊断合同**

在稳定性测试中通过 `app.locals.novelPanelConfig` 指向慢上游，设置用户的 `ai_timeout_seconds` 为 30，并请求 `/api/novel-panel/analyze`。断言响应为 `504`、响应体具有 `diagnostic_id`；随后 `GET /api/novel-panel/diagnostics` 返回同 ID，且条目满足：`operation === 'analyze'`、`outcome === 'failed'`、`category === 'upstream_timeout'`、`timeout_seconds === 30`、`elapsed_ms >= 0`。

```js
assert.equal(response.status, 504);
assert.equal(typeof response.body.diagnostic_id, 'string');
const diagnostics = await request(server, {
  requestPath: '/api/novel-panel/diagnostics?limit=20', token
});
assert.equal(diagnostics.status, 200);
const entry = diagnostics.body.entries.find(item => item.id === response.body.diagnostic_id);
assert.deepEqual(
  { operation: entry.operation, outcome: entry.outcome, category: entry.category, timeout_seconds: entry.timeout_seconds },
  { operation: 'analyze', outcome: 'failed', category: 'upstream_timeout', timeout_seconds: 30 }
);
```

- [ ] **Step 2: 运行测试，确认 API 尚不存在且响应无事件 ID**

Run: `node --test --test-name-pattern='novel-panel analyze timeout records a redacted diagnostic' tests/novel-panel-stability.test.js`

Expected: FAIL，`diagnostic_id` 缺失或 `/diagnostics` 返回 404。

- [ ] **Step 3: 将诊断存储注入应用并包装 `runAiOperation`**

在 `app.js` 创建默认诊断存储并保存到 `app.locals.novelPanelAiDiagnosticStore`。测试可传入 `novelPanelAiDiagnosticStore` 覆盖默认实现。

在 `routes/novel-panel.js` 增加：

```js
function diagnosticStore(req) {
  return req.app?.locals?.novelPanelAiDiagnosticStore || createNovelPanelAiDiagnosticStore({ usersDir: USERS_DIR });
}

function diagnosticCategory(error) {
  if (error?.code === 'UPSTREAM_TIMEOUT') return 'upstream_timeout';
  if (error?.code === 'UPSTREAM_ABORTED') return 'client_cancelled';
  if (/上游模型返回 HTTP \d+/.test(String(error?.message || ''))) return 'upstream_http';
  if (/合法 JSON|返回为空/.test(String(error?.message || ''))) return 'upstream_invalid_json';
  if (/请先粘贴|缺少|无效/.test(String(error?.message || ''))) return 'validation_error';
  return 'unknown';
}
```

将 `runAiOperation(req, res, operation, execute)` 改为接收 `diagnosticMeta`，开始计时；成功时记录 `outcome: 'success'`；抛错时记录 `outcome: 'failed'` 与 `diagnosticCategory(error)`，然后重新抛出原错误。记录元数据由 `requestCompletion()` 返回或包装：模型名、URL 主机、系统/用户字符数、输出 token、等待上限和 HTTP 状态。不得把 `system` 或 `user` 原文放入事件。

将 `upstreamError(res, error, diagnosticId)` 和 `clientError(res, error, diagnosticId)` 的 JSON 响应扩展为可选 `diagnostic_id`，不改变原 `error` 文本。所有 AI 路由在 catch 中取到本次诊断 ID 后传入。

新增路由：

```js
router.get('/diagnostics', (req, res) => {
  res.json({ entries: diagnosticStore(req).listForUser(req.username, req.query.limit) });
});
```

此路由已处于 `router.use(apiAuth)` 之后，天然按账号鉴权；不提供跨账号 ID 查询参数。

- [ ] **Step 4: 运行超时、鉴权和既有稳定性测试**

Run:

```bash
node --test --test-name-pattern='novel-panel analyze timeout records a redacted diagnostic|CharacterCore slots, leases, migration, and drafts require authentication and isolate accounts|a second analyze request receives 409' tests/novel-panel-stability.test.js
```

Expected: PASS；第二个并发请求 `409` 不产生上游请求诊断。

- [ ] **Step 5: 记录检查点，不创建提交**

Run: `git diff --check -- app.js routes/novel-panel.js tests/novel-panel-stability.test.js`

Expected: 无空白错误。

## Task 3: 逐镜质量入口与整段部分保留

**Files:**
- Modify: `lib/novel-panel/quality-gate.js`
- Modify: `routes/novel-panel.js:598-622`
- Test: `tests/novel-panel-stability.test.js`

- [ ] **Step 1: 写入失败测试，规定部分保留合同**

在稳定性测试中启动可控上游，使 `/outline-scenes` 返回两条分镜：第一条的 `source_index` 和 `source_basis` 对应第 1 行，提示词可拍摄；第二条引用 `source_index: 99`。调用整段接口并断言：

```js
assert.equal(response.status, 200);
assert.equal(response.body.applied, true);
assert.equal(response.body.partial, true);
assert.equal(response.body.outline_shots.length, 1);
assert.equal(response.body.rejected_shots.length, 1);
assert.equal(response.body.rejected_shots[0].source_index, 99);
assert.match(response.body.rejected_shots[0].reason, /原文行引用/);
```

再添加两个测试：

```js
// 全部无效：422，applied:false，且不返回任何可写入 outline_shots。
assert.equal(allRejected.status, 422);
assert.equal(allRejected.body.applied, false);

// 单镜重生成即使返回一条可用和一条坏条目，也维持 422，不能 partial。
assert.equal(regenerate.status, 422);
assert.equal(regenerate.body.applied, false);
assert.equal(regenerate.body.partial, undefined);
```

- [ ] **Step 2: 运行测试，确认当前整批拒绝**

Run: `node --test --test-name-pattern='outline preserves only individually valid shots|outline rejects when every shot is invalid|scene regeneration remains atomic' tests/novel-panel-stability.test.js`

Expected: 第一项 FAIL，因为当前接口返回 `422`；后两项在实现前可作为行为基线。

- [ ] **Step 3: 在质量闸门中实现逐镜验证，不放宽规则**

在 `lib/novel-panel/quality-gate.js` 导出：

```js
function validateOutlineShotApplyGate(shot, context = {}) {
  const candidate = { outline_shots: [shot] };
  return mergeReports([
    validateSingleShotSourceReference(shot, context),
    validateShotDisplayability(candidate, context),
    validateManualCastAuthority(candidate, context)
  ]);
}
```

`validateSingleShotSourceReference()` 必须使用现有 `sourceLineInfo`、`addSourceIndexCoverage`、`collectLineReferenceCoverage` 与 `collectCoveredLinesBySourceBasis` 的同一行号/原文规范化规则，要求候选镜头至少以 `source_index`、其他支持的行引用字段或精确 `source_basis` 中的一种方式映射到当前整段原文的有效非空行。它必须拒绝：非整数、0 以外的无效值、越界、过深/过大的行引用、无法精确匹配的 `source_basis`。它不能改写 `source_index`、`source_basis` 或提示词。

不要调用 `validateOutlineCoverage()` 直接验证单镜，因为该函数的职责是“整个结果覆盖整篇原文”，单镜必然不满足该条件。逐镜入口仍属于同一质量闸门模块，并复用同一原文引用和可拍摄性标准。

- [ ] **Step 4: 在整段路由增加逐镜筛选分支**

在 `generateOutline()` 中保留完整闸门的优先级。仅当 `mode === 'outline'` 且完整报告不通过时执行以下逻辑：

```js
const accepted = [];
const rejected = [];
for (const shot of result.outline_shots) {
  const report = validateOutlineShotApplyGate(shot, { novelText, allCharacterNames: body.characters });
  if (report.ok) accepted.push(shot);
  else rejected.push({
    source_index: shot?.source_index,
    source_basis: text(shot?.source_basis, 240),
    reason: summarizeOutlineGateIssues(report),
    codes: report.blockingIssues.map(issue => issue.code)
  });
}
if (accepted.length) {
  const diagnostic = recordOutlineDiagnostic(...);
  return res.json({ ...result, outline_shots: accepted, applied: true, partial: true, rejected_shots: rejected, diagnostic_id: diagnostic.id });
}
```

全量通过时响应仍无 `partial`，保持现有兼容性。无合格项时返回当前 `422`，但补充 `rejected_shots` 摘要和 `diagnostic_id`。单镜模式不进入此分支。

更新本次事件的 `outline_returned`、`outline_accepted`、`outline_rejected`、`partial`、`gate_summary`，类别为 `quality_gate_blocked`。部分成功的 `outcome` 为 `partial`，不是 `success`，以便问题页准确显示。

- [ ] **Step 5: 运行逐镜、闸门和稳定性测试**

Run:

```bash
node --test --test-name-pattern='outline preserves only individually valid shots|outline rejects when every shot is invalid|scene regeneration remains atomic|slow upstream times out and destroys the upstream connection' tests/novel-panel-stability.test.js
```

Expected: 全部 PASS。

- [ ] **Step 6: 记录检查点，不创建提交**

Run: `git diff --check -- lib/novel-panel/quality-gate.js routes/novel-panel.js tests/novel-panel-stability.test.js`

Expected: 无空白错误。

## Task 4: 工作台和问题记录的最小提示

**Files:**
- Modify: `public/novel-panel/workbench/app.js:10770-10920`
- Modify: `frontend/src/shared/api/client.js:73-75`
- Modify: `frontend/src/user/pages/IssueLogPage.jsx:20-50`
- Test: `tests/novel-panel-asset-contract.test.js`

- [ ] **Step 1: 写入失败测试，规定前端静态契约**

在 `tests/novel-panel-asset-contract.test.js` 添加断言：工作台在整段生成响应处读取 `data.partial`、`data.rejected_shots`、`data.diagnostic_id`，并用既有 `showAIStatusNotice` 呈现“已保留”；共享 API 客户端请求 `/api/novel-panel/diagnostics`；问题页同时读取现有 `listMyErrorLogs` 与新 `listMyNovelPanelDiagnostics`。

```js
assert.match(workbench, /data\.partial/);
assert.match(workbench, /data\.rejected_shots/);
assert.match(workbench, /data\.diagnostic_id/);
assert.match(workbench, /showAIStatusNotice\(`已保留/);
assert.match(client, /\/api\/novel-panel\/diagnostics/);
assert.match(issuePage, /listMyNovelPanelDiagnostics/);
```

- [ ] **Step 2: 运行测试，确认当前页面未识别部分结果**

Run: `node --test --test-name-pattern='novel-panel surfaces partial outlines and diagnostics in existing issue UI' tests/novel-panel-asset-contract.test.js`

Expected: FAIL，缺少 `partial` 和诊断读取路径。

- [ ] **Step 3: 实现工作台部分成功提示**

在 `generateOutline()` 收到并验证 `data.outline_shots` 后、写入 `state.outlineShots` 前保存：

```js
const partialSummary = data.partial ? {
  accepted: data.outline_shots.length,
  rejected: Array.isArray(data.rejected_shots) ? data.rejected_shots.length : 0,
  diagnosticId: text(data.diagnostic_id)
} : null;
```

保持现有 `canonicalizeOutlineToSourceLines` 和写入流程只接收服务端的 `data.outline_shots`。成功写入后，当 `partialSummary` 存在时调用：

```js
showAIStatusNotice(
  `已保留 ${partialSummary.accepted} 条通过验收的分镜，${partialSummary.rejected} 条未写入。诊断编号：${partialSummary.diagnosticId || '未提供'}。`,
  'warning',
  12000
);
```

不得展示 `rejected_shots` 的完整模型内容；仅在 `console.warn` 中记录脱敏的 `reason` 与 `codes`，供开发排查。

- [ ] **Step 4: 在问题记录页合并当前账号诊断**

在 `frontend/src/shared/api/client.js` 新增：

```js
export function listMyNovelPanelDiagnostics(limit = 100) {
  return apiRequest(`/api/novel-panel/diagnostics?limit=${encodeURIComponent(limit)}`);
}
```

在 `IssueLogPage.jsx` 用 `Promise.allSettled` 并行读取两种来源：客户端错误读取失败仍显示诊断，诊断读取失败仍显示客户端错误。把诊断映射为现有列表字段：

```js
{
  id: `novel-panel:${entry.id}`,
  at: entry.at,
  kind: `novel-panel.${entry.category}`,
  message: `${entry.operation}：${entry.outcome === 'partial' ? `已保留 ${entry.outline_accepted || 0} 条分镜` : entry.error || '请求已完成'}`,
  path: '/novel-panel',
  method: 'POST',
  status: entry.http_status,
  diagnosticId: entry.id
}
```

在既有 `description` 行后追加 `诊断编号：${entry.diagnosticId}`，只在该字段存在时显示。保持现有 `List`、`Tag`、刷新按钮和 CSS 类名，不新增卡片或页面布局。

- [ ] **Step 5: 运行静态契约与前端构建**

Run:

```bash
node --test --test-name-pattern='novel-panel surfaces partial outlines and diagnostics in existing issue UI' tests/novel-panel-asset-contract.test.js
npm --prefix frontend run build
```

Expected: 测试 PASS，Vite 构建成功。

- [ ] **Step 6: 记录检查点，不创建提交**

Run: `git diff --check -- public/novel-panel/workbench/app.js frontend/src/shared/api/client.js frontend/src/user/pages/IssueLogPage.jsx tests/novel-panel-asset-contract.test.js`

Expected: 无空白错误。

## Task 5: 端到端验证与服务重启

**Files:**
- Modify: `tests/novel-panel-stability.test.js`
- Modify: `tests/novel-panel-asset-contract.test.js`

- [ ] **Step 1: 运行完整小说面板回归集**

Run:

```bash
node --test tests/novel-panel-stability.test.js
node --test tests/novel-panel-asset-contract.test.js
git diff --check
```

Expected: 两个测试文件全部 PASS，`git diff --check` 无输出。

- [ ] **Step 2: 重启统一服务并验证配置仍生效**

Run:

```bash
launchctl kickstart -k "gui/$(id -u)/com.ming.qiantie
```

随后登录当前账号，验证：

```http
GET /api/novel-panel/character-core/health
GET /api/novel-panel/runtime-config
GET /api/novel-panel/diagnostics?limit=20
```

Expected: 健康接口为 `v77-hotfix26`，运行时等待上限为 `400`，诊断接口只返回当前账号条目。

- [ ] **Step 3: 浏览器验证两种真实页面状态**

在 `http://127.0.0.1:3000/novel-panel` 使用小文本完成一次内容分析或分镜生成，确认生成后的问题记录出现对应小说面板诊断。使用可控测试环境或测试路由复核部分保留提示；不把真实远程模型随机产生坏行引用当作唯一浏览器验收手段。

Expected: 页面无布局变化；成功状态不显示私密数据；部分成功提示包含保留数、未写入数和诊断编号。

- [ ] **Step 4: 报告验证边界**

最终报告必须分别说明：已通过的自动化测试、已验证的本机 HTTP/浏览器行为、未验证的真实长原文远程模型时延。不得声称长原文 504 已完全消失；该问题现在应当可由诊断事件定位。
