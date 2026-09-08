# v88 Novel Fetch Source Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户提供的旧版小说获取/批量提交流程转化为 v88 的模块化、可验收链路，先稳定 121 登录和原文获取，再完成提交确认与公网发布证据。
**Architecture:** 保留 v88 Node + Browser Worker + MySQL 架构；旧压缩包只提供状态机、配置同步、按书籍隔离和显式确认的设计参考。登录与提交集中在 `121-web-submit-service`，原文获取集中在 `novel-fetch`/`tasks`，批处理由 `runner`/`v2-batch-executor` 编排。
**Tech Stack:** Node.js, Express, React/Vite, MySQL store, Playwright Browser Worker, Docker Compose, Node test runner.
**Spec:** `docs/superpowers/specs/2026-09-09-v88-novel-fetch-source-design.md`

## Global Constraints

- 只在从 `origin/v88` 建立的隔离工作树开发；完成后由主负责人审查后才考虑合并 `v88`。
- 不修改、删除或切换 `master`；不操作 V78/production 容器；ECS 只允许命名的 v88 目标容器。
- 不提交账号、密码、Cookie、session state、Token、API Key、Worker secret、旧版 `data/` 或 `runtime/`。
- 不能把测试通过、Worker healthy、401、任务 ID、静态 build-info 或本地构建当作登录成功、公网发布或端到端成功。
- 所有登录、获取、提交结果必须按单本保留状态；Worker 基础设施错误必须保持 503 语义，目标站会话失效保持 401 语义。
- 上传成功只有在明确接收反馈并通过匹配书籍列表核验后才算确认；未核验必须显示 `accepted_pending`。
- 主负责人负责最终代码写入、审查、合并、构建、发布和用户验收；固定员工可执行隔离任务，但不能把报告当作代码证据。

---

## Task 1: 对齐 v88 小说获取源文件与接口合同

**Files:** `frontend/src/shared/api/novelFetch.js`, `routes/novel-fetch.js`, `routes/novel-fetch-upload.js`, `routes/novel-fetch-workshop.js`, `tests/` 相关小说获取合同测试。

- [ ] 写失败测试：逐一断言登录、会话、环境、配置同步、风格同步、预览、提交和原文获取的前端路径，且每条路径都有后端挂载点。
- [ ] 写失败测试：断言登录和上传响应不会含密码、Cookie、secret 或 Token 字段。
- [ ] 最小修改 API 映射和路由适配，让同一动作只有一个真实后端入口；保留兼容入口时转发而不复制状态。
- [ ] 运行对应合同测试，确认红灯转绿；运行 `git diff --check`。
- [ ] 记录文件、测试命令、输出和用户可见影响，提交一个只包含 Task 1 的 commit。

## Task 2: 完成 121 登录、会话验证和配置同步链路

**Files:** `lib/novel-fetch-workshop/121-browser-client.js`, `121-credential-store.js`, `121-web-submit-service.js`, `v2-compose.js`, `routes/novel-fetch-upload.js`, 相关测试。

- [ ] 写失败测试：Worker 内部 401/不可用/超时分别得到 503 基础设施语义；目标站 `session_expired` 保持 401；成功登录后 session store 能被后续测试读取。
- [ ] 写失败测试：配置档同步和风格同步走同一已验证会话，并返回掩码配置，不返回敏感字段。
- [ ] 实现有限超时、错误分类、按用户会话保存和重试；不新增旧 PHP 登录回退。
- [ ] 运行 121 相关合同测试与全 Node 测试，记录精确通过/失败数量；失败若为基线问题，写入 ledger，不伪装成通过。
- [ ] 提交 Task 2，并让固定小说员工在其隔离上下文复核登录链路；主负责人检查 diff 后再继续。

## Task 3: 稳定原文获取、保存、预览和单本重试

**Files:** `routes/novel-fetch.js`, `lib/novel-fetch-workshop/tasks.js`, `fetch-policy.js`, `runner.js`, 前端小说获取页面及测试。

- [ ] 写失败测试：输入书籍 ID、平台和字数上限时能调用目标源；空正文、格式错误、网络超时和短正文分别进入明确状态。
- [ ] 写失败测试：原始返回、处理后正文、元数据、日志按书籍隔离；刷新详情不会丢失已保存正文。
- [ ] 实现单本可重试和批量单项失败隔离；不因某一本失败而返回整批成功。
- [ ] 运行原文获取合同、页面合同和全 Node 测试；提交 Task 3。

## Task 4: 完成提交网络的 accepted_pending → confirmed 状态机

**Files:** `lib/novel-fetch-workshop/121-web-submit-service.js`, `target-web-submit.js`, `v2-batch-executor.js`, `routes/novel-fetch-upload.js`, 提交状态测试。

- [ ] 写失败测试：上传接口已接收但书籍列表没有匹配记录时必须是 `accepted_pending`，不能标记为成功。
- [ ] 写失败测试：书号、平台、风格、版本和素材数量匹配后才进入 `confirmed/submitted`；单本失败不影响其他书。
- [ ] 实现列表核验、可重复查询和单本重试；清理外部临时 URL 前先保存需要的结果，不把临时 URL 当永久资源。
- [ ] 运行提交合同与批处理测试；提交 Task 4。

## Task 5: 本地完整构建与用户可见验收包

**Files:** 发布所需的 v88 构建文件、测试证据文件和不含敏感信息的验收记录。

- [ ] 在隔离工作树执行 Node 合同测试、前端构建、`git diff --check` 和构建身份检查。
- [ ] 启动本地 v88 验收入口；确认页面显示登录、配置同步、原文预览、提交确认四类状态。若没有可用 121 凭据，只记录“合同验收”，不宣称真实登录。
- [ ] 生成包含源码 SHA、镜像/包 SHA256、测试数量和未完成项的发布候选记录；不带账号密码和 Token。

## Task 6: 固定员工复核、v88 合并和 ECS 公网验证

**Files:** `deploy/v88-public/`、Compose/Nginx 配置和发布记录；只允许 v88 目标容器。

- [ ] 让固定小说员工复核 Task 1-4，固定公网员工检查目标 v88 镜像、监听、Nginx upstream 和 `/api/build-info`；他们只返回证据，不修改 `master` 或 V78。
- [ ] 主负责人审查所有 commit 和测试，确认没有旧压缩包运行数据或敏感配置后，才在明确发布边界内合并到 `v88`。
- [ ] 用合并后的同一 SHA 构建并准备发布包，先在 ECS 目标 v88 容器 stage，再核对 `/api/build-info`。
- [ ] 依次完成公网 `/novel-fetch` 登录、配置同步、书籍原文获取、提交网络和列表确认；任一环节失败就保留失败证据，不宣称全流程完成。
