# V88 Git → ECS 直部署设计

日期：2026-09-07
状态：待用户书面确认后实施
目标分支：`v88`

## 1. 背景与目标

V88 后续作为唯一正式源码主线。公网 ECS 只作为运行环境，不再作为开发源，也不再依赖“直接改容器 / 反复打热补丁”维持最新状态。

本次目标是把日常发布链路从：

`Git v88 → Docker build → GHCR → ECS pull → 重建容器`

改为：

`Git v88 → CI 验证 → 精确 SHA 发布包 → ECS 增量构建 → systemd 重启对应服务 → 健康检查 → 自动回滚`

日常小改不再要求 Docker 镜像构建。Git SHA 必须成为公网版本的唯一来源。

## 2. 已确认的当前事实

1. Node 主服务使用 `node server.js`，默认监听 `0.0.0.0:18081`，可由 `QIANTIE_NODE_PORT` 覆盖。
2. Go API 源码位于 `backend/cmd/qiantie`，可直接在 Linux ECS 编译为二进制。
3. 前端使用独立 `frontend/` 构建流程，当前可用 `npm run frontend:build` / `npm --prefix frontend run build` 生成生产静态资源。
4. 浏览器 Worker 位于 `services/121-browser-worker`，运行命令是 `node src/server.js`，依赖 Playwright 1.55.0。
5. 当前 Docker 发布 workflow 会在 `v88` push 后构建主镜像和 Browser Worker 镜像并部署 ECS。日常直部署落地后，该 workflow 不再自动执行，只保留为手动应急/归档能力。
6. 当前仓库并没有 systemd 直部署实现，需要新增。
7. 当前生产 MySQL / Redis / Nginx 等基础设施可能仍由 Docker 承载。本次不强制把数据库基础设施迁出 Docker，重点是“应用代码发布不再依赖 Docker build”。

## 3. 方案比较

### 方案 A：GitHub Actions 发布精确 SHA 到 ECS + release 目录 + systemd（推荐）

GitHub Actions checkout 已验证的 `v88` SHA，把源码以压缩包或 rsync 方式送到 ECS 新 release 目录，在新目录中执行必要构建，成功后原子切换 `current` 软链接并重启对应 systemd 服务。

优点：
- ECS 不需要长期保存 GitHub 私钥或 PAT。
- 公网版本天然对应一个精确 Git SHA。
- 新版本先构建、后切换，失败不会污染当前线上目录。
- 回滚只需把 `current` 指回上一 release 并重启服务。
- 小改可以只运行必要步骤，发布速度快。

缺点：
- 第一次需要做 systemd 与 ECS 主机环境初始化。
- Browser Worker 第一次需要安装 Playwright/Chromium 系统依赖。

### 方案 B：ECS 直接 `git fetch/reset` 原地更新

ECS 自己保存 GitHub 凭据，在一个工作目录中直接 `git fetch && git reset --hard <sha>`，然后构建并重启。

优点：最简单，文件传输最少。

缺点：
- ECS 必须长期保存 GitHub 凭据。
- 原地构建失败时更容易把线上工作目录留在半更新状态。
- 回滚和持久化数据隔离更脆弱。

### 方案 C：继续 Docker，只把 Git 作为唯一源码

保留现有 Docker 发布，只停止直接改公网。

优点：改造最少。

缺点：与“不再调用 Docker 做日常发布”的目标冲突，小改仍需构建/推送/拉取镜像，速度和复杂度都偏高。

结论：实施方案 A。

## 4. 目标目录结构

ECS 采用不可变 release 目录 + 持久化 shared 目录：

```text
/opt/qiantie/v88/
├── current -> /opt/qiantie/releases/v88/<sha>
├── previous -> /opt/qiantie/releases/v88/<previous-sha>
└── shared/
    ├── env/v88.env
    ├── data/
    ├── outputs/
    ├── browser-worker-sessions/
    └── logs/

/opt/qiantie/releases/v88/
├── <sha-1>/
├── <sha-2>/
└── <sha-3>/
```

源码目录不得承载不可丢失数据。运行时数据统一放到 `shared/`，release 目录删除不会丢用户数据。

## 5. systemd 服务

新增三个主应用服务：

### `qiantie-v88-node.service`

- WorkingDirectory: `/opt/qiantie/v88/current`
- ExecStart: Node 主服务 `node server.js`
- EnvironmentFile: `/opt/qiantie/v88/shared/env/v88.env`
- 默认端口：18081
- Restart: on-failure

### `qiantie-v88-go.service`

- ExecStart: `/opt/qiantie/v88/current/bin/qiantie`
- EnvironmentFile 同上
- 仅当 `backend/**` 发生变化时重新编译并重启。

### `qiantie-v88-browser-worker.service`

- WorkingDirectory: `/opt/qiantie/v88/current/services/121-browser-worker`
- ExecStart: `node src/server.js`
- Worker 绑定本机地址，Node 通过固定本机 URL 调用，不再依赖 Docker DNS 服务名。
- Session 数据指向 `/opt/qiantie/v88/shared/browser-worker-sessions`。
- Playwright/Chromium 只在首次初始化或 Playwright 版本变化时安装。

## 6. 基础设施边界

本次不把 MySQL、Redis、对象存储强行迁出 Docker/外部服务。

原则：
- MySQL / Redis 可以暂时继续当前运行方式。
- Node / Go 迁到宿主机以后，必须通过稳定的本机地址访问数据库，例如 `127.0.0.1:<published-port>`。
- 如果当前 MySQL / Redis Docker 没有发布宿主机端口，首次迁移只做必要的 loopback 端口暴露，不允许重建或清空数据卷。
- Nginx 如果仍在 Docker，需要先验证它如何访问宿主机 Node。若现有 Nginx 无法稳定访问宿主机服务，则第一阶段保留现有入口，只调整 upstream 到宿主机可达地址；不在同一变更里顺带重构所有网络设施。
- TOS 保持外部对象存储。

迁移脚本必须 fail-closed：基础设施连接不满足条件时停止发布，不自动破坏现有生产配置。

## 7. 增量发布规则

发布 workflow 比较 `previous_sha..new_sha` 的文件差异，只执行必要动作。

### 前端小改

匹配：
- `frontend/**`
- `public/**`
- `pets/**`
- 浏览器静态资源相关文件

动作：
1. 构建 frontend。
2. 切换 release。
3. 重启 Node。
4. 进行网页健康检查。

目标：通常几十秒到 1–2 分钟内完成，不执行 Docker build。

### Node 改动

匹配：
- `server.js`
- `app.js`
- `routes/**`
- `lib/**`
- `middleware/**`
- `prompts/**`
- 根 `package*.json`

动作：
1. 根依赖变化时 `npm ci --omit=dev`；未变化时复用已验证依赖缓存策略。
2. 重启 Node。
3. API/页面健康检查。

### Go 改动

匹配：`backend/**`

动作：
1. `go test ./...`
2. `go build -o bin/qiantie ./cmd/qiantie`
3. 重启 Go 服务。
4. Go 健康检查。

### Browser Worker 改动

匹配：`services/121-browser-worker/**`

动作：
1. `npm ci --omit=dev`。
2. Playwright 版本变化时才运行浏览器依赖安装。
3. 重启 Worker。
4. `/healthz` 与 Node→Worker 调用检查。

### 数据库迁移

仅当正式 Goose migration 文件变化时执行 `goose up`。

禁止因为普通 UI/Node 改动自动重建数据库或重置数据。

## 8. 首次迁移流程

首次从 Docker 应用容器切换到宿主机 systemd 时采用蓝绿式迁移：

1. 读取并记录当前公网容器、端口、数据卷、环境变量和 Nginx upstream，仅做诊断，不修改。
2. 在 ECS 安装 Node 22、Go、Git/rsync、Playwright/Chromium 依赖。
3. 创建 `qiantie` 运行用户、shared 目录和 systemd unit。
4. 发布当前最新 V88 SHA 到新的 release 目录。
5. 使用备用端口启动 Node / Go / Worker，验证数据库、Worker、登录、小说获取、剧本等关键接口。
6. 健康检查全部通过后再切换公网入口。
7. 旧 Docker 应用容器先保留为回滚来源，不立即删除。
8. 观察稳定后再停止旧应用容器；数据库/Redis 容器继续保留。

## 9. 自动回滚

每次发布前记录：
- `CURRENT_SHA`
- `PREVIOUS_SHA`
- 当前各 systemd 服务状态

切换后依次检查：
- Node 本机 health/build-info
- Go API
- Browser Worker `/healthz`
- 公网首页/小说页/剧本页关键 HTTP 状态

任一关键检查失败：
1. `current` 指回 previous release。
2. 重启受影响 systemd 服务。
3. 验证旧版本恢复。
4. 发布 workflow 标记失败。
5. 不删除失败 release，保留日志用于排查。

## 10. 公网版本可追踪性

新增运行时版本文件，例如：

`/opt/qiantie/v88/current/RELEASE-SHA`

并由已有或新增 build-info 接口暴露：
- branch = `v88`
- git_sha
- deployed_at
- deploy_mode = `git-direct`

任何对话都能回答“公网现在运行哪个 Git commit”。

## 11. GitHub Actions 变化

### 新增

`.github/workflows/v88-ecs-direct-deploy.yml`

职责：
1. checkout 精确 SHA
2. 按差异运行针对性测试
3. 打包/rsync 源码到 ECS release 目录
4. 执行 ECS 端 `deploy/v88-direct/deploy.sh`
5. 健康检查与回滚

### 调整现有 Docker release

`.github/workflows/v88-linux-amd64-image-release.yml`

从自动 `push to v88` 改为仅 `workflow_dispatch`，作为应急/归档通道，不参与日常 V88 发布。

Docker 文件可以保留在 Git 里，禁止删除历史恢复能力。

## 12. 测试策略

实施前先写失败测试/静态契约检查，至少覆盖：

1. Docker release workflow 不再监听普通 `v88` push。
2. Direct deploy workflow 只部署精确 `GITHUB_SHA`。
3. 发布脚本禁止原地修改当前 release。
4. release 切换前必须完成构建和预检查。
5. 发布失败必须指回 previous。
6. 小前端改动不得触发 Docker build、Go build、Worker 重装。
7. Go 改动必须跑 Go test/build。
8. Worker Playwright 版本不变时不得重复安装浏览器。
9. secrets 不得写进 Git 或 release 包。
10. 数据库迁移只对 migrations 变化执行。
11. 发布后 build-info 必须显示精确 SHA。

## 13. 安全与数据保护

- Git 只保存代码和模板，不保存生产密码/API Key/浏览器登录态。
- 生产 secrets 保存在 ECS root-only EnvironmentFile。
- Browser Worker session 目录持久化到 shared，不随 release 删除。
- MySQL 数据卷、Redis、TOS 不受 app release 清理影响。
- deploy 脚本禁止执行 `docker volume rm`、`rm -rf` shared 数据目录、数据库重置等危险命令。

## 14. 成功标准

完成后必须同时满足：

1. Git `v88` 是唯一正式源码。
2. 普通 `v88` 小改不再自动构建 Docker 镜像。
3. 前端/Node 小改能以增量方式快速更新公网。
4. Go / Worker 仅在对应文件变化时更新。
5. 公网运行版本可查到精确 Git SHA。
6. 发布失败能够自动恢复上一 SHA。
7. 数据库、Redis、对象存储和浏览器 session 不因代码发布丢失。
8. 公网不允许直接编辑源码形成“Git 没有、线上有”的状态。

## 15. 第一阶段实施边界

本次只迁移“应用发布方式”，不顺带做以下工作：

- 不重构 MySQL/Redis 数据架构。
- 不删除现有 Docker 镜像与历史恢复资料。
- 不在同一阶段改业务功能。
- 不切换 GitHub 默认分支。
- 不把旧 V78 分支重新引入维护主线。

这样可以把风险集中在发布链路本身，避免再次发生“修发布时覆盖业务”的问题。
