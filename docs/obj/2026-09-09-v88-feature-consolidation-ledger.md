# V88 功能收口总账

日期：2026-09-09
仓库：`cui1112233/-`
执行分支：`audit/v88-feature-consolidation-ledger-20260909`
状态：执行中；本文件只记录只读核账证据，不代表任何历史分支/PR 已批准合并。

## 1. 执行基线

- GitHub 默认分支：`master`。
- 唯一维护主线：`v88`。
- 本轮核账观察到的最新 `v88` HEAD：`540d5143421bbf331452be6835f68d77b5ac35b8`（`fix(v88): allow bounded cold stage bootstrap`）。
- `master` HEAD：`96908c32456cb7572b8e621221e7cbeff75976db`。
- `master...v88` merge-base：`fc1f5a96364518f0f14073fd5195363ef0e15a77`。
- 当前比较：`master` 相对 `v88` 仅独有 1 个 commit；`v88` 相对 `master` 已多 487 个 commit。
- 阶段1冻结文档记录 147 个分支；本轮通过 Branch Search 分两页实际得到 165 个分支。新增数量包含计划、修复和本次审计分支，因此后续不能继续把 147 当当前实时数量。
- `v88` 与 `master` 当前均未启用 branch protection；本轮不修改保护规则。

Ruling: 本轮所有分类都以执行时最新 `v88` 为准；若 `v88` 在核账期间继续前进，最终结论必须再次重放受影响的 compare，不允许用旧 base 直接决定 merge。

## 2. 分类定义

- `A1`：已完整进入 v88；不迁代码。
- `A2`：主要能力已进入 v88，但仍存在字段、状态、测试、持久化或边界缺口；只补最小缺口。
- `A3`：当前 v88 没有，但功能仍需要；基于最新 v88 重做/提取。
- `A4`：已过时、被替代或与当前架构冲突；不迁。
- `A5`：静态代码不足以确认；必须做真实运行验证。

PR 处置：`MERGE-CANDIDATE / EXTRACT-ONLY / SUPERSEDED / HISTORICAL / BLOCKED`。

## 3. master-only 遗产

| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
| master-only commit | `96908c32456cb7572b8e621221e7cbeff75976db` | Novel Fetch 版本对应配置档 / 直接处理 | `master` 只独有这一 commit；改动含前端版本配置卡片、`version-selection.js`、rewrite/task-ops/routes 和 3 组版本相关测试。当前 v88 已有 `target-versions.js`，版本集合已是 `original, ai1..ai5`，但 `lib/novel-fetch-workshop/version-selection.js` 在 v88 不存在。 | A2 | EXTRACT-ONLY | UI/静态功能可代码核对；121 同步和真实提交仍需 A5 | 对 15 个 changed files 做逐文件等价核对，只提取 v88 缺失逻辑/测试 | 禁止整 commit merge；不能覆盖 v88 后续 Browser Worker、登录和提交确认语义 |

### master 专项已确认

1. `master` 不再是一个功能集合，只剩一个真正 master-only commit；因此 master 退出的关键不是“大合并”，而是彻底处理 `96908c3`。
2. v88 已有六版本底层顺序：`original, ai1, ai2, ai3, ai4, ai5`，说明 master 的六版本概念不是全部缺失。
3. v88 当前不存在 master 的 `version-selection.js`，所以不能把 master 功能简单判成 A1。
4. 版本配置 UI、请求、任务持久化、上传绑定、回归测试必须分别核对，不能因为前端“看得到 AI4/AI5”就认定后端链路完整。

## 4. 开放 PR

本轮确认当前仍有 10 个以 `v88` 为 base 的开放 PR。它们的 recorded base 大多显著早于当前 `v88=540d514...`，且本轮逐项查询均为 `mergeable=false`；因此当前没有任何一个可以被视为“无需重放就直接 merge”的候选。

| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
| PR | #39 `fix(v88 novel-fetch): load current 121 login guard asset` | Novel Fetch 登录 / 121 | draft；base=`314b863...`；head=`ad97f75...`；4 commits / 2 files；当前 `mergeable=false` | A5 | BLOCKED / EXTRACT-ONLY | 必须真实登录/验证请求确认；合同测试不能等同真实登录 | 对两文件 diff 与当前 v88 登录 guard 做重放核对；若代码仍需要则基于最新 v88 重做最小补丁 | 不能直接合并旧 base |
| PR | #37 `ops(v88): consolidate canonical workflow and Runtime A` | 总收口 / master gap RED tests | draft；base=`2c26c27...`；14 commits / 13 files；当前 `mergeable=false` | A2 | EXTRACT-ONLY / HISTORICAL | 无需公网即可判断文档/测试；运行切换不在本轮 | 保留仍有价值的 RED 测试/设计证据，与当前新收口设计去重 | 当前设计/计划已被 2026-09-09 安全收口文档部分替代 |
| PR | #34 `feat(v88): Git → ECS 直部署与增量发布` | 发布链 | draft；base=`0062447...`；39 commits / 23 files；当前 `mergeable=false` | A1/A4 候选 | SUPERSEDED / EXTRACT-ONLY | 不运行生产部署 | 对照当前 `deploy/v88-direct` 和最新 cold-stage bootstrap；仅保留未进入 v88 的测试/文档 | 当前 v88 已实际使用 Direct Stage/Cutover；旧 PR 不应整合 |
| PR | #33 `fix(v88): unblock public release verification` | 发布验证 | base=`6673cea...`；1 commit / 1 file；当前 `mergeable=false` | A1/A4 候选 | SUPERSEDED | 不运行发布 | 对照当前 release guard 测试；若当前已有等价规则则关闭候选 | PR 本身描述仍停留在 TDD 红灯阶段 |
| PR | #31 `docs: define V88 Git-to-ECS direct deployment` | 发布设计文档 | base=`c87d019...`；2 commits / 2 docs files；当前 `mergeable=false` | A1/A4 候选 | HISTORICAL / SUPERSEDED | 无 | 对照当前 Direct Deploy 设计与执行记忆，保留历史参考即可 | 文档型 PR，不是运行能力来源 |
| PR | #29 `fix(v88): bridge Browser Worker onto v88-node networks` | Browser Worker 网络 | base=`043d3b0...`；4 commits / 3 files；当前 `mergeable=false` | A5 | EXTRACT-ONLY / BLOCKED | 生产/Stage 网络解析需要真实运行证据 | 静态核对当前 workflow 是否已有 attach network；真实路由另列 A5 | 旧症状为 Node 无法解析 worker DNS |
| PR | #24 `fix(v88): 收口版本对应配置档持久化` | Novel Fetch 版本配置持久化 | draft；base=`ab86f16...`；7 commits / 5 files；当前 `mergeable=false` | A2 | EXTRACT-ONLY | 保存后重开需运行/UI验证 | 与 master-only `96908c3`、当前 v88 work-form/profile binding 一起核账 | 用户近期仍报告配置保存/重开问题，不能判 A1 |
| PR | #16 `fix(v88): unify account roles and manager backend permissions` | 账号/后台权限 | base=`84aef43...`；21 commits / 12 files；当前 `mergeable=false` | A5 | EXTRACT-ONLY | 权限实际生效需 API/角色验证 | 对照当前账号路由、grant model 与管理端；再决定是否 A1/A2 | 非当前最高优先，但必须在默认分支切换前核清 |
| PR | #10 `V88 consolidation: integrate release-line Batch Factory and 121 fixes` | Batch Factory V11 + 121 | base=merge-base `fc1f5a...`；30 commits / 266 files；当前 `mergeable=false` | A2/A4 | EXTRACT-ONLY | 121 部分需要真实验证 | 只做文件级功能账，不得整 PR merge | PR 自身已明确“冲突则不要 merge”；变更面过大 |
| PR | #12 `V88 consolidation: integrate Novel Fetch local-first Go lifecycle` | Novel Fetch Go 生命周期 | base=merge-base `fc1f5a...`；95 commits / 265 files；当前 `mergeable=false` | A2/A4 | EXTRACT-ONLY | 本地执行器/同步路径需要运行验证 | 对 body/history、codec、retention、migration、executor sync 分项找 v88 权威实现 | 变更面过大，必须拆功能核账 |

## 5. Novel Fetch / 视频管理系统 / Browser Worker

| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
| current v88 | `lib/novel-fetch-workshop/target-versions.js` | 六版本目标选择 | `TARGET_VERSION_ORDER` 已固定为 `original, ai1..ai5`，包含 legacy/effective/ready/pending 版本推导 | A1 | - | 无 | 保留为 v88 权威版本选择基础 | 不要用 master 的旧模块整体替换 |
| historical set | `fix/v88-novel-*`, `fix/v88-121-*`, `ops/v88-public-121-*`, PR #24/#29/#39 | 登录、Worker、版本配置、提交 | 当前分支列表仍有大量同主题历史线；最新 v88 已继续新增 upload session 401、submit confirm、cold stage 等修复 | A2/A5 | EXTRACT-ONLY | 登录、Worker、远端提交均需真实验证 | 后续按“登录→抓取→保存→上传→book_list 回读”五段分别核账 | `healthy`/`task_id`/queued 不能当真实提交成功 |

## 6. H3 视频能力

| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
| branch | `feat/v88-h3-unified-video-20260909` | H3 provider / Batch Factory V11 / Script video | 已知分支包含 H3 provider、模型目录、Go/Node/React 适配及测试；分叉后 v88 又前进并加入 Novel Fetch/发布修复 | A3/A2 | EXTRACT-ONLY | H3 外部 API 调用需真实验证 | 以最新 v88 重放 H3 文件差异，绝不以 H3 HEAD 覆盖 v88 | 目前没有开放 H3 PR |

## 7. 豆包 / 本地执行器

| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
| historical set | `feat/v88-local-executor-auto-update`, `fix/v88-doubao-*`, `fix/v88-local-executor-*`, `integrate/v88-local-executor-*` | Windows 执行器 / `/api/script-video` / 自动更新 | 当前仍存在多条实现、集成和回归分支，说明功能已多轮迭代 | A2/A5 | EXTRACT-ONLY | Windows EXE、授权、更新覆盖需真实客户端验证 | 分别核对服务入口、script-video、public auth、Windows build/update、版本检测 | 不把一次性 public-fix workflow 当权威实现 |

## 8. Batch Factory V11

| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
| historical set | `feat/batch-factory-v11-*`, `feat/bf11-dual-video-provider-integration-20260902`, `review/batch-factory-v11-ui-on-v2-121`, PR #10 | BF11 frontend/Go runtime/provider/settings | 多条历史线仍存在；v88 已确认 Batch Factory V11 是当前 maintained scope | A2 | EXTRACT-ONLY | provider/个人 API 需接口验证 | 以当前 v88 BF11 文件为权威，对旧分支只找缺失功能/测试 | H3 后续应作为 BF11 视频 provider 增量接入 |

## 9. Script / Director / Prompt Pipeline

| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
| historical set | `feature/script-*`, `07-script-shot-prompt-unification`, `feature/cm-script-*` | 剧本/分镜/提示词/交互 | 当前仍有多个历史功能分支，v88 也有正式 script prompt pipeline workflow | A2 | EXTRACT-ONLY | 生成结果质量需功能验证 | 核对 matchAudio、剧情模式、提示词约束、选中镜头替换、tab 草稿隔离等是否已进入 v88 | 不把旧 prompt 文案覆盖当前后端 prompt 管理 |

## 10. 发布 / 运维 / Workflow

| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
| current v88 | Direct Stage/Cutover lineage | Node 正式发布链 | 当前 v88 最新提交仍在修正 bounded cold-stage bootstrap，说明 Direct Deploy 是活跃维护路径 | A1 | - | 发布时需 exact-SHA 验证，但本轮不执行 | 保留 Direct Stage/Cutover 为唯一正常 Node 发布入口 | 旧 GHCR/Docker emergency/once 不得恢复成日常入口 |
| historical set | `feat/v88-direct-deploy-*`, `fix/v88-release-*`, `ops/v88-*release*`, PR #31/#33/#34 | 旧设计/修复/诊断 | 大量历史候选仍存在但当前 v88 已继续演进 | A4/A1 | HISTORICAL / SUPERSEDED | 无需现在发布 | 后续按 Workflow 名单做 ACTIVE-RELEASE/ACTIVE-CI/RECOVERY/HISTORICAL-ONCE/SUPERSEDED 分类 | 阶段7前不删除 |

## 11. 其余历史分支

本轮 Branch Search 实时共得到 165 个分支。已按命名空间识别以下待逐 ref 核账组：

- 编号产品功能：`01-*` ～ `10-*`
- `feat/*` / `feature/*`
- `fix/*`
- `design/*` / `docs/*` / `plan/*`
- `integrate/*` / `integration/*`
- `ops/*` / `release/*` / `ci/*` / `diag/*` / `review/*`
- `archive/*`
- `tmp*` / `temp-*`
- `master` / `v88`

当前阶段不对尚未逐 ref 比较的普通历史分支伪造 A1/A4 结论。它们保持“只读待核账”，只有完成相对最新 v88 的 compare 后才能进入 archive/delete 候选。

Ruling: 分支名看起来像 tmp/old/release 不能单独作为删除依据；阶段7删除前必须有 compare 或明确替代 SHA。

## 12. A2 / A3 后续最小回迁队列

优先顺序：

1. `master@96908c3`：Novel Fetch 版本对应配置档六版本链路与缺失回归测试。
2. PR #24：版本配置保存/重开单一权威链路，与 master 遗产合并核账，避免重复实现。
3. PR #39：登录 guard 只提取仍需要的最小资产/逻辑；先对最新 v88 重放。
4. `feat/v88-h3-unified-video-20260909`：H3 provider/模型目录/BF11/Script video 增量回迁到最新 v88。
5. 豆包/本地执行器：script-video、授权、Windows 更新链按能力拆分。
6. PR #10/#12：只作为 BF11/Novel Fetch Go 历史证据源，禁止整 PR 合并。
7. Script/Prompt 历史分支：按当前用户明确需求（剧情模式、matchAudio 等）逐项确认。

## 13. A5 运行验证缺口

- 视频管理系统真实登录：必须验证登录/验证请求是否真实返回，不把本地合同测试当成功。
- Browser Worker：必须确认 Node→Worker 路由/DNS/secret 传递真实可用。
- 原文抓取：必须确认目标站返回真实正文而非登录页 HTML/超时。
- 上传提交：accepted/queued/running 只能是 pending；必须通过远端 `book_list` 回读确认后才能 confirmed/submitted。
- 版本对应配置档：保存后刷新/重进仍需 UI/API 持久化验证。
- H3：真实模型 API 请求/返回与 ref_image_0..3 映射需外部验证。
- 本地执行器：Windows EXE 连接、公网授权、覆盖更新、版本检测需真实客户端验证。
- 账号/权限：角色切换和 MANAGER grant 实际生效需 API/界面验证。

## 14. 本阶段结论

已完成的证据型结论：

- `master` 仅剩 1 个独有 commit，但不能直接废弃，因为该 commit 至少属于 A2 候选。
- 当前所有 10 个开放到 v88 的旧 PR 都不能直接 merge；逐项查询均显示 `mergeable=false`，应先按 EXTRACT/SUPERSEDED/BLOCKED 处理。
- 实时分支数已经从阶段1的 147 增长到 165，说明收口期间仍在产生分支；后续阶段3需要进一步约束分支生命周期。
- H3 仍在独立分支，尚未进入当前 v88 权威线。
- Git 清理不能先删分支；当前正确顺序仍是：功能总账 → A2/A3 最小回迁 → PR 收口 → archive → Git 规则 → 最终删除。

本文件后续还需要补：165 个分支逐 ref compare 结果、Workflow 逐文件分类、五大功能域文件级权威 SHA。