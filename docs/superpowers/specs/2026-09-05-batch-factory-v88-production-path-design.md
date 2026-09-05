# Batch Factory V11 真实生产入口设计

## 背景

公网已经能打开 Batch Factory 页面，但用户从 `/batch-factory` 直接进入时看不到真实批次，也没有清晰的下一步入口。当前代码中 V11 后端已经提供了 Novel Fetch Intake、从 Intake 创建批次和批次读取接口；小说获取 iframe 也已经包含真实转入逻辑，但外层页面没有接住转入后的跳转消息，构建产物还可能保留旧版 Node Intake 地址。

`/batch-factory-preview` 只展示模拟批次，不能作为生产验收证据。所有可用性验收必须走 `/batch-factory` 和 `/api/batch-factory/v11`。

界面基准采用用户提供的目标截图：深色三列工作台、批次头部操作区、批次状态中心、当前筛选、小说列表、当前小说工作台、统一成片预览和批量工具。截图中的批次名称、100 本数量和状态数字只是视觉参考，生产页必须由 V11 服务端真实数据填充。

## 目标

1. 用户可从真实小说获取任务选择原文，创建 V11 Intake，并自动进入 `/batch-factory?intake=...`。
2. 用户可在真实 V11 页面明确点击“创建 V11 批次”，批次写入 V11 存储，并重新读取真实批次和书目。
3. 直接打开 `/batch-factory` 时，页面给出真实的“去小说获取并导入”入口，而不是展示模拟数据或让用户陷入空白状态。
4. 构建后的静态资源必须使用 V11 Intake 地址，不能回退到旧 `/api/batch-factory/intakes/novel-fetch`。
5. 保持用户隔离、认证、Intake 一次消费和批次持久化边界；创建批次不自动启动 Director。

## 非目标

- 不把 `/batch-factory-preview` 改造成生产页面。
- 不把演示批次、固定历史数组或 mock 书目写入生产接口。
- 不在本次修改中自动启动 Director、视频生产或外部发布。
- 不迁移或删除旧 Node Batch Factory API；本次真实生产链路只依赖 V11。

## 真实链路

```text
小说获取真实任务
  -> 选择已完成原文的任务
  -> POST /api/batch-factory/v11/intakes/novel-fetch
  -> 返回 intake + redirectTo
  -> iframe postMessage 给外层页面
  -> /batch-factory?intake=<id>
  -> 用户明确点击“创建 V11 批次”
  -> POST /api/batch-factory/v11/intakes/<id>/batches
  -> GET /api/batch-factory/v11/batches/<id>
  -> V11 工作台读取真实书目
```

转入 payload 必须保留 `sourceTaskId`、`bookId`、标题、平台、`sourceText`、`txtText`、文件名和来源元数据。外层页面只接受同源、指定消息类型的跳转消息，并通过现有路由机制导航，避免 iframe 任意改变顶层页面。

## 入口行为

- `/novel-fetch`：真实小说获取 iframe 保留“进入批量工厂”按钮；没有选中任务或原文为空时不得创建 Intake。
- `/batch-factory?intake=...`：展示 Intake 摘要和“创建 V11 批次”按钮；创建失败显示真实错误，不假报成功。
- `/batch-factory` 无批次且无 Intake：展示“去小说获取并导入”按钮，导航到真实 `/novel-fetch`，并说明需要先选中已完成原文的任务。
- `/batch-factory-preview`：继续作为演示/审阅页面，不能被生产验收引用。

## 测试与发布门槛

### 单元/源码门槛

- iframe 转入路径断言 V11 endpoint、source lineage 字段和 redirect。
- 外层页面断言只接受指定同源 postMessage，并导航到 redirect。
- 无批次状态断言存在真实小说获取入口且不渲染模拟批次。
- V11 runtime/adapter 断言创建批次成功、失败和 Intake 一次消费行为。
- 前端构建成功，构建产物中的 batch-rewrite bundle 不得出现旧 Intake endpoint。

### 集成/浏览器门槛

- 登录后真实 `/batch-factory` 可加载 V11 capabilities 和 batches。
- 选一个真实已完成小说任务，转入后能看到 Intake，点击创建后能看到真实 batch/book 数据。
- 刷新页面和重新登录后，批次仍可读取；跨用户不能读取该 Intake 或 batch。
- 不以 preview 页面、demo 数据、401 响应或单独 HTTP 200 作为通过证据。

### 分支与发布约束

所有开发、测试和候选构建只写入 `v88` 隔离工作树。未完成上述门槛前不切主分支、不发布公网；公网发布必须使用已验证的 v88 构建产物，并保留可回滚版本和正式数据卷。
