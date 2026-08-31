# V78 小说获取 V2 P3：121 Browser Worker 实施计划

**依赖：** P0-P2 完成。  
**Branch:** `feat/v78-novel-fetch-v2-completion`

**Goal:** 以原始系统真实网页登录/storage-state 行为为 golden reference，为 V78 提供独立 121 Browser Worker，替代当前把 `/tttadmin/api/login.php` 当作唯一登录契约的脆弱实现，同时不把 Playwright/Chromium 塞进 V78 主 Node 镜像。

## Task 1 — Worker protocol contract

**Files**
- Create: `services/121-browser-worker/package.json`
- Create: `services/121-browser-worker/src/contracts.js`
- Create: `tests/121-browser-worker-contract.test.js`

内部 API：

```text
POST   /session/login
POST   /session/test
POST   /session/refresh
DELETE /session
```

请求只接受主服务签名/内部 secret、owner-scoped session key、base URL 与需要时的 credentials。响应不包含明文密码/cookie/storage state。

## Task 2 — Playwright page login state machine

**Files**
- Create: `services/121-browser-worker/src/login.js`
- Create: `services/121-browser-worker/test/login.test.js`

行为基线：

1. 打开 `baseUrl/booklist.php`（或配置的已登录落地页）。
2. 判断是否存在 password/login form。
3. 需要登录时填写 username/password。
4. 点击真实页面登录按钮。
5. 等待离开登录态。
6. password/login form 仍存在则失败。
7. 成功保存 Playwright storage state。

selector 必须允许通过 adapter 配置/候选 selector 列表，不把单一 DOM 文案写死为唯一标准。

## Task 3 — Storage state persistence/recovery

**Files**
- Create: `services/121-browser-worker/src/session-store.js`
- Create: `services/121-browser-worker/test/session-store.test.js`

按 owner + target host + 121 username 派生不可逆 session key。storage state 文件权限最小化，不提交 Git。

TDD：正常复用；过期重新登录；JSON 损坏移动为 `.bad-<timestamp>`；不同 owner 不共享。

## Task 4 — Worker HTTP server

**Files**
- Create: `services/121-browser-worker/src/server.js`
- Create: `services/121-browser-worker/Dockerfile`
- Create: `services/121-browser-worker/test/server.test.js`

Worker 只监听内部网络。所有操作有 wall-clock timeout；默认 15 秒验证窗口，登录可配置但必须有上限。日志不得输出 password/storageState/cookie。

## Task 5 — V78 Browser Worker client

**Files**
- Create: `lib/novel-fetch-workshop/121-browser-client.js`
- Create: `tests/121-browser-client.test.js`
- Modify: `routes/batch-rewrite.js`

主 V78 Node 只调用 worker，不依赖 Playwright。worker 未配置/不可用时 fail-closed，并给出明确“浏览器登录服务不可用”，不能 fallback 回猜测的 login API 并声称成功。

## Task 6 — 121 login/save flow integration

修改 `/web-submit/config` 保存凭据后的认证流程：

- 凭据只发送到自身后端。
- 后端调用 Browser Worker login。
- 成功后保存 owner-scoped session reference/status，而不是把明文密码返回前端。
- 现有直接 HTTP upload 可继续使用由后端获取/刷新后的 authenticated cookie/session material，但 material 不暴露给 browser UI。

旧 `/tttadmin/api/login.php` helper 可以保留为非权威 legacy helper，但新主流程不得依赖它。

## Task 7 — visible test 真正可见

`POST /web-submit/test-visible` 改为调用 worker `session/test` 的 headed/visible 模式（在支持 display 的候选环境）。若 worker deployment 不支持 GUI，则返回明确 capability unavailable，不允许仅 GET dashboard 却叫 visible。

测试必须断言 route 调用了 worker contract。

## Task 8 — Config/style sync/session refresh

`sync-configs` / `sync-styles` / submit 前检查 session；expired 时调用 refresh/relogin；失败则停止目标操作，不使用未认证结果或硬编码 catalog。

## Task 9 — Isolated Docker verification

构建：

- `qiantie-platform:v78-novel-fetch-v2-<sha>`
- `qiantie-121-browser-worker:v78-novel-fetch-v2-<sha>`

只使用临时网络、临时数据卷、临时端口。验证：真实登录、storage state 复用、worker 重启、session 过期恢复、config/style sync、preview、submit、后台记录核验、前端 15 秒错误收敛。

本计划不授权切换 `:3000`。

## Task 10 — Final regression

全量 Node tests、worker tests、frontend build、Docker candidate smoke。任何需要生产凭据的验收只由授权的隔离环境执行；测试/日志/commit 不记录凭据。
