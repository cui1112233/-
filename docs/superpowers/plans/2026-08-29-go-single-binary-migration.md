# Go 单二进制迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**目标：** 将当前 Node/Express + Go 双服务收敛为可在正式 ECS 上直接运行的单个 Go 二进制。

**架构：** 构建阶段先生成前端 dist 和提示词快照，再复制到 `backend/web/` 供 `go:embed` 嵌入。Go 路由逐步承接 Express 的页面、认证、提示词库、小说获取、批量工厂和水货生产 API；每个阶段保持旧入口可回退，直到等价性和持久化验收通过。

**正式部署：** Linux amd64 静态 Go 二进制 + systemd；MySQL、Redis 和对象存储仍作为外部持久化服务，不嵌入二进制。

## 阶段 0：基线与边界

- 固定当前 Express 路由/API 快照与 Go 路由清单。
- 添加迁移状态检查，禁止在 Go 路由未覆盖时切断 Node 入口。
- 验收：现有 Node+Go Docker 烟测继续通过。

## 阶段 1：前端与提示词 embed

- 新增构建脚本，将 `frontend/dist` 和批准的 `prompts` 复制到 `backend/web/`。
- 在 Go 中使用 `embed.FS` 提供 `/`, `/assets/*`, 页面路由和 SPA fallback。
- 加入版本清单和资源哈希，避免旧 chunk 缓存。
- 验收：单 Go 进程可打开 `/`, `/script`, `/batch-factory`, `/shuihuo-production`, `/admin`。

## 阶段 2：认证、配置、历史和提示词库

- 迁移 Bearer token、账号隔离、模型配置、历史记录和管理员预设 CRUD。
- 保持现有 MySQL schema 和权限语义，不回退到进程内存或全局 JSON。
- 验收：登录、登出、会话恢复、提示词库批量工厂模块、历史读写跨重启通过。

## 阶段 3：小说获取与批量工厂

- 迁移小说获取任务、抓取/改写状态、批量工厂小说列表、统一生产设置、分段导演、视频任务、合并和 121 发布接口。
- 保证书籍、分段、VIDO、TXT 的稳定 ID 和账号边界。
- 验收：小说获取 → 批量工厂 → 分段导演 → 视频任务 → 合并 → 发布的单本最小闭环。

## 阶段 4：水货生产和异步执行器

- 迁移项目、资产、提示词候选、模型目录、队列和本地执行器接口。
- 保留 provider 凭据仅在服务端配置，禁止进入前端或二进制日志。
- 验收：项目创建、素材生成任务、任务回调、对象下载和重启恢复。

## 阶段 5：切换与发布

- 新增 `scripts/build-go-release.sh`：构建前端、复制 embed 资源、运行 Go 测试、编译 `linux/amd64` 二进制、生成校验和与版本包。
- 新增 `scripts/deploy-go-binary.sh`：SSH 上传、备份、原子切换、systemd 重启、`/healthz` 和关键页面检查、失败回滚。
- 更新 `README.md` 和 `backend/README.md`，记录正式部署、回滚、密钥注入和数据备份要求。
- 只有所有阶段验收通过后，才停止 Node/Express 服务。

## 全局门禁

- 不删除现有数据卷、不覆盖凭据、不把正式 IP 或密钥写入仓库。
- 每阶段独立提交、测试和审查；任何失败先回滚该阶段。
- 单二进制完成的定义是：ECS 只需运行一个 Go 进程即可提供页面、认证及本项目已承诺的业务 API。

