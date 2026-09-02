# Qiantie 仓库版本与开发记忆

> 本文件是 Qiantie 长期仓库治理规则。任何 AI、Codex 或开发者开始修改前必须先读本文件和 `CURRENT_VERSION.md`。

## 当前核心规则

1. `v88` 是本轮“核心功能收口”的唯一目标主线。
2. 在 V88 收口完成、测试通过前，`v88` **不是生产完成态**，也暂不切换 GitHub 默认分支。
3. 所有历史 `feat/`、`fix/`、`integration/`、`release/`、`ops/`、`plan/`、`design/` 分支都只是来源或历史，不能因为名字看起来新就直接继续开发。
4. 禁止把所有旧分支无脑 merge 到 `v88`。必须按模块吸收最新版成果，避免旧代码、构建产物、部署脚本和重复实现回流。
5. 一个功能只有在合入 `v88` 并完成验证后，才算 Qiantie 当前版本真正拥有该功能。
6. 不得直接修改 `frontend/dist/`、`node_modules/`、worktree 副本、production snapshot 等非正式源码作为功能实现。
7. 遇到“这个功能以前做过”时，优先执行：找回 → 对比 → 选择最新实现 → 合入 V88；不要直接重写。
8. 任何合并前都必须确认当前 HEAD、来源分支、目标模块以及与 V88 的差异。
9. 历史分支在 V88 完整验证前不删除；需要改动分支指针时先归档备份。
10. 生产部署最终必须能够对应到唯一 Git SHA。

## V88 当前收口来源

### 综合基线

`feat/v78-go-integrated-novel-fetch-doubao`

该分支作为 V88 起点，已覆盖较完整的：
- Go 集成后端
- 豆包本地执行器
- 小说获取 Go Workshop 基础
- 本地执行器 Job / Artifact / Device 等核心能力

### 需要继续吸收

- `release/production-v78.3.0.3-batch-factory-go-first`
  - Batch Factory Go 后端后续修复
  - 121 / Novel Fetch V2 后续修复和测试
- `feat/v78-novel-fetch-local-first-s2-go`
  - 小说正文与历史分离
  - 正文生命周期、清理、存储状态
  - 本地同步与 MySQL 支持
- `feat/v78-novel-fetch-local-first-s2-executor`
  - 重点提取 `local-executor/src/novel-body-store.js` 及对应测试
- `feat/batch-factory-v11-layout-showcase`
  - Batch Factory V11 当前前端工作台、设置 Drawer、状态适配、固定单镜头等
- `integration/v78-novel-fetch-v2-final-20260902`
  - 仅检查 V88 / release 未覆盖的 Novel Fetch V2 差异，不整分支盲合

## 已确认不需要单独再合并

- `fix/v78-full-regression-20260902`：已被后续 release 分支覆盖。
- `feat/v78-doubao-local-executor-s5-artifact-return`：已被综合基线完整包含并继续演进。
- `feat/v78-novel-fetch-local-first-s1-go`：已被 `s2-go` 完整包含。

## 高风险来源

以下内容不能整分支直接合并：
- `ops/*`
- `plan/*`
- `design/*`
- production snapshot
- 含大量 `frontend/dist` 构建产物变化的旧分支

## 每次开发前必须检查

- 仓库：`cui1112233/-`
- 当前分支是否基于 `v88`
- 当前 `v88` HEAD
- `CURRENT_VERSION.md`
- 当前模块真实源码入口
- 是否已经有更新实现存在于 V88

如果无法确认，停止编码，先做版本确认。
