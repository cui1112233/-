# V88 安全型 Git 功能收口与仓库整理设计

日期：2026-09-09
仓库：`cui1112233/-`
唯一维护主线：`v88`
策略：A — 安全型收口
状态：设计已批准并落库，等待用户评审书面设计

## 1. 目标

把当前分散在 `master`、历史 `feature/fix/integration/ops/release` 分支和未关闭 PR 中仍然有效的功能，逐项核账并安全收回最新 `v88`；同时整理 Git 结构，使 `v88` 最终成为默认且唯一长期维护分支。

本设计不通过“大合并”解决历史债务。任何旧分支都只能作为只读参考源，必须先判断其功能是否已经被当前 `v88` 重写、部分替代、尚未迁入或已经过时，再决定是否提取最小改动。

## 2. 不做什么

本阶段明确不做以下动作：

- 不直接把 `master` 整体 merge 到 `v88`。
- 不把任何明显落后于当前 `v88` 的 feature/fix 分支整支覆盖或强行合入。
- 不批量删除历史分支。
- 不批量删除历史 Workflow。
- 不修改公网运行环境。
- 不因为 Git 整理而顺手部署、重启、停止或删除生产服务。
- 不在功能核账完成前修改 GitHub 默认分支。
- 不把 ECS/公网文件视为源码真相。

## 3. 权威关系

统一认定：

```text
Git v88 = 唯一源码真相
历史分支 = 只读候选来源
PR = 候选变更载体，不代表功能一定应该合入
ECS/公网 = v88 的运行副本，不是开发源
```

任何最终保留的功能必须形成 `v88` lineage 中可追溯的 commit，并有对应测试或明确的运行验证证据。

## 4. 安全型收口分类

每一个历史分支、PR 或 master-only commit 都必须归入以下分类之一：

### A1 — 已完整进入 v88

判定标准：

- 当前 `v88` 已存在等价或更完整实现；
- 核心行为和接口均已覆盖；
- 关键回归测试已经存在或有等价替代；
- 不需要再迁代码。

处理：保留核账证据，后续关闭对应 PR；重要历史分支可转 archive，普通已完成分支留待阶段 7 删除。

### A2 — 部分进入 v88

判定标准：

- v88 已有主要实现；
- 但仍缺部分字段、状态、版本、测试、异常处理或持久化路径。

处理：禁止整支 merge；只从旧实现提取仍有价值的最小逻辑和测试，并基于最新 `v88` 重新实现。

### A3 — 尚未进入 v88

判定标准：

- 功能仍然需要；
- 当前 v88 无等价实现；
- 旧分支或 PR 中存在可验证实现。

处理：基于最新 `v88` 新建短生命周期 feature/fix 分支，通过测试后合入 `v88`；不得让旧分支重新成为维护主线。

### A4 — 已过时 / 不应迁入

判定标准：

- 对应架构、接口或发布路径已被替代；
- 与当前 v88 语义冲突；
- 只用于历史一次性修复、诊断或旧运行方式。

处理：不迁代码；记录替代关系。重要证据可 archive，阶段 7 再删除无价值分支/Workflow。

### A5 — 需要运行验证

判定标准：

- 静态代码无法证明功能等价；
- 依赖 121/视频管理系统、Browser Worker、登录态、生产路由、Windows 执行器或外部服务行为。

处理：先列出唯一验证缺口；不能用单元/合同测试冒充真实外部成功。

## 5. master 收口规则

当前 `master` 与 `v88` 已明显分叉，不能直接合并。

`master` 的独有提交必须逐文件核账。特别是 Novel Fetch 的版本对应配置档功能，应按以下方式处理：

1. UI 若 v88 已重新实现，则不回迁旧 UI。
2. 版本选择若 v88 已有等价 `target-versions` 能力，则保留新版。
3. 若旧实现仍覆盖 v88 当前缺口，例如 original～AI5 的完整配置绑定或相关回归测试，则只补缺口。
4. 旧 Node/前端实现不得覆盖 v88 后续的 121 登录、Browser Worker、提交确认、accepted_pending/confirmed/submitted 等新语义。
5. master 的功能遗产全部核清后，master 才进入历史状态。

## 6. 并行功能分支收口规则

所有并行功能必须以“最新 v88”为合并目标，而不是互相作为基线。

### 6.1 Novel Fetch / 视频管理系统 / Browser Worker

最高优先级保护语义：

- 完整 `originalRaw` 保留；
- 处理正文按 `maxTxt` 截断；
- 显示 `处理字数/原始字数`，如 `4000/27831`；
- `input_ready` 展示为“分类信息已就绪”；
- 日期筛选使用真实任务日期；
- 401/403、登录页 HTML、超时、缺 remote id、queued/running 必须和真实远端确认区分；
- accepted/queued 不能直接视为 submitted；
- 只有远端 `book_list` 回读确认后才进入 confirmed/submitted 语义。

任何历史分支如果会退回这些规则，均不得整支 merge。

### 6.2 H3 视频能力

H3 分支必须先对照最新 v88：

- 保留 H3 provider、模型目录、Batch Factory V11 适配、脚本视频调用和测试；
- 同时保留 v88 在 H3 分叉之后新增的 Novel Fetch/121 修复；
- 允许 cherry-pick、重新实现或拆分 commit；
- 禁止用 H3 分支 HEAD 覆盖最新 v88。

### 6.3 豆包 / 本地执行器

核对：

- 本地执行器服务入口；
- `/api/script-video` 路由；
- 公网授权；
- Windows 构建和更新；
- 覆盖更新而不是生成多个安装副本；
- 版本检测与回归 Workflow。

仍在使用的能力进入 v88；一次性 public-fix workflow 只保留审计价值。

### 6.4 Batch Factory V11

核对前端 V11、Go runtime、视频 provider、个人 API、VIDEO 状态、合并/发布权限、设置 Drawer 等能力。任何旧 Batch Factory 分支只能作为差异来源，不能恢复为独立主线。

### 6.5 Script / Director / Prompt Pipeline

核对剧本生成、提示词约束、剧情模式、音频匹配、提示词管理和相关 Workflow。当前有效行为统一进入 v88，避免旧提示词或旧路由被历史分支覆盖。

## 7. PR 收口规则

每个开放 PR 必须进入一种明确状态：

- `MERGE-CANDIDATE`：基于当前或可安全更新到当前 v88，功能仍需要，测试可验证；
- `EXTRACT-ONLY`：不能整 PR 合并，只提取部分逻辑/测试；
- `SUPERSEDED`：功能已被 v88 新实现替代；
- `HISTORICAL`：只保留审计/设计价值；
- `BLOCKED`：需要外部运行验证或存在冲突，尚不能决定。

关闭旧 PR 时必须注明替代的 v88 commit/PR 或“不再采用”的原因，避免未来再次误合。

## 8. 分支整理目标

收口后长期结构目标：

```text
v88                         # 唯一长期维护主线
feat/<short-lived-name>     # 临时功能分支，完成即合入/关闭
fix/<short-lived-name>      # 临时修复分支，完成即合入/关闭
archive/<important-history> # 少量重要历史快照
```

不再保留大量长期活跃的 integration/ops/release/tmp 分支作为平行“准主线”。

## 9. archive 规则

采用安全型方案 A：

### 必须优先考虑 archive 的对象

- master 退出前快照；
- v88 大规模收口前关键基线；
- 重要公网稳定 release lineage；
- 曾承担关键架构/迁移、且未来可能需要审计的历史分支；
- 不能简单从 tag/release/commit message 恢复上下文的重要实验成果。

### 不必永久 archive 的对象

- 已完整进入 v88、无额外历史价值的普通 feature/fix；
- 临时诊断分支；
- 重复 patch 分支；
- 已被明确替代且无审计价值的 tmp/temp 分支。

这些对象在阶段 7 才删除。

## 10. Workflow 整理规则

Workflow 同样先核账后删除。

分为：

- `ACTIVE-RELEASE`：当前正式发布链；
- `ACTIVE-CI`：仍承担必要测试/构建；
- `RECOVERY`：只允许紧急恢复；
- `HISTORICAL-ONCE`：一次性 patch/诊断；
- `SUPERSEDED`：已有正式替代。

正式 Node 发布链继续保持：

```text
V88 Direct Deploy Node Stage
-> exact staged SHA
-> V88 Direct Deploy Node Cutover
-> external exact-SHA verification
-> rollback protection
```

Git 整理期间不得新增另一套正式公网发布路径。

## 11. 默认分支切换门槛

GitHub 默认分支只有在以下条件全部满足后才允许从 `master` 切到 `v88`：

1. master-only 功能遗产已全部核账；
2. 关键 feature/fix/PR 已完成 A1～A5 分类；
3. 所有仍需维护的能力已进入 v88；
4. v88 的关键 CI/合同测试通过；
5. 需要外部验证的关键功能已有明确结果或明确 BLOCKED 记录；
6. 重要 archive 已创建；
7. 默认开发/发布文档、AGENTS、OBJ 都指向 v88；
8. 不存在必须从 master 才能执行的正式 Workflow。

默认分支切换属于 Git 规则收口，不和功能迁移混在同一个不可回退操作中。

## 12. 阶段顺序

### Phase 1 — 功能总账

产出全仓库分支/PR 功能矩阵，优先：

1. master-only 遗产；
2. Novel Fetch / 视频管理系统 / Browser Worker；
3. H3；
4. 豆包 / 本地执行器；
5. Batch Factory V11；
6. Script / Prompt Pipeline；
7. 发布/运维相关分支；
8. 其余历史分支。

### Phase 2 — 最小功能回迁

只对 A2/A3 项执行开发：基于最新 v88 新建短生命周期分支，TDD/合同测试后合入。

### Phase 3 — PR 收口

关闭 SUPERSEDED/HISTORICAL；合入已验证 MERGE-CANDIDATE；EXTRACT-ONLY 保留迁移记录后关闭。

### Phase 4 — 安全 archive

创建必要 archive 快照，但不删除普通历史分支。

### Phase 5 — Git 规则收口

确认默认分支、branch protection、必须检查项、禁止旧主线发布等规则。

### Phase 6 — 稳定观察

确认 v88 的日常开发、CI、发布均不再依赖 master/历史分支。

### Phase 7 — 删除

只有到原七阶段计划的最终删除阶段，才删除确认无价值的旧分支和 Workflow。

## 13. 验收标准

安全型 Git 收口完成必须能回答：

- 当前唯一维护主线是什么？—— `v88`。
- master 是否还有任何独有且需要维护的功能？—— 必须有逐项证据证明“没有”。
- 每个重要历史分支为何保留、归档或关闭？—— 有分类记录。
- H3、Novel Fetch、豆包、Batch Factory V11、Script 的当前权威实现在哪？—— 都能指向 v88 文件与 SHA。
- 公网发布是否仍可追溯到 v88 exact SHA？—— 是。
- 删除任何历史分支前是否已证明其功能不再被依赖？—— 是。
- 是否能回滚到收口前的重要稳定点？—— 是，通过 archive/tag/release/明确 SHA。

## 14. 失败保护

遇到以下情况必须停止合并该候选并标记 BLOCKED：

- 分支比 v88 落后且会覆盖已确认修复；
- 合并后测试语义下降；
- 需要真实外部站点确认但当前只有合同测试；
- 无法区分旧功能和新版替代关系；
- 涉及生产配置但 Git 中没有完整来源；
- 需要凭据才能判断且当前任务不允许读取凭据。

不允许为了“把 Git 整理干净”而牺牲功能正确性或生产可追溯性。

## 15. 最终原则

**先收功能，再收 Git；先证明替代，再归档；先稳定 v88，再切默认分支；最后才删除。**
