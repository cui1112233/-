# 小说获取登录稳定化实施计划

> **For the implementation agent:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this plan. Do not improvise a second login architecture.

**目标：** 将小说获取的 121 登录链路收敛为一条可诊断、可恢复的 V88 流程，解决页面上反复出现的 `unauthorized`、`fetch failed` 和长时间验证后超时，并把“平台登录失效”“Browser Worker 配置错误”“目标站登录失效”分开呈现。

**范围：** 只处理小说获取登录、会话验证和与其直接相关的 V88 发布验收。批量工厂、H3、豆包执行器不在本计划内；不修改、停止、删除或重建任何旧 V78 容器。

**现状判断：**

- 真实页面是 `frontend/public/batch-rewrite/index.html`，由 `frontend/public/batch-rewrite/app.js` 和 V2 注入脚本共同工作。
- 页面登录按钮当前先调用 `/api/novel-fetch-upload/upload-login`，随后又调用 `/api/batch-rewrite/web-submit/config`；后一个 V2 服务会再次登录，导致重复调用和错误归属不清。
- V2 服务的登录、会话刷新、提交链路已经统一使用 `121-browser-client.js`；因此 V2 `/api/batch-rewrite/web-submit/config` 应作为页面登录的唯一入口。
- 主服务 API 令牌、Node→Worker 内部密钥、Worker→`two.121w.com` 目标站会话是三个不同层次；其中任一层失败都不能继续用“登录失败”泛化。
- 已有健康检查证明 Node→Worker 曾能返回 HTTP 200，但尚未证明当前公网入口加载的是同一份 V88 构建，也尚未完成真实目标站登录验收。

## 约束与验收边界

- 全部代码工作在 `v88` 的 F 盘主仓库镜像中；若 F 盘镜像尚未通过只读校验，先暂停代码任务并报告，不直接在旧 C 盘副本上开发。
- 不切换、不修改 `master`；不使用 `git reset --hard`、`git checkout --`、`git clean` 或全量 `git add .`。
- 只提交本计划明确列出的文件；保留工作树中已有的构建产物、数据和用户改动，不能借机清理。
- 不打印或回传密码、Cookie、Authorization token、Worker secret、storage state 或账号凭据。
- 本地单元测试、Worker 模拟测试和 HTTP 200 只证明对应层；只有用户在登录态下通过公网页面完成一次登录、会话验证和小说获取，才可称为端到端通过。

---

## 任务 1：确认 F 盘工作区和当前基线

**目的：** 避免把修复写入错误副本或把旧 V78 发布物当成 V88。

**只读检查：**

1. 在 `F:\qiantie-v88` 执行 `git branch --show-current`、`git rev-parse --show-toplevel`、`git rev-parse HEAD` 和 `git status --short`。
2. 确认当前分支是 `v88`，仓库根目录是 `F:\qiantie-v88`；记录工作树原有脏文件清单，不修改它们。
3. 对照 C 盘副本的 HEAD、分支和关键源文件 SHA-256；若 F 盘不是现有源码的安全副本，先由主负责人完成“复制、核对、再开发”，本任务不在 C 盘继续写入。

**通过标准：** 输出明确的 F 盘仓库根目录、`v88` 分支、基线 commit 和“既有改动未被触碰”。

## 任务 2：先补充三层错误合同测试

**文件：**

- `tests/121-browser-client.test.js`
- `services/121-browser-worker/test/server.test.js`
- `tests/batch-rewrite-v2-router.test.js`
- 新增 `tests/novel-fetch-login-ui-contract.test.js`（只检查可测试的页面源码合同，不启动真实浏览器）

**步骤：**

1. 在 `tests/121-browser-client.test.js` 增加测试：Worker 返回 HTTP 401 且 JSON 为 `{ error: 'unauthorized' }` 时，客户端产生稳定的内部鉴权错误 code/message；Worker 返回 HTTP 401 且 JSON 为 `{ error: 'session_expired', status: 'expired' }` 时，仍保留“目标站会话失效”语义，不能误判成内部密钥错误。
2. 增加网络异常和 AbortError 测试，确认 `fetch failed` 映射为 `BROWSER_WORKER_UNAVAILABLE`，超时映射为 `BROWSER_WORKER_TIMEOUT`，两者都能结束请求而不会让页面永久 loading。
3. 在 `services/121-browser-worker/test/server.test.js` 固定错误合同：错误内部密钥仍为 HTTP 401，但响应必须能被上层识别为 Worker 内部鉴权失败；正确密钥的 `/healthz` 和登录请求不回显密钥。
4. 在 `tests/batch-rewrite-v2-router.test.js` 覆盖错误状态映射：Worker 配置错误、Worker 不可用、登录超时、目标站会话过期分别得到稳定 HTTP 状态和 code。
5. 新增页面合同测试，锁定登录按钮只调用 V2 `/api/batch-rewrite/web-submit/config` 一次，不再在一次点击中先调用旧 `/api/novel-fetch-upload/upload-login` 再重复登录；验证失败文本必须来自返回的可操作错误。

**先运行：** 以上测试应先至少有一个因当前重复登录/错误 code 不满足而失败，失败输出要能证明测试确实击中了目标行为。

## 任务 3：统一页面登录入口和错误呈现

**文件：**

- `frontend/public/batch-rewrite/app.js`
- `frontend/public/batch-rewrite/121-login-hotfix.js`（仅在源码合同显示它仍被发布链路加载时修改）
- `tests/batch-rewrite-flow-ui.test.js`
- `tests/novel-fetch-v2-ui.test.js`（若其断言受路径调整影响）

**实现要求：**

1. 修改 `openWebLoginDialog()`：使用已经存在的 `api('/api/web-submit/config', { method: 'POST', body: JSON.stringify({ settings }) })` 作为唯一登录保存入口；`settings` 只在内存中带入本次密码，保存后只保留 `password_masked`，不能在前端 localStorage、Node 会话引用或响应中保存明文密码。
2. 成功返回后使用服务端返回的 `settings` 更新账号和登录状态；不要再调用旧 `/api/novel-fetch-upload/upload-login`。旧接口保留给兼容 API 使用者，但不再是当前页面的主路径。
3. 将页面对 V2 `/api/batch-rewrite/web-submit/*` 的调用统一走同一套认证、超时和错误转换逻辑；若保留 `novelFetchPlatformApi`，必须让它区分主平台 401、Worker 内部 401、Worker 网络失败、Worker 超时和目标站会话过期。
4. 用户可操作提示固定为：
   - 主平台令牌失效：提示重新登录前贴系统，不提示“浏览器登录服务失败”；
   - Worker 内部鉴权失败：提示“服务器浏览器服务配置不一致，请联系管理员”，不要求用户反复输入 121 密码；
   - Worker 不可用或超时：提示服务地址/服务状态，并允许重试；
   - 121 会话过期：提示重新保存 121 账号密码；
   - 目标站明确拒绝账号密码：提示目标站账号或密码错误。
5. 登录按钮、验证按钮和提交按钮在失败后都必须恢复可点击状态；错误提示不得吞掉后端 code，也不得把 HTML 502 页面原文整段展示给用户。

**实现后运行：** 任务 2 的测试，以及 `tests/batch-rewrite-flow-ui.test.js`、`tests/novel-fetch-v2-ui.test.js`。

## 任务 4：统一服务端 Worker 错误分类并保持会话安全

**文件：**

- `lib/novel-fetch-workshop/121-browser-client.js`
- `routes/novel-fetch-upload.js`
- `routes/batch-rewrite-v2.js`
- `services/121-browser-worker/src/server.js`
- `tests/121-browser-client.test.js`
- `tests/novel-fetch-upload-browser-worker.test.js`

**实现要求：**

1. 在 `121-browser-client.js` 对 Worker 返回的 `{ error: 'unauthorized' }` 赋予专用内部配置错误 code；对 `{ error: 'session_expired', status: 'expired' }` 保留会话过期 code；对网络异常和超时沿用现有稳定 code。
2. 在两个路由层将内部 Worker 鉴权错误映射为服务配置错误（建议 HTTP 503），避免浏览器端的统一 401 处理误清除用户主平台 token；目标站会话过期仍按 401/`notLoggedIn` 业务语义处理。
3. 保留“Worker-only”边界：禁止恢复旧 PHP Cookie 登录、猜测式备用接口或把 Cookie/密码写入 `upload-target.json`。会话引用只能包含 opaque `sessionKey`、目标用户名、目标 base URL 和状态。
4. 检查 `upload-login` 兼容接口和 V2 `saveConfig` 的行为一致：当前页面只走 V2；兼容接口若继续保存会话引用，测试必须确保不写入明文密码或 Cookie。不要为了本任务引入新的会话存储格式。
5. 检查 `QIANTIE_121_STORAGE_STATE_SECRET`：本任务不把它伪装成登录修复；如果代码仍未使用它，只在诊断输出/部署验收中明确为安全债务，不因警告擅自破坏现有会话存储。

**实现后运行：** `node --test tests/121-browser-client.test.js tests/novel-fetch-upload-browser-worker.test.js tests/batch-rewrite-v2-router.test.js services/121-browser-worker/test/server.test.js`。

## 任务 5：让 V88 构建和公网入口可识别、可验收

**文件：**

- `app.js`
- `tests/novel-fetch-v88-mainline-version-config.test.js`（或新增最小 build-info 合同测试）
- `frontend/public/batch-rewrite/index.html`（仅当缓存标记需要更新）
- 构建输出由项目既有构建脚本生成，不手工编辑 hashed asset

**实现要求：**

1. 将 `/api/build-info` 从硬编码的 V78 值改为由明确的 V88 发布环境变量/构建常量提供，默认值也必须标识当前 V88 主线；保留 `branch`、`git_sha`、`deployed_at`、`deploy_mode` 等可诊断字段时，不能伪造不存在的 commit 或部署时间。
2. 构建前记录 `git rev-parse HEAD`；构建后检查 `/batch-rewrite/index.html` 实际注入的脚本版本与本次源文件一致，避免公网继续返回旧 V78 页面。
3. 只生成必要的前端构建结果；不把 `node_modules`、用户 data、压缩包、临时目录和 ECS 密钥加入本次提交。

**通过标准：** 本地静态页返回 200，`/api/build-info` 能明确显示 V88；构建检查不出现旧入口引用当前 V78 节点的结果。

## 任务 6：V88 ECS 分层验收与部署交接

**范围：** 仅 `v88-public-v88-node-1`、`v88-public-nginx-1`、`v88-public-novel-fetch-121-worker-1` 及其 V88 Compose 配置；不操作任何 `v78-*` 容器。

**执行顺序：**

1. 在 ECS 控制台终端进入 `/opt/qiantie/v88/deploy/v88-public`，先执行只读的 Compose 配置校验和 `docker ps`，确认目标容器名称；不要用模糊的旧容器名。
2. 只重建/启动 V88 节点和 Worker 必要服务，使用部署文件中已经配置的同一内部 secret；命令输出只显示“是否一致”，绝不 `echo` secret。
3. 分层验证：
   - ECS 本机 `127.0.0.1:3000/api/build-info`：确认 V88 build info；
   - V88 节点到 Worker `/healthz`：确认 HTTP 200；
   - 未登录访问受保护 API：预期是主平台 401，证明主平台鉴权仍在；
   - 已登录浏览器打开 `/novel-fetch`：输入 121 账号密码，完成一次“保存并验证”；
   - 点击环境检测，确认目标站浏览器会话和 Worker 均通过；
   - 输入一个用户指定的书籍 ID，完成一次小说获取并确认正文落盘。
4. 若公网入口仍拒绝连接或返回旧 build info，停止继续改登录代码，先处理 ECS 端口/Nginx/upstream/安全组边界；登录代码通过不能修复公网入口拒绝连接。

**端到端通过标准：** 页面加载的是 V88；主平台登录态有效；保存 121 账号后页面显示登录成功；环境检测通过；小说获取返回正文。仅看到 Worker healthy、HTTP 200 或测试通过，不能替代此标准。

## 任务 7：审查、提交、部署记录

**提交边界：** 只提交本计划实际修改的源文件、测试和必要文档；不提交 `frontend/dist` 的无关删除/新增、`data`、压缩包、私钥、公钥、`node_modules` 或其他既有脏文件。

**步骤：**

1. 执行全套相关测试、前端构建、`git diff --check`，保存测试数量和关键结果。
2. 用 `git diff --name-only` 与计划逐项核对，确认没有改动 `master` 或旧 V78 配置。
3. 由主负责人审阅独立聊天的 diff；若实现聊天只给出建议或报告，不把报告当作已完成代码。
4. 在 `v88` 创建一个主题明确的提交；部署前记录 commit，部署后记录 ECS build info、目标容器状态和端到端验收结果。
5. 将本次决策、实际根因、修复文件、测试结果、部署结果和未解决的 `QIANTIE_121_STORAGE_STATE_SECRET` 安全债务写入 `F:\软件\本地记忆\本地记忆\00_Codex\Inbox\2026-09-08.md`、`F:\软件\本地记忆\本地记忆\00_Codex\Projects\qiantie-v88.md` 和 `F:\软件\本地记忆\本地记忆\Codex项目协作规则.md`。

## 最终交付物

- 一条不重复登录的小说获取登录路径。
- 可区分平台 token、Worker 内部鉴权、Worker 网络/超时、目标站会话过期和目标站账号密码错误的错误合同。
- 对应测试和构建证据。
- V88 ECS 分层验收记录；若公网边界仍未修复，明确标记为阻塞，不声称小说获取端到端完成。
