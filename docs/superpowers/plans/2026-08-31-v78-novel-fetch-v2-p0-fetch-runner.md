# V78 小说获取 V2 P0：Fetch Contract / Runner Foundation 实施计划

> **Base:** `hotfix/production-v78.3.0.3-novel-fetch-timeout@c909369283d756e3a3f659db05af156a5efb4523`
> **Branch:** `feat/v78-novel-fetch-v2-completion`
> **Design:** `docs/superpowers/specs/2026-08-31-v78-novel-fetch-v2-completion-design.md`

**Goal:** 让 V78 小说获取的 `fetch.timeout_seconds / fetch.retries / platformId` 成为真实后端行为，并把现有 process 编排抽成可复用 Runner 基础，不改变现有页面主流程或进入 V11。

**Architecture:** 新增纯函数 `fetch-policy.js` 负责配置归一、可恢复错误判定和重试；`tasks.js` 的 upstream fetch 接收明确 `endpoint/timeoutMs`；新增 `runner.js` 承载当前批处理业务编排，`routes/batch-rewrite.js` 只做 HTTP/依赖装配。

**Tech:** Node.js 24 compatible CommonJS, `node:test`, V78 Express compatibility router.

## Task 1 — Fetch policy RED → GREEN

**Files**
- Create: `lib/novel-fetch-workshop/fetch-policy.js`
- Create: `tests/novel-fetch-fetch-policy.test.js`

### RED

先写测试，定义 wished-for API：

```js
const {
  normalizeFetchPolicy,
  fetchWithPolicy
} = require('../lib/novel-fetch-workshop/fetch-policy');
```

必须先失败并确认失败原因是模块/行为不存在。

测试行为：

1. `timeout_seconds: 15` → `timeoutMs === 15000`。
2. timeout clamp：小于 1 秒变 1000ms，大于 120 秒变 120000ms。
3. `retries: 2` → 最多 3 次尝试；前两次可恢复错误、第三次成功时返回 attempts=3。
4. `retries: 0` → 只调用一次。
5. 空正文按可恢复错误处理并重试，最终仍空则失败。
6. `error.recoverable === false` 时不重试。
7. 每次调用 upstream 都使用同一个传入 `platformId`，证明不自动换平台。

执行：

```bash
node --test tests/novel-fetch-fetch-policy.test.js
```

期望 RED。

### GREEN

实现：

```js
function normalizeFetchPolicy(fetchConfig = {}) {
  const timeoutSeconds = clampNumber(fetchConfig.timeout_seconds, 1, 120, 30);
  const retries = clampInteger(fetchConfig.retries, 0, 5, 1);
  const concurrency = clampInteger(fetchConfig.concurrency, 1, 32, 4);
  const endpoint = String(fetchConfig.endpoint || 'https://txt.121w.com/api.php').trim();
  return { endpoint, timeoutMs: timeoutSeconds * 1000, retries, concurrency };
}
```

`fetchWithPolicy`：

- `maxAttempts = retries + 1`。
- 调用 `fetchUpstream(bookId, platformId, maxTxt, { endpoint, timeoutMs, attempt })`。
- 空 `text` 转为带 `code='EMPTY_ORIGINAL'` 的 recoverable error。
- `recoverable === false` 立即抛出。
- 失败最终抛出时附 `attempts`。
- 不生成、推断、尝试其他 platformId。

再次执行同一命令，必须 GREEN。

## Task 2 — tasks.js 真正使用 timeout/retries

**Files**
- Modify: `lib/novel-fetch-workshop/tasks.js`
- Modify: `tests/novel-fetch-fetch-policy.test.js`（仅增加集成行为）

### RED

增加测试/fixture 证明当前 `createWorkshopTasks` 的 injected upstream 能收到第四个 options 参数，并且 `fetchOriginal(..., fetchConfig)` 会按 policy 重试。

如果完整 tasks fixture 太重，允许先把 `defaultFetchUpstream` 导出成 `createDefaultFetchUpstream` 并对 adapter 单测，但仍必须覆盖 `fetchOriginal` 最终经过 `fetchWithPolicy`。

### GREEN

修改：

```js
function defaultFetchUpstream(bookId, platformId, maxTxt, options = {}) {
  const endpoint = new URL(options.endpoint || UPSTREAM_URL);
  endpoint.searchParams.set('bookid', bookId);
  endpoint.searchParams.set('platform', platformId);
  endpoint.searchParams.set('max_txt', maxTxt);
  // only https for the existing txt endpoint in P0
  // req timeout uses options.timeoutMs
}
```

`fetchOriginal` 新签名保持向后兼容：

```js
async function fetchOriginal(username, bookId, maxTxt, fetchConfig = {})
```

内部调用 `fetchWithPolicy`，成功日志增加 `attempts`；失败日志记录 attempts/error，返回 `{status:'failed', attempts, error}`。

不要在这里实现平台自动识别。

执行 focused tests；GREEN 后再执行现有 task/route tests（如果存在）。

## Task 3 — 抽取可测试 Runner

**Files**
- Create: `lib/novel-fetch-workshop/runner.js`
- Create: `tests/novel-fetch-runner.test.js`
- Modify: `routes/batch-rewrite.js`

### RED

测试 wished-for：

```js
const { runNovelFetchBatch } = require('../lib/novel-fetch-workshop/runner');
```

最少证明：

1. `payload.platform_id='15'` 时所有 prepared task 都是 platform `15`。
2. fetch 阶段调用 `tasks.fetchOriginal(username, bookId, maxTxt, config.fetch)`，即真实 fetch policy 进入 task 层。
3. fetch 失败任务不进入 rewrite。
4. `workflow.auto_fetch_original=false` 时不调用 fetch。
5. `workflow.auto_submit_after_rewrite=true` 但 `auto_submit_confirmed!==true` 时不自动提交。
6. report 事件包含 parse/classify/fetch/rewrite/submit 的真实状态。

测试用 dependency injection，不启动 Express、不访问网络。

### GREEN

将当前 `routes/batch-rewrite.js::processPayload()` 的业务编排搬到 `runner.js`：

```js
async function runNovelFetchBatch({
  username,
  payload,
  configStore,
  tasks,
  parse,
  classifier,
  rewrite,
  applyRules,
  submit,
  listTasks,
  report
})
```

路由内的 `processPayload` 只负责 `resources(req)` 和 callbacks 装配：

```js
return runNovelFetchBatch({
  username: req.username,
  payload,
  configStore: store,
  tasks,
  parse,
  classifier,
  rewrite,
  applyRules: (...args) => applySavedRulesToOriginal(...args),
  submit: body => submitTasks(req, body),
  listTasks: () => listTasks(req),
  report
});
```

保持返回字段、现有 route URL 和 UI contract 不变。

## Task 4 — V78 UI 删除伪“自动识别平台”语义

**Files**
- Modify: `frontend/public/batch-rewrite/index.html`
- Modify: `frontend/public/batch-rewrite/app.js`
- Modify/Create: `tests/batch-rewrite-flow-ui.test.js`

### RED

增加 source/DOM contract 测试：

- 页面不能再宣称“平台自动识别（推荐）”。
- 保存 workflow 时不应把用户未理解的 auto-detect 作为有效 P0 行为。
- 平台选择仍存在并保存。

### GREEN

P0 最小 UI：移除/隐藏 `fetchAutoDetectPlatform` 控件，配置读取时忽略旧值；后端仍可兼容读取旧配置但不执行平台切换。

不要重写页面布局。

## Task 5 — P0 回归验证和提交

执行能运行的全部验证：

```bash
node --test tests/novel-fetch-fetch-policy.test.js tests/novel-fetch-runner.test.js tests/batch-rewrite-flow-ui.test.js
node --test routes/*.test.js lib/**/*.test.js tests/*.test.js
npm --prefix frontend run build
```

如果执行环境无法联网或 runner 没启动，必须把“未执行”与“执行失败”分开报告，不能写 PASS。

检查 diff 只能触及 P0 文件和本计划/spec；不碰 V11、Go/MySQL、Docker、121 Browser Worker。

P0 完成标准：

- timeout/retries 真正生效。
- fixed platform 不会被自动切换。
- route 使用 Runner，Runner 使用真实 fetch policy。
- focused RED→GREEN 有执行证据。
- 不部署 `:3000`。
