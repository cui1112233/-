# V88 Git 安全型收口决策记录

日期：2026-09-09
仓库：`cui1112233/-`
维护主线：`v88`
用户选择：A — 安全型收口
设计文档：`docs/superpowers/specs/2026-09-09-v88-safe-git-consolidation-design.md`
状态：设计已批准并落库；等待用户评审设计文件后再编写实施计划。

## 一、用户目标

用户希望：

- 合并仍然有价值的功能；
- 整理 Git 仓库；
- 最终让 `v88` 成为总分支/唯一维护主线；
- 不因为整理 Git 导致已经修复的功能丢失或被旧分支覆盖。

## 二、本次明确选择

采用安全型方案 A：

1. 先功能核账；
2. 有价值内容进入最新 `v88`；
3. 重要历史创建 `archive/*`；
4. 已完整合入且无历史价值的分支留待最终阶段删除；
5. 不直接 merge master；
6. 不直接整支 merge 落后的 feature/fix 分支；
7. 不在当前阶段批量删除分支或 Workflow；
8. 不在当前阶段修改 GitHub 默认分支；
9. 不在 Git 整理任务中顺手部署公网。

## 三、功能核账分类

每个 master-only commit、历史分支、PR 必须标记为：

- `A1 已完整进入 v88`
- `A2 部分进入 v88`
- `A3 尚未进入 v88`
- `A4 已过时 / 不应迁入`
- `A5 需要运行验证`

PR 额外使用：

- `MERGE-CANDIDATE`
- `EXTRACT-ONLY`
- `SUPERSEDED`
- `HISTORICAL`
- `BLOCKED`

## 四、优先核账顺序

1. `master` 唯一遗产；
2. Novel Fetch / 视频管理系统 / Browser Worker；
3. H3 视频能力；
4. 豆包 / 本地执行器；
5. Batch Factory V11；
6. Script / Director / Prompt Pipeline；
7. 发布 / 运维 / Workflow；
8. 其余历史 feature/fix/integration/ops/release/tmp 分支。

## 五、当前已知 master 遗产风险

当前已确认：

- `master` 的版本对应配置档旧实现不能整体覆盖 v88；
- v88 已经重新实现大部分版本选择/UI；
- 仍需要在功能总账阶段核对完整 original～AI5 配置绑定、持久化、测试是否全部被 v88 覆盖；
- 如存在缺口，只基于最新 v88 补最小逻辑和回归测试。

## 六、强保护规则

任何收口不得回退以下 v88 正式语义：

- `originalRaw` 完整保留；
- `maxTxt` 截断处理；
- `4000/27831` 一类处理/原始字数展示；
- `input_ready` = `分类信息已就绪`；
- 日期筛选使用真实日期；
- 视频管理系统登录/401/403/登录页 HTML/超时不能伪装成功；
- accepted/queued/running 不等于 submitted；
- 只有远端列表回读确认后才算 confirmed/submitted；
- 公网发布必须能追溯到 `v88` exact SHA。

## 七、archive 原则

优先 archive：

- master 退出前快照；
- 收口前重要 v88 基线；
- 重要稳定 release；
- 关键迁移/架构历史。

不急于 archive：

- 普通已合入 feature/fix；
- 临时诊断、重复 patch、tmp/temp；
- 已被完整替代且无审计价值的分支。

后者统一留到最终删除阶段处理。

## 八、下一步门槛

当前只完成设计落库。

下一步必须先由用户评审：

`docs/superpowers/specs/2026-09-09-v88-safe-git-consolidation-design.md`

用户确认设计文件后，才进入实施计划阶段。实施计划的第一批工作应是只读功能总账，不直接合并、删除或部署。
