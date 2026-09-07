# V88 收口与生产运行架构设计

## 目标

把当前 V88 项目从“多分支、多聊天、多发布方式、Docker/宿主机混合耦合”的状态，收口成一套可追溯、可回滚、适合新手长期维护的稳定流程。

最终必须满足：

1. `v88` 是唯一维护主线和 GitHub 默认分支。
2. 所有功能、修复、提示词、部署脚本先进入 Git，再进入公网。
3. 普通 GPT/开发会话只负责自己的功能分支；只有一个发布协调入口负责合并 `v88` 和公网发布。
4. 公网主站不依赖 Docker Node/Nginx：Host Nginx -> Host Node / Host Go。
5. Docker 只保留确实适合容器运行的隔离组件，例如 121 Browser Worker，以及迁移期内稳定运行的 MySQL/Redis 等基础设施。
6. 任意时刻都能回答“Git v88 HEAD 是什么、公网运行 SHA 是什么、上一个稳定 SHA 是什么”。
7. 小功能发布不能再被 Worker、GHCR、完整 Docker Compose 链路阻塞。
8. 旧分支、旧 workflow、诊断脚本只在确认没有独有功能后归档或删除，禁止粗暴全量 merge。

## 已确认现状

### Git

- GitHub 当前默认分支仍为 `master`。
- 仓库内 `AGENTS.md` 已明确：`v88` 是 canonical maintained source / future total branch。
- `docs/V88_PROJECT_EXECUTION_MEMORY.md` 已明确：Git `v88` 是唯一源码真相，公网只是运行副本。
- 当前 `master` 与 `v88` 已分叉：`v88` 相对 `master` ahead 410 commits、behind 1 commit。
- `master` 独有提交为 `96908c32456cb7572b8e621221e7cbeff75976db`，内容与 Novel Fetch “版本配置卡片、121 配置同步、直接处理流程”相关，必须审计后再决定是否迁移。
- `v88` 目前没有 branch protection。
- 仓库存在大量 `fix/v88-*`、`feat/v88-*`、`integrate/v88-*`、`diag/v88-*`、`design/v88-*` 分支。

### 当前生产运行

当前所谓 Git-direct Host Node 并未真正脱离 Docker：

- `deploy/v88-direct/stage-node-host.sh` 仍要求 Docker network `v88-public_qiantie_internal` 存在。
- Stage 脚本仍要求旧 Node、Go API、Browser Worker、Nginx 容器都存在。
- Stage 环境变量仍从旧 Docker Node 容器复制，并通过 Docker IP 连接 Go API / Worker。
- `deploy/v88-direct/cutover-node-host.sh` 仍通过 Docker Nginx 容器承接公网 3000，并把 Host Node 暴露为 Docker bridge gateway:18081。
- 旧 Docker Node 仍作为 rollback upstream。

因此当前是“Host Node + Docker Nginx + Docker 网络/依赖”的迁移态，不是目标架构。

## 目标架构 A

### A1：先稳定主站入口

```text
Internet
  -> Host Nginx (:3000 / future 80/443)
      -> Host Node (:18081)
      -> Host Go API (:4000, when migrated)
      -> Docker Browser Worker (:8787, isolated)
      -> MySQL / Redis (migration-period deployment may remain Docker)
```

第一阶段只要求把“公网是否能打开”从 Docker 解耦：Host Nginx + Host Node 自启动、重启 ECS 后自动恢复。

### A2：再迁移 Go API

Go API 以 systemd + Go binary 运行在 Host。Node 通过 `127.0.0.1:4000` 访问 Go API。

### A3：保留适合容器的组件

121 Browser Worker / Playwright 等强依赖浏览器环境、隔离依赖较多的组件可以继续 Docker 化。它挂掉时只影响对应功能，不得导致主站入口 3000 不可访问。

MySQL/Redis 是否迁出 Docker不是当前收口的前置条件；优先保证稳定和数据安全。

## Git 收口规则

### 唯一主线

- GitHub 默认分支改为 `v88`。
- 暂时保留 `master`，不删除、不 force-overwrite。
- 对 `master` 独有提交做 file-level audit：
  - 若 V88 已等价实现：记录“已覆盖”，不 merge 老代码。
  - 若 V88 缺功能：只 cherry-pick/手工迁移需要的最小变更，并补回归测试。
  - 若是过期逻辑：记录“废弃”，不迁移。
- 完成审计后创建只读归档分支 `archive/master-before-v88-canonical-20260907`。

### 功能开发

普通开发：

`latest v88 -> feat/fix branch -> test -> PR/merge -> v88`

禁止：

- 从旧 feature 分支继续迭代新功能。
- 普通聊天直接在生产 ECS 改代码。
- 普通聊天直接发布公网。
- 用旧整文件覆盖 V88 当前文件。
- 把所有历史分支一次性 merge 到 V88。

## 多 GPT 聊天协作规则

采用“一个总控 + 多个工人”模型。

### Release Coordinator / 总控聊天

唯一允许：

- 合并到 `v88`。
- 触发正式公网发布。
- 修改生产运行方式。
- 回滚生产。
- 维护 `docs/V88_CURRENT_STATE.md`。

### Feature Worker / 普通功能聊天

只能：

- 从最新 `v88` 创建自己的 feature/fix 分支。
- 修改本任务范围代码。
- 跑测试。
- 提交 commit / PR。
- 向总控报告 branch、SHA、测试结果、涉及文件。

不能：

- 自行切公网。
- 自行更改发布架构。
- 自行把旧分支设为主线。

### 会话交接最小信息

每个任务必须留下：

- 基线 `v88` SHA。
- 工作分支。
- 最终 commit SHA。
- 修改文件清单。
- 测试命令与结果。
- 是否已合入 `v88`。
- 是否已发布。
- 若发布，公网运行 SHA。

## 生产版本单一真相

新增/维护 `docs/V88_CURRENT_STATE.md`，只保存“现在”，不保存长历史。

必须包含：

- canonical branch: `v88`
- current v88 HEAD SHA
- production SHA
- previous stable production SHA
- deploy mode
- Node service
- Go service
- Nginx service
- Docker-only services
- last verified timestamp

`obj` 继续保存历史过程；`AGENTS.md` 保存硬规则；`V88_CURRENT_STATE.md` 保存当前状态。三者职责不得混用。

## 发布链路

### 小功能快速发布

前端 / Node / 提示词 / UI：

1. 合入 `v88`。
2. GitHub Actions 或受控发布器 SSH 到 ECS。
3. Checkout 精确 SHA 到 release directory。
4. 按变更类型构建。
5. 启动/重启 Host Node。
6. Host Nginx 仍服务公网，不因为发布过程停止。
7. 本机 health check。
8. 外部 health check。
9. 成功后更新 current/previous stable SHA。

不触发：Worker rebuild、GHCR Node image、全量 Docker Compose。

### Worker 发布

只有 Worker 代码变更时才独立构建/重启 Browser Worker。Worker 发布失败不得回滚 Node 主站。

### 数据库迁移

只有 Goose migration 变化时执行 migration。普通前端/Node 修改不得触碰数据库容器或数据卷。

## 开机自恢复

ECS 重启后必须自动恢复：

- Host Nginx: enabled
- Host Node: enabled
- Host Go: enabled（迁移完成后）
- 必需 Docker 基础服务：Docker daemon enabled + compose/systemd 自恢复

生产健康检查必须分层：

1. `127.0.0.1:18081/api/build-info` -> Node
2. `127.0.0.1:3000/api/build-info` -> Host Nginx -> Node
3. 外部 `115.190.156.223:3000/api/build-info`
4. Worker health 单独检查，不作为主站 3000 的存活前置条件

## 回滚

任何发布必须保留上一稳定 release directory 和 SHA。

Node 回滚只切 Host Node 到上一稳定 release，不需要 Docker Node。

Nginx 配置修改采用：

- `nginx -t` 通过后 reload
- 失败保持旧配置

Worker 回滚独立执行，不牵连主站。

## 清理策略

只在新链路连续稳定验证后清理：

- `*-once.yml`
- `*-diagnostic.yml`
- retired Docker Node release workflows
- 临时 patch scripts
- 无独有提交的旧 fix/feat/integrate 分支

清理前必须建立清单并逐项确认独有 commit；不做批量盲删。

## 成功标准

收口完成时必须同时满足：

1. GitHub default branch = `v88`。
2. `master` 独有提交已审计并记录结果。
3. 普通功能聊天不能直接发布生产。
4. Host Nginx + Host Node 在 ECS 重启后自动恢复。
5. 主站 3000 不依赖 Docker Nginx / Docker Node。
6. Worker 停止时，主页和普通 Node API 仍可访问。
7. 公网 build-info SHA 与发布记录一致。
8. 一个小前端/Node改动无需 Docker/GHCR 即可发布。
9. `AGENTS.md`、`V88_PROJECT_EXECUTION_MEMORY.md`、`V88_CURRENT_STATE.md` 职责清晰且一致。
10. 历史分支/临时 workflows 清理前都有审计记录。
