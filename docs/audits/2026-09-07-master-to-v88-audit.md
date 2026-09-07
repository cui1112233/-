# 2026-09-07 Master -> V88 独有提交审计

## 审计对象

- `master` 独有提交：`96908c32456cb7572b8e621221e7cbeff75976db`
- 父提交 / merge base：`fc1f5a96364518f0f14073fd5195363ef0e15a77`
- 提交主题：`feat(novel-fetch): restore popup version config and direct processing`
- 原则：不整包 cherry-pick；逐文件判断 `already-covered`、`migrate-minimal`、`obsolete/replaced`。

## 结论

该 master-only 提交不应整体合入 V88。

当前 V88 已经拥有“版本对应配置档”UI、Original + AI1～AI5、同步批量后台配置、同步批量风格类型，并且前端 `processInput()` 已提交 `selected_versions`、`ai_slot_methods`、`profile_bindings`。真正缺失的是兼容后端链路：`routes/batch-rewrite.js` 仍按 `ai_count` 生成连续 AI1..N，`generate-ai` 没有完整消费所选版本/槽位方法，profile binding 兼容层只覆盖到 AI3；`rewrite.generateAiVersions()` 也仍以连续 count 为核心，无法正确表达只选 AI2 / AI5 这类稀疏版本。

因此本次只迁移这条断裂的数据链，并复用 V88 已存在的 `target-versions.js` 与 `task-ops.js` 语义，不回退当前 V88 UI/架构。

## 文件级分类

| master-only 文件 | 分类 | 处理 |
| --- | --- | --- |
| `docs/superpowers/plans/2026-09-03-novel-fetch-main-version-config.md` | obsolete/replaced | 历史设计，不作为当前执行依据；由 2026-09-07 V88 收口 spec/plan 替代。 |
| `docs/superpowers/specs/2026-09-03-novel-fetch-main-version-config-design.md` | obsolete/replaced | 同上，保留历史即可，不迁入当前规则链。 |
| `frontend/public/batch-rewrite/app.js` | already-covered | 当前 V88 已发送 `selected_versions`、`ai_slot_methods`、`profile_bindings`；不以旧文件覆盖当前前端。 |
| `frontend/public/batch-rewrite/index.html` | already-covered | 当前 V88 已有“版本对应配置档”、Original、AI1～AI5、同步批量后台配置、同步批量风格类型。 |
| `frontend/public/batch-rewrite/styles.css` | already-covered | 当前 UI 已存在并继续维护；不回迁旧样式快照。 |
| `frontend/dist/batch-rewrite/app.js` | obsolete/replaced build artifact | 不手工迁移旧 dist；正式构建由当前 `frontend/public` / build 输入产生。 |
| `frontend/dist/batch-rewrite/index.html` | obsolete/replaced build artifact | 同上。 |
| `frontend/dist/batch-rewrite/styles.css` | obsolete/replaced build artifact | 同上。 |
| `lib/novel-fetch-workshop/task-ops.js` | already-covered | 当前 V88 已有 `targetVersions` / `aiSlotMethodsSnapshot` 相关任务语义；不覆盖。 |
| `lib/novel-fetch-workshop/version-selection.js` | migrate-minimal | 新增 V88 兼容 adapter，但复用现有 `target-versions.js`，不复制旧版整套实现。 |
| `lib/novel-fetch-workshop/rewrite.js` | migrate-minimal | 补稀疏 AI indexes、任务级 slot methods、显式 generated version 集合。 |
| `routes/batch-rewrite.js` | migrate-minimal | 补 `selected_versions` / `ai_slot_methods` 数据链、AI1～AI5 profile binding、稀疏 detail/apply/generate。 |
| `tests/novel-fetch-mainline-version-config.test.js` | replaced by current regression | 用 `tests/novel-fetch-version-config-mainline.test.js` 按当前 V88 架构验证。 |
| `tests/novel-fetch-rewrite-sparse.test.js` | replaced by current regression | 用 `tests/novel-fetch-rewrite-sparse-mainline.test.js` 动态验证 AI2/AI5 稀疏生成。 |
| `tests/novel-fetch-version-selection.test.js` | replaced/absorbed | 当前 adapter 行为由主线版本配置回归测试覆盖；后续如扩大 adapter API 再独立拆测。 |

## TDD 证据

### RED

`V88 Direct Deploy Contract` 在补丁前运行 30 项合同测试：26 通过、4 失败。四个失败均集中在版本选择后端链路：

1. `processPayload` 没有真正消费 `selected_versions` / `ai_slot_methods`。
2. profile binding 兼容层没有覆盖 Original + AI1～AI5 全部六个版本。
3. `/tasks/:id/generate-ai` 没有读取所选版本/槽位方法。
4. 动态稀疏测试请求 AI2 + AI5 时，旧逻辑实际只保存 AI1。

这证明问题不是“UI 不存在”，而是“UI -> 后端 -> rewrite”的数据链在 V88 收口过程中丢了一段。

### GREEN（focused）

在隔离分支应用最小补丁后，focused 5 项全部通过：

- 稀疏 AI2 + AI5 只生成所选版本。
- AI2 / AI5 分别使用任务选择的 slot method。
- UI 继续覆盖 Original + AI1～AI5。
- 后端消费 `selected_versions` / `ai_slot_methods`。
- profile binding 行为覆盖全部六个版本。
- 单任务 `generate-ai` 读取所选版本，而不是默认回到 AI1。

补丁代码提交：`7e7b5d80d32f8469c67fcf331c2a1fd5f34c89fb`（`fix(v88): preserve selected novel AI versions`）。

## 风险与后续验证

Focused GREEN 只证明本次 master-only 缺口已经被最小迁移覆盖，不等于可以立即合入或发布。合入前仍需运行更宽的 Novel Fetch / Node regression 与现有 V88 direct-deploy contracts，确认没有破坏旧的 count 兼容调用、任务详情、规则应用、站点提交等流程。

## 对 master 的处理结论

完成宽回归并确认本次最小迁移可合入后：

1. `master` 独有产品行为视为已审计并按 V88 当前架构迁移。
2. 可以创建 `archive/master-before-v88-canonical-20260907` 指向 `96908c32456cb7572b8e621221e7cbeff75976db`。
3. `master` 本身本阶段仍保留，不删除、不 force-move。
4. GitHub 默认分支可切换为 `v88`；该设置变更必须再读 repository metadata 验证。
