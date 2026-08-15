# Task 4 报告

## 变更

- 在 `tests/agent-routes.test.js` 新增真实 Agent 路由回归测试。
- 测试使用完整的 CM 受限剧本上下文形状，验证 `novelText`、`extracted`、`scriptOutput` 可在本次请求中到达 responder。
- 验证顶层及 `extracted` 嵌套凭据字段不会进入 responder，也不会写入 `agent-tasks.json`。

## 验证

- 聚焦测试：`node --test tests/agent-routes.test.js frontend/src/shared/pet/stacky.test.js frontend/src/shared/pet/scriptCollaboration.test.js tests/cm-agent-ui-contract.test.js tests/script-draft-persistence-contract.test.js`
  - 通过：45/45。
- 完整 Node 测试：`node --test tests/*.test.js lib/*.test.js`
  - 261 通过、10 失败，未修改无关实现。失败项：
    - `the supplied Downloads skills folder exposes every top-level SKILL.md for platform import`：缺少 `F:\Users\ming\Downloads\skills`。
    - `persists a mutated task document privately without relying on stale temporary files`：预期 384，实际 438。
    - `novel-panel partial outline feedback and issue page diagnostics remain wired without a new layout`。
    - `qiantie navigation renders the V77 workbench in a same-origin iframe`。
    - `novel-panel iframe uses an isolated instance, server drafts, and abortable bridge requests`。
    - `novel-panel feature pages and dynamic notices use theme tokens`。
    - `persistent sessions store only a token digest and expire safely`：预期 384，实际 438。
    - `brand and project deeplinks return users to the expected platform workspace`。
    - `script empty state exposes themed light-card structure`。
    - `script empty state has responsive themed motion styles`。
- 前端构建：`npm --prefix frontend run build` 成功；仅产生现有的 Vite chunk 大小警告。

## 手动验收

按任务指令未启动长期服务，也未进行手动 UI 验收。

## Important Finding 1 修复（2026-08-15）

### 修复详情

- 仅调整 `tests/agent-routes.test.js` 中 CM 剧本上下文回归测试；未修改产品代码。
- 根因：旧测试直接构造 `extracted` 对象，未覆盖浏览器端 `normalizePetContext()` 实际输出的 JSON 字符串。
- 测试通过动态 `import('../frontend/src/shared/pet/stacky.js')` 调用真实 `normalizePetContext()`，随后 POST `/api/agent/chat`。
- 验证规范化后的 `extracted` 是 JSON 字符串；responder 接收原字符串或服务端规范后的等价安全对象；`novelText`、`scriptOutput` 保留。
- 验证 `authorization`、`credential`、`accessToken`、`apiKey`、`token` 及嵌套凭据均不进入 responder，也不写入 `agent-tasks.json`。

### 命令与结果

- `node --test tests/agent-routes.test.js`
  - 通过：17/17；失败：0；退出码：0。
