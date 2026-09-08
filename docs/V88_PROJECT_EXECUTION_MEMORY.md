# V88 项目执行记忆（跨对话统一规则）

> 目的：避免后续不同对话框把 V88、Git、公网、Docker 的关系搞混，导致修复只存在公网、后续迭代又被覆盖或找不回来。

> 当前状态入口：所有 GPT / Codex / 自动化在开始 V88 任务前，先读取 `docs/V88_CURRENT_STATE.md`。本文件保存长期规则与架构背景；`obj` 保存历史证据，不作为“现在正在运行什么”的最高权威。

## 0. 多聊天协作角色

为避免多个 GPT 对同一主线和公网互相覆盖，后续固定三种角色：

- **Development Worker（开发工人）**：从任务开始时最新 `v88` 创建短期任务分支，只负责开发、测试、commit，并回报分支名 + SHA；不得正常发布公网，不得 force-update `v88`。
- **Release Coordinator（发布总控）**：唯一负责检查不同 Worker 是否冲突、把已验收改动合入 `v88`、执行正常 Stage / Cutover、记录生产 SHA 和回滚点。
- **Emergency Recovery（紧急恢复）**：仅在公网不可用时恢复最近已验证稳定版本，不在恢复动作中顺便开发新功能；ECS 临时修复必须随后回写 Git。

## 1. 唯一正式源码

- GitHub 仓库：`cui1112233/-`
- 当前唯一维护主线：`v88`
- `v88` 将作为后续总分支，并计划最终承担 master/main 的角色。
- 所有新功能、Bug 修复、UI 小改、提示词、部署脚本、数据库迁移，都必须先写进 Git 的 V88 lineage。
- 旧 V78、历史 release、旧 feature 分支只作为参考源，不再作为维护目标。
- GitHub 默认分支从 `master` 切换为 `v88` 必须在 master 独有提交审计完成后执行；切换默认分支不等于删除或覆盖 `master`。

## 2. 公网与 Git 的关系

- Git `v88` = 唯一源码真相（Source of Truth）。
- ECS 公网 = `v88` 的运行副本，不是开发源。
- 正常流程严禁“只改公网容器/服务器文件，Git 不记录”。
- 即使发生紧急线上止血，只要动过公网文件，也必须立即把同样改动回写到 Git `v88`；没有回写 Git，就不能算任务完成。
- 后续任何对话在动公网前，应先确认当前 Git `v88` 最新 SHA，再基于该 SHA 工作，禁止拿旧 `app.js`、旧热修复包、旧镜像整份覆盖当前 V88。
- Git HEAD 与公网运行 SHA 可以在“已合入但尚未发布”期间不同，但这种差异必须在 `docs/V88_CURRENT_STATE.md` 明确记录，不能靠聊天记忆猜测。

## 3. 默认开发流程

标准流程固定为：

`最新 v88 -> 短期功能/修复分支 -> 测试 -> Release Coordinator 验收/合入 v88 -> 记录 commit SHA -> 再发布/同步公网`

禁止把以下方式当成正常开发流程：

`直接改公网 -> 验证能用 -> 结束`

也禁止多个 GPT 同时直接在 `v88` 上改同一套文件并分别发布。

## 4. 后期推荐发布方式：Git -> ECS 直部署

用户后期希望日常更新不再依赖 Docker 镜像构建。

推荐目标：

`Git v88 -> ECS 拉取指定 commit -> 按变更类型增量构建 -> 重启对应服务 -> 健康检查 -> 记录公网运行 SHA`

### 增量发布规则

- 仅前端/CSS/文案改动：只同步代码 + 构建前端 + reload/restart 必要服务。
- Node 业务代码改动：同步代码 + 安装依赖（仅依赖变化时）+ 重启 Node。
- Go API 改动：同步代码 + `go build` + 重启 Go 服务。
- Goose migration 改动：部署时执行对应数据库迁移。
- Browser Worker 改动：只更新/重启 Worker；依赖变化时再安装依赖。
- MySQL、Redis、TOS 等持久化基础设施不应因普通 UI/业务小改而重装或重建。

目标是让小改动尽量在几十秒到 1~2 分钟内进入公网，而不是每次都重建完整 Docker 镜像。

## 5. Docker 的定位

- “日常发布不用 Docker”不等于“立刻删除服务器上所有 Docker”。
- 现有 MySQL、Redis、旧服务、Playwright/Worker 等如果当前稳定运行，可以先继续保留。
- 后期应用代码发布优先采用 Git -> ECS 直部署。
- 不应为了一个按钮、状态文案、CSS 等小改重新构建整套 Docker 镜像。
- 若未来确实需要容器化发布，必须从 Git `v88` 的明确 commit 构建，不能从公网现状反向制作镜像。
- 已批准的目标架构 A：主站入口最终使用 Host Nginx -> Host Node / Host Go；Browser Worker 等适合隔离运行的组件可以继续 Docker。Worker 故障不得让主站入口本身不可访问。
- 当前仍处在混合迁移态，阶段6完成前不得因为“想去 Docker”而直接删除现有 Docker 网络、Worker、Go/Nginx 依赖。

## 6. 公网版本可追溯要求

每次公网发布后必须能回答：

- 当前公网运行的是哪个 Git SHA？
- 这个 SHA 是否属于 `v88`？
- 上一个可回滚 SHA 是什么？
- 当前 deploy mode 是什么？

必须逐步固化：

- `/opt/qiantie/v88`：Git 工作副本/发布工作区
- 当前运行 SHA 状态文件或 build-info
- `previous_stable_sha`
- 自动健康检查与失败回滚

如果旧系统暂时没有可靠的上一稳定 SHA，不得编造；应在下一次正式 Runtime A cutover 前补齐并从那次开始持续维护。

## 7. 现有技术栈约定

- API / 后端：Go（Golang），编译为二进制。
- 管理端：React + Ant Design。
- 用户端：React + Ant Design。
- 数据库：MySQL。
- 数据库迁移：Goose。
- 队列/锁/非关系型数据：Redis。
- 对象存储：TOS。
- 系统提示词：后端保存模板并在运行时替换真实提示词。
- 传统部署目标仍可使用 Go embed 打包前端资源；在当前混合迁移阶段，允许 Node/Go 并存，但新功能最终向 V88 统一架构收口。

## 8. 小说获取相关已确认语义

以下修复必须视为正式 V88 规则，不得后续覆盖回旧逻辑：

- 原文必须同时保留完整 `originalRaw` 与按 `maxTxt` 截断后的实际处理正文。
- 列表字数显示使用“本次实际处理字数 / 原始总字数”，例如 `4000/27831`。
- `input_ready` 用户界面显示为“分类信息已就绪”。
- `running/processing` 显示为“正在执行中…”。
- 日期筛选必须使用真实任务日期，不得通过 `2099-12-31` 等假日期绕开过滤。
- 用户可见的“121”统一显示为“视频管理系统”；内部变量、兼容字段、历史文件名可保留 121。

## 9. 后续对话执行前检查

任何后续对话在执行 V88 开发/发布前，应先确认：

1. 读取 `AGENTS.md` 和 `docs/V88_CURRENT_STATE.md`。
2. 当前 Git `v88` 最新 SHA。
3. 本任务改动是否已经写进 Git，而不是只存在公网。
4. 是否会用旧文件/旧热修复覆盖当前 V88。
5. 当前聊天的角色是 Development Worker、Release Coordinator 还是 Emergency Recovery。
6. 小改是否可以走增量部署，而不是完整 Docker 构建。
7. 发布完成后是否记录运行 SHA、上一稳定 SHA并做健康检查。

如果用户只说“执行”“发布”，默认解释为：

- 先基于最新 Git `v88`；
- 所有改动先进入 Git；
- Development Worker 不自行发布，交给 Release Coordinator；
- Release Coordinator 再按当前批准的发布方式同步 ECS；
- 不默认直接修改公网；
- 不默认重新构建 Docker，除非用户明确要求或当前基础设施仍必须使用。

## 10. 文档权威顺序

处理“现在应该怎么做”时：

1. `AGENTS.md`
2. `docs/V88_CURRENT_STATE.md`
3. 本文件
4. 当前 consolidation inventory / audit
5. 其他 `obj` 历史记录与旧聊天

历史记录用于追溯，不得反向覆盖当前规则。

## 11. 核心原则（一句话）

**Git `v88` 是唯一正式源码；公网只是运行副本；开发聊天各自隔离提交，发布总控统一合入和发布；日常小改优先 Git -> ECS 增量直部署，主站最终收口为 Host Nginx -> Host Node / Host Go，Docker 只保留需要隔离的组件。**
