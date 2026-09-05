# Batch Factory V11 直接内容导入与技能处理设计

## 背景

当前正式 `/batch-factory` 已经使用 V11 Go/MySQL 链路，但新建批次只接收 Novel Fetch Intake。Git 历史中的旧 Batch Factory 已经实现了手动粘贴、TXT/MD 文件导入和多篇内容解析；Agent 工作区也已经具备技能目录、权限校验和模型调用能力。需要把这两部分能力接回正式 V11，而不是切回旧 V1 路由或使用演示批次。

## 目标

1. 在正式 Batch Factory V11 中提供“直接导入内容”入口，支持粘贴多篇文本和 TXT/MD 文件。
2. 用户可选择已有平台技能或自己的技能，先对导入内容执行技能处理并查看结果，再决定是否创建批次。
3. 将处理后的真实内容写入 `manual` 类型 V11 Intake，并通过现有 V11/MySQL 流程创建批次。
4. 保留原文、处理结果、来源文件、技能 ID/版本和处理状态，支持失败条目单独重试，保证可追溯。
5. 不自动启动 Director，不创建演示数据，不改变 Novel Fetch 既有入口。

## 非目标

- 不把 `/batch-factory-preview` 变成生产入口。
- 不把旧 Node `/api/batch-factory` 作为 V11 正式写入路径。
- 不把技能处理结果直接覆盖原文；原文必须可恢复。
- 不在本次工作中打开公网 Director、视频生成或发布能力。
- 不将每条导入内容强制创建为 Agent 对话任务。

## 用户流程

```text
打开 /batch-factory
  -> 新建批次
  -> 选择“直接导入内容”
  -> 粘贴多篇文本或选择 TXT/MD 文件
  -> 预览标题、字数、来源和条目数量
  -> 选择 0-3 个技能
  -> 执行技能处理
  -> 查看每条原文/处理后结果，失败条目单独重试
  -> 用户明确确认
  -> POST /api/batch-factory/v11/intakes/manual
  -> 返回 manual Intake
  -> 用户明确点击“创建 V11 批次”
  -> POST /api/batch-factory/v11/intakes/<id>/batches
  -> GET /api/batch-factory/v11/batches/<id>
```

技能处理是显式操作，不在粘贴或上传时隐式执行。没有选择技能时，用户仍可直接确认导入，处理结果等于规范化后的原文。

## 技术设计

### 直接导入解析

- 复用 Git 历史中已验证的粘贴和 TXT/MD 解析语义：单篇文件按文件名生成标题，多篇粘贴使用一行 `---` 分隔。
- 空内容、空条目和不支持的扩展名在浏览器侧提前拒绝；服务端再次校验长度和条目数量。
- 每条内容保留 `title`、`sourceText`、`txtText`、`txtFileName` 和 `sourceMetadata.sourceType=manual`。
- 服务端根据标题和原文摘要生成稳定的 `manual-<digest>` 来源 ID；同一 Intake 内重复内容去重，跨 Intake 不覆盖既有数据。

### 技能调用

- 技能列表和选择权限复用 `/api/agent/skills` 以及现有 `skillStore.resolveForChat` 规则。
- 新增 Batch Factory 专用技能处理服务，复用 Agent 的技能解析、敏感字段过滤和模型调用边界，但不创建 Agent 历史任务。
- 技能处理请求包含条目内容、技能 ID 和调用版本；响应按条目返回 `originalText`、`processedText`、`skillRuns`、`status` 和 `error`。
- 技能失败不丢弃原文，不允许带失败结果创建批次；用户可以只重试失败条目。
- 技能版本写入来源元数据，后续 Director 可读取处理后的内容和技能追踪信息。

### V11 Intake 与持久化

- 新增正式 V11 `manual` Intake 路由，沿用 V11 BridgeAuth、用户归属、一次消费和 MySQL 事务边界。
- 复用 `CreateBookInput`/`NovelFetchIntakeInput` 的书目载荷，但通过 `sourceMetadata.sourceType` 区分 `manual` 与 `novel-fetch`。
- `CreateBatchFromIntake` 的默认行为不变：没有覆盖书目时从 Intake 复制书目，成功创建后原子标记 Intake 已消费。
- GET Intake/Batch 必须继续执行 owner scope；跨账号读取返回 404，不泄露存在性。

## 错误与恢复

- 解析失败：不创建 Intake，显示具体文件/条目错误。
- 技能部分失败：保留成功结果，失败条目显示错误并提供重试；未全部成功前禁止确认导入。
- Intake 写入失败：不显示创建成功，允许用户重新提交同一草稿。
- 批次创建冲突：提示 Intake 已消费并刷新真实状态，不重复创建。
- 页面刷新：草稿只保存在当前页面，已创建 Intake/Batch 从 MySQL 恢复；不伪造本地历史。

## 测试与验收

### 前端

- 解析粘贴、TXT/MD、多篇分隔和空内容校验。
- 技能选择最多 3 项、技能处理结果展示、失败重试和原文保留。
- 直接导入调用 `manual` V11 endpoint，不调用旧 Node endpoint。
- 创建前必须经过明确确认；成功后读取真实 batch/book，刷新后仍存在。

### 后端

- manual Intake 路由认证、owner scope、payload 校验和错误状态。
- 技能处理服务复用技能权限，且不写 Agent 任务历史。
- MySQL Intake/Batch 持久化、重复条目去重、一次消费和跨用户隔离。
- Go/Node 全量测试与构建通过。

### 公网

- 只部署 `v88` 已验证镜像，保留 `.env` 和旧镜像回滚标签。
- 使用登录账号在公网 `/batch-factory` 完成真实直接导入流程；不得使用 `/batch-factory-preview` 或演示记录。
- 验证公网刷新、重复提交、技能失败重试和批次持久化；没有真实导入数据时页面必须保持真实空态。
