# V78 Selective Batch Factory V11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Each phase uses checkbox steps and ends with an independent commit and gate.

**Goal:** 在可重建的 V78.3.0.3 源码基线上，以 Go/MySQL 为 V11 Batch Factory 的业务权威，选择性复用已审核的 React/Ant Design UI，并用可回滚的分阶段切片完成从数据合同到候选验收的完整路径。

**Architecture:** 浏览器只访问同源 /api/batch-factory/v11/*。Node/Express 只验证现有 session、签名并透明转发；Go 负责 Batch/Book/VIDEO、Settings、Snapshot、Director、Compiler、Production、Status、Merge 和最终持久化。V78 旧 Preview 保留为明确回退入口，旧 Node Batch 业务链不被 V11 调用。

**Tech Stack:** Go 1.23、database/sql、MySQL 8.4、Node 24/Express 5、React 18、Ant Design 5、Vite 5、Node test runner、Go testing/httptest、Docker Compose。

## Global Constraints

- 唯一源码基线是 recovery/production-v78.3.0.3-source@483faed8d654e452f6079fc1ef40b74db3a13d1c；实现分支必须以已批准设计 f4689d761229016b81180f7ad0d4ffb956fc3399 为祖先。
- V11 Go Slice 1 只能从 origin/release/production-v78.3.0.3-batch-factory-go-first@8aca2668b332d37f1c7c64030b17220621d74799 逐文件恢复；V11 UI 只能从 origin/feat/batch-factory-v11-layout-showcase@59afd75da3d9b96b908b849931c5f28289a674d9 逐文件提取。
- 禁止 merge master、08/09/10 整条历史分支和 BatchFactoryPageV10.jsx；每个选取文件必须写入 docs/batch-factory/v11-source-provenance.tsv，包含 branch、commit、blob SHA、用途和是否改写。
- Node 不新增 V11 业务规则、不计算继承/快照/Prompt、不保存 V11 状态、不与 Go dual-write；V11 React 不调用旧 /api/batch-factory/*、旧 shared/api/batchFactory.js 或旧生产 API。
- Settings 层级固定为 system -> batch -> book -> video。显式 false、空字符串和 0 必须保留；恢复继承只删除指定 override key，不复制父层值。
- 模型、模式、配置、画幅、时长策略或 fixed-single-VIDEO 变化只能使 Director 失效，不能删除 Book/VIDEO override；VIDEO identity 变化必须保留旧 patch 并标记 orphaned 或 incompatible。
- 系统预设由 Go 的版本化只读 catalog 权威管理；我的提示词和草稿由 Go/MySQL 按用户隔离管理。不得通过迁 UI 重新新增 Node Prompt 规则。
- production.submit 是唯一生产 capability 名称；production.run 不得作为别名。未完成切片的 capability 由 Go 返回 available=false 和原因。
- 候选环境必须同时具备后端 feature gate、无生产凭据和网络 egress 阻断；121/Yadi 始终独立禁用，任何真实外部提交都要求显式确认、加密凭据和审计。
- 生产数据演练只能按 production :ro -> RAW immutable clone -> writable migration clone / sanitized acceptance clone 进行；不得 scrub 唯一只读证据副本，不得连接正式卷执行迁移。
- 修改 Migration 27 或其他既有迁移前，必须先确认 checksum 机制；不得改写已发布迁移 1100001、1100002、1100003 的 SQL 或 checksum，只能新增更高版本并记录审计。
- 迁移版本由阶段预先保留：Phase 2=`1100004`、Phase 3=`1100005`、Phase 4=`1100006`、Phase 1 导入审计=`1100007`。Phase 1 可以先写 importer 和 fixture，但不得因实现顺序抢占 `1100004`-`1100006`。
- 每个阶段先写可复现的失败测试，再写最小实现；阶段内每个可审查单元独立 commit。任一测试、checksum、构建、权限或数据对账门禁失败，立即停止后续阶段。
- 本计划不授权替换 10.0.101.122:3000、公网入口、正式 MySQL、正式 volume 或生产镜像。候选发布必须另有明确批准和完整前后版本回滚记录。

## Phase Documents

| 阶段 | 文档 | 负责边界 | 当前状态 |
|---|---|---|---|
| 1 | [Data migration contract](2026-08-31-batch-factory-v11-phase-1-data-migration.md) | Node 数据到 Go/MySQL 的一次性导入合同、演练工具和切换门禁；实际导入最后执行 | 计划 |
| 2 | [Go Foundation and Settings/Snapshot](2026-08-31-batch-factory-v11-phase-2-go-settings-snapshot.md) | 恢复 Go Slice 1、checksum-safe schema、认证代理、Batch/Book/VIDEO 与 Settings/Snapshot | 当前工作线 |
| 3 | [Director, Effective Settings and Compiler](2026-08-31-batch-factory-v11-phase-3-director-effective-compiler.md) | Go Director contract、继承解析、唯一 Final Prompt Compiler | 后续 |
| 4 | [Production, Status and Merge](2026-08-31-batch-factory-v11-phase-4-production-status-merge.md) | Go 生产、状态恢复和 Merge capability/request/status/persistence | 后续 |
| 5 | [V11 UI and Drawers](2026-08-31-batch-factory-v11-phase-5-ui-drawers.md) | 另一条前端 worktree 选择性迁移成熟 UI；本工作树不修改前端 | 并行 |
| 6 | [Candidate Compose and Acceptance](2026-08-31-batch-factory-v11-phase-6-candidate-acceptance.md) | 全新临时卷、镜像 provenance、隔离端口验收和回滚演练 | 协调 |

## Execution Protocol

1. 从本设计提交创建独立实现 worktree；先执行 Phase 2 的 source guard，再运行恢复后的原始 Go 测试。
2. Phase 2 完成并通过 Go/Node contract tests 后，交给 Phase 5 前端 worktree；双方只通过完整 commit SHA 和测试证据汇合。
3. Phase 1 的导入 runner 可以提前实现并在 fixture 上 dry-run，但其审计 schema 固定为 Migration `1100007`；在 Phase 3、4、5 和 6 全部通过前不得读取正式数据或写入任何 V11 production 数据。
4. 每个阶段的最终 commit 必须写入 branch/SHA、测试命令、镜像或数据库证据（若该阶段涉及）和下一阶段的明确输入。
5. Phase 6 只发布候选端口；正式 :3000 切换是独立变更，必须在候选验收报告后再次获得明确确认。

## Completion Definition

只有 Phase 1-6 的独立门禁、fresh MySQL 8.4 矩阵、静态/动态 API 对账、UI 人工验收和回滚演练全部有证据，才可称为 V11 候选完成。任何单独的 UI 展示、Go route 200、容器健康或静态 build 都不等于完整 Batch Factory 已完成。
