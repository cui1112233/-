# V88 项目协作、Git 治理与 H3 接入设计

## 1. 目标与边界

本阶段目标是把 qiantie-v88 变成可持续迭代的稳定项目：

1. 保留 `v88` 作为唯一稳定集成主线，不修改 `master`。
2. 将主仓库安全迁移到 `F:\qiantie-v88`，保留原 C 盘目录作为回退副本，验证完成前不删除、不重置、不清理。
3. 由主负责人统一审核、合并、部署和最终验收；其他聊天按任务在隔离工作目录执行，并交付提交号、补丁、测试结果和未解决项。
4. 先稳定小说获取登录，再处理批量工厂、MiniMax H3 和豆包执行器。
5. 所有重要决策、证据、提交号和部署结果同步到 Obsidian，不记录密码、Cookie、Token、API Key 或内部密钥原文。

当前仓库的工作区存在大量未提交内容，包含有效源码修改、构建产物、依赖目录、数据、压缩包和临时文件。因此不允许使用 `git add .`、`git reset --hard`、`git clean` 或直接删除原目录作为整理手段。

## 2. 协作角色与工作目录

### 主负责人

当前主聊天负责：

- 读取项目规则和记忆；
- 拆分任务、审核设计和补丁；
- 维护 `v88`；
- 合并已验证分支；
- 执行部署、回滚和端到端验收；
- 把结果同步到 Obsidian。

### 分派聊天

每个聊天只负责一个清晰领域：

- `novel-login`：浏览器登录、Node、121 Worker、Chromium、会话保存和小说获取。
- `batch-factory`：批量工厂 V11 前端、Go API、任务状态和小说获取转入。
- `minimax-h3`：H3 provider、请求体映射、异步轮询、临时结果下载和模型能力配置。
- `doubao-executor`：Electron 执行器、登录态、内部桥接、提交和结果回收。
- `qa-integration`：只有在各功能合并后执行统一回归，不提前修改业务代码。

实际代码只能写在以 `v88` 为基线的独立工作目录。建议目录为：

```text
F:\qiantie-v88                         # 唯一主仓库
F:\qiantie-v88-worktrees\novel-login
F:\qiantie-v88-worktrees\batch-factory
F:\qiantie-v88-worktrees\minimax-h3
F:\qiantie-v88-worktrees\doubao-executor
```

建议分支名：

```text
fix/novel-fetch-login
feat/batch-factory-v11
feat/minimax-h3
fix/doubao-executor
chore/git-hygiene
```

聊天任务没有返回提交号、变更文件、测试命令和结果时，主负责人不合并。

## 3. Git 渐进治理方案

### 阶段 A：安全迁移

1. 只读盘点当前分支、HEAD、远程、工作区变更和未跟踪文件。
2. 将当前 C 盘目录复制到 `F:\qiantie-v88`，不移动、不覆盖、不删除原目录。
3. 在 F 盘副本核对分支、HEAD、工作区状态和关键文件哈希。
4. 在 F 盘完成一次可回退的本地检查后，才把 F 盘标记为主仓库；C 盘保留为回退副本。

### 阶段 B：分类与基线

将未提交内容分为：源码、测试、文档、构建输出、依赖目录、运行数据、发布包、临时诊断文件和敏感文件。只对确认属于项目规则的内容添加 `.gitignore` 或迁移规则，不自动删除未知文件。

对当前有效改动建立一个明确的恢复点，恢复点必须说明“现状快照”而不是“已验证功能”。稳定功能再分别形成小提交，提交信息使用 `feat`、`fix`、`test`、`docs`、`chore` 前缀。

### 阶段 C：日常合并

每个功能遵循：任务卡 → 独立工作目录 → 小提交 → 测试 → 主负责人审核 → 合并到 `v88` → 推送 → 部署 → 端到端验收。禁止多个聊天同时编辑主仓库同一文件。

## 4. 功能交付顺序与验收标准

### 4.1 小说获取登录

必须分别证明静态页面版本、未登录 API 可达性、Node 到 Worker 内部鉴权、Chromium 启动、目标站访问、会话保存、会话复验和实际获取一本小说。Worker 健康检查 200 或受保护接口 401 不能代替浏览器登录成功。

### 4.2 批量工厂

先保持现有 V11 路由和 Go backend 边界，确认前端 `/api/batch-factory/v11/*` 与 Go 路由、鉴权、数据库迁移、任务状态一致，再接通小说获取转入。不能把旧 legacy 路由和 V11 路由混为一套协议。

### 4.3 MiniMax H3

H3 使用独立 provider/model 标识，不伪装成 `yd_video` 或通用 `personal_api`。截图和文档确认的资料如下：

- 服务基址：`https://autodl.art`。
- 工作流 ID：`minimax_h3_lightx2v_v5_15s`。
- 提交：`POST /api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_v5_15s`。
- 查询：`GET /api/v1/comfyui/comfyui_workflow/result/{task_id}`。
- 请求头：服务端携带 `Authorization` 和 `Content-Type: application/json`。
- 提交响应：`data.task_id` 是异步任务 ID，初始状态可能为 `QUEUED`。
- 查询状态：至少处理 `QUEUED`、`RUNNING`、`SUCCESS`、`FAILED`。
- 成功结果：`data.results` 返回图片或视频资源 URL；URL 有效期短，必须尽快下载并转入现有媒体持久化链路。
- 已知能力：多图参考、最长 15 秒、480p/768p；价格不写入业务逻辑，除非后续有明确计费展示需求。

以下内容仍需从“在线调用 API”页面或一次脱敏示例确认，不能猜测：多图字段名和数组格式、图片 URL/上传格式、完整请求体、Authorization 的实际 Token 注入方式、`results` 的资源字段结构、失败响应字段、超时与限流语义。

实现边界：

1. 服务端保存 H3 凭据引用，浏览器不接触 API Key。
2. Go 侧新增 H3 专用 adapter/poller，提交时保存 provider task ID，轮询成功后立即下载结果。
3. 前端模型目录增加 H3 能力元数据，分辨率和多图数量由能力配置驱动。
4. 在完整请求契约确认前，只写 fake HTTP 合同测试和可禁用配置，不调用真实/付费 API。
5. 验收至少覆盖提交、排队、运行、成功下载、失败、超时、临时 URL 下载失败和重复轮询幂等性。

### 4.4 豆包执行器

区分 Electron 源码、打包产物和 V88 服务端协议。`resources\app.asar`、`webContents.debugger`、内部就绪状态和调试端口 smoke test 只能证明桥接层部分可用；最终必须单独验证真实登录态、视频提交和结果回收。

## 5. 错误处理与安全边界

- 每层错误必须注明来源：前端参数、Node、Go backend、Worker、Chromium、目标站、代理或部署版本。
- 401 只能说明鉴权层拒绝请求；不能写成登录成功或功能成功。
- H3 临时 URL 必须在服务端尽快下载，不能直接把短期 URL 当永久媒体地址保存。
- 所有真实凭据通过 ECS 或本地安全环境变量注入，日志、错误响应和 Obsidian 只保留“已配置/未配置”和脱敏标识。
- 不停止、删除或修改旧 V78 容器；V88 的重启也必须限定到明确服务。

## 6. 完成定义

本项目阶段完成必须同时满足：

1. 代码在 `v88`，工作区状态可解释；
2. 每个功能有对应分支或合并提交；
3. 自动化测试和必要的 fake/contract 测试通过；
4. V88 部署版本、容器状态和实际页面/API 结果一致；
5. 小说获取、批量工厂、H3、豆包执行器的验证边界没有互相冒充；
6. 提交号、故障原因、修复结果和下一步已经写入 Obsidian。
