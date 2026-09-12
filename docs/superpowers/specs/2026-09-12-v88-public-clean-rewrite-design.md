# 一战晟铭 v88 公网清晰仓库重写设计

## 1. 目标与范围

- 目的：将开发仓库整理为“对标公网可用版本”的干净主线仓库，并用清晰的分支结构避免混杂历史分支。
- 范围：仅保留 `v88` 线路中、可用于公网运行与日常增量发布的代码与配置，不包含本地临时开发草稿、计划草稿、测试快照、日志/缓存数据。
- 目标仓库：`/Users/ming/Documents/ChatGPT/一战晟铭`。
- 参考远端：`https://github.com/cui1112233/-`，以远端分支 `origin/v88` 为唯一长期维护基线。

## 2. 当前问题与设计决策

- 当前环境存在大量分支（`feature/fix/integration/release` 等）和工作树碎片，导致发布决策与回溯路径不清晰。
- `/Users/ming/Documents/ChatGPT/一战晟铭` 为空仓库，不具备历史与主线内容，适合直接重建。
- 决策：采用“单主线 + 按需发布分支”的模式，先完成一次 v88 精简导入，再在该仓库内进行后续迭代。

## 3. 分支模型（v1）

- 本地常驻主分支：`v88`（唯一长期维护分支，默认用于开发与部署基线）
- 远程跟踪：始终保持 `origin/v88` 连接。
- 版本化发布：仅在需要发布点手工创建 `release/<version-or-date>`，发布后可保留或归档，避免长期并行堆积。
- 禁止：在该仓库长期保留 `feature/*`、`fix/*`、`integration/*`、`ops/*`、`review/*`、`hotfix/*`、`snapshot/*` 等工作分支。

## 4. 入库范围（公网需要）

- 保留的目录与文件（核心运行链路）：
  - 应用主代码：`app.js`、`server.js`、`backend/`、`frontend/`、`lib/`、`routes/`、`middleware/`、`services/`、`local-executor/`、`pets/`、`prompts/`、`public/`
  - 运行与部署：`deploy/`、`scripts/`、`.github/`、`Dockerfile`、`docker-compose.v88-review.yml`、`.env.v88-review.example`、`package.json`、`package-lock.json`
  - 运行治理：`AGENT.md`、`AGENTS.md`、`CURRENT_VERSION.md`、`PRODUCTION_SNAPSHOT.md`、`docs/V88_PROJECT_EXECUTION_MEMORY.md`
- 初始不保留：`.superpowers/`、`docs/superpowers/`、`data/`、`test/`、`tests/`、`data/system/*`、`docs/superpowers/plans`、`docs/superpowers/specs`（除本文件外）、本地备份、日志、`*.log`、`node_modules`。

## 5. 组织与交付约束

- 先只构建一份可维护基线，不做功能增补。
- 所有后续改动均以 `v88` 为单一来源：先提交到 `v88`，再按发布流程同步公网。
- 仓库内文件清单应可直接支撑现有公网服务链路的启动、运行与健康检查。
- 禁止把未提交的临时内容当主线内容；任何大文件、凭据、私密信息不得提交。

## 6. 成功标准

- `/Users/ming/Documents/ChatGPT/一战晟铭` 存在 `origin/v88` 远端且可检出 `v88`。
- 本地分支列表能快速反映“主线明确”目标：默认可见 `v88`，并无长期残留大量工作分支。
- 版本树中仅含上文列明的公网相关文件，未包含明显临时草稿与运行态文件。
- `git status` 能稳定保持干净状态；新开发流程可在 `v88` 上直接继续。

## 7. 风险与处理

- 风险：筛选边界过于严格可能暂时遗漏非显性依赖文件。
  - 对策：先做“文件集成后执行静态启动与入口验证”，再逐步补齐缺失配置（不扩大分支范围）。
- 风险：旧分支引用逻辑会让初始阶段回溯困难。
  - 对策：保留远端 `origin/v88` 的完整提交历史，按需按提交点临时检出历史分支，不在本地长期保留。

## 8. 下一步

- 根据该设计执行入库与分支整理后，进入实现计划阶段（由实现计划任务定义具体命令与回滚策略）。
