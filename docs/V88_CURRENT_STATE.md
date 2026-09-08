# V88 Current State

> 这是给所有 ChatGPT / Codex / 自动化在开始 V88 工作前读取的“当前状态页”。它只描述现在应该相信什么；历史过程请看 `obj` 与审计文档。

更新时间：2026-09-08

## 1. 唯一源码主线

- Canonical maintained source：`v88`
- 本轮收口实施基线：`3274dc7bc6dc1aab5b65a2419408434557cd3a63`
- 本轮隔离实施分支：`ops/v88-consolidation-runtime-a-20260908`
- GitHub 默认分支：当前仍为 `master`，待完成 master 独有提交审计后切换为 `v88`。
- `master` 暂时保留，不删除、不 force-overwrite、不重写历史。

任何新任务开始前，都必须重新读取 GitHub 当前 `v88` HEAD；本页记录的基线不是允许用旧 SHA 覆盖新 V88 的理由。

## 2. 当前公网基线

阶段1权威盘点记录的最近一次成功完整 `Stage -> Cutover` 公网 Node SHA：

`7390234d52031e63b1f6d169b86f90f510e3c9e2`

说明：

- 这是“最近一次已记录成功的公网基线”，不是永远固定的生产版本。
- 任何新的 Cutover 前必须重新从公网 `/api/build-info` 验证当前运行 SHA，不能仅凭本页推测。
- 旧记录目前没有提供一个唯一、持续维护的 `previous_stable_sha` 权威值；Runtime A 上线前必须补齐该状态文件并在每次切换前写入。

## 3. 当前运行架构

当前仍是迁移态：

`Internet -> Docker Nginx :3000 -> Host Node :18081`

Host Node 仍通过现有 Docker 网络依赖 Go API / Browser Worker，并且 Stage 脚本仍从旧 Docker Node 继承部分生产环境与持久化信息。

因此当前不能宣称“主站已经完全脱离 Docker”。

批准的目标架构 A：

`Internet -> Host Nginx -> Host Node / Host Go`

Docker 只保留确实适合隔离运行的组件，例如 Browser Worker；MySQL / Redis 在迁移期可以继续容器化。Worker 故障不得再让主站入口本身不可访问。

## 4. 当前批准的发布入口

正常 Node 发布当前只认：

`V88 Direct Deploy Node Stage -> 精确 SHA 验证 -> V88 Direct Deploy Node Cutover -> 外部精确 SHA 验证`

但当前处于收口 Phase 1 冻结：只做盘点、审计、规则收口时，不应触发公网 Cutover。

以下路径不是日常发布入口：

- `V88 Linux AMD64 Public Image Release`：已 Retired。
- `V88 Node Emergency Redeploy`：仅紧急恢复。
- `*once*` / `*diagnostic*` Workflow：仅审计或一次性恢复证据，不得作为普通发布方式。

## 5. 多 GPT / 多聊天角色

### Development Worker

- 从任务开始时最新 `v88` 创建独立短期分支。
- 只负责自己的功能、测试、commit。
- 不直接发布公网。
- 不直接 force-update `v88`。
- 完成后把分支名、commit SHA、测试结果交给 Release Coordinator。

### Release Coordinator

- 唯一负责检查多个 worker 的改动是否冲突。
- 唯一负责把已验收改动合入 `v88`。
- 唯一负责正常公网 Stage / Cutover。
- 发布前后记录 exact SHA 和 rollback point。

### Emergency Recovery

- 只在公网不可用时启用。
- 目标是恢复最近已验证稳定版本，不顺便开发新功能。
- 任何 ECS 临时修改必须随后回写 Git，否则恢复任务未完成。

## 6. 信息权威顺序

处理“现在应该怎么做”时，按以下顺序读取：

1. `AGENTS.md` — 强制执行规则。
2. `docs/V88_CURRENT_STATE.md` — 当前主线、生产与发布状态。
3. `docs/V88_PROJECT_EXECUTION_MEMORY.md` — 长期约定与架构背景。
4. `docs/obj/2026-09-08-v88-consolidation-stage1-inventory-freeze.md` 与后续审计 — 收口证据。
5. `obj` 其他历史记录 — 仅用于追溯，不覆盖上面当前规则。

旧聊天结论、旧分支、旧公网快照、旧 Docker 镜像都不能高于上述当前权威。
