# 小说获取统一运行时收口设计

## 目标

将“小说获取”收口为单一页面、单一业务 API 和单一执行审计链路。后台模型目录是唯一的模型来源：选择 `gemini-3` 必须使分类、改文和敏感词处理实际调用该目录项的运行时模型，绝不静默回退到旧 `Gemini-3.8-flash` 配置。

## 范围与非目标

范围包含小说清单处理、原文抓取、AI 分类、AI 改文、敏感词处理、知识库/规则、121 登录与提交，以及配置和任务历史。批量工厂和水货生产不在本轮改动范围内；它们不得因本次收口失去各自现有接口。

不保留 V78、V2 或“热修复脚本覆盖主页面”的正式运行入口。旧字段与旧任务只允许通过一次性迁移读取，不能继续参与运行时模型决策。

## 当前问题

当前公网页面将下拉框值保存为 `text_model_id`，但 Node 执行代码只读取 `ai`、`ai_presets` 和 `ai_assignments`。因此界面选中 `gemini-3` 时，旧 `ai.model` 仍可实际请求 `Gemini-3.8-flash`。此外，页面以 `/novel-fetch` iframe 承载 `/batch-rewrite/v2`，且多个 V78/V2 脚本在运行期互相覆写，导致配置、执行和排障没有唯一责任边界。

## 架构

### 1. 统一模型绑定与解析

配置只保存 `textModelId`，其值是后台模型目录的稳定 ID。服务端新增小说获取专用的 `resolveNovelFetchTextModel({ username, textModelId })`：它通过现有模型目录运行时解析器取得已启用文本模型的 `baseUrl`、凭证与实际 `modelId`。

分类、改文和敏感词处理都只接收该解析结果；调用路径不得再读取 `ai.model`、`ai_presets` 或 `ai_assignments`。模型不存在、未启用、无凭证或类型不为 text 时，以明确错误终止相应阶段，不能选择默认模型或任何历史模型。模型 ID、显示名和实际 `modelId` 随任务阶段日志持久化。

### 2. 单一配置与业务 API

正式接口统一置于 `/api/novel-fetch/*`，按资源分为：

- `GET/PUT /config`：自动处理、模型绑定、抓取、规则、知识库和 121 提交设置；不返回凭证。
- `GET /models`：当前账号可用的 text 模型目录。
- `POST /runs`、`GET /runs/:id`、`POST /runs/:id/retry`：创建、读取和仅重跑失败阶段。
- `GET/PUT /tasks`、`GET /tasks/:bookId`：任务和正文版本。
- `POST /tasks/:bookId/submit`、`GET /tasks/:bookId/audit`：121 提交与审计读取。

原 `/api/batch-rewrite/*` 和 `/api/novel-fetch-workshop/*` 不再由前端调用；先在同一发布中提供仅迁移使用的内部适配层，再在迁移验证完成后移除公开挂载。任何旧路由返回明确的迁移错误，而非悄悄执行旧行为。

### 3. 单一页面

`/novel-fetch` 直接渲染 React 小说获取工作台，不再使用 iframe，也不加载 `batch-rewrite/v2`、`v78-*`、`121-login-hotfix` 或任务可见性等补丁资产。页面包括处理、任务、配置、知识库、规则和记录六个视图，但它们共享同一 React 状态、同一 API client 和同一任务审计模型。

配置页只展示后台模型目录选择器和与小说获取有关的参数；不再展示旧预设、当前预设或重复的模型输入框。选择模型后，页面显示“目录 ID / 实际模型名”，保存回读后才允许执行。

### 4. 单一执行与审计模型

每次处理产生 run，run 内按书和阶段记录 `queued/running/succeeded/failed/skipped`、尝试次数、开始/结束时间、所选 `textModelId`、实际 `modelId`、可显示错误与安全脱敏的上游请求标识。成功阶段不可被普通重试覆盖；重试只选择最后失败的阶段。原始全文继续保存 `originalRaw`，处理正文继续按 `maxTxt` 截断，显示“处理字数/原始总字数”。

## 数据迁移与兼容

迁移读取现有账户级 MySQL `novel_fetch_workshop_configs`、文档和版本数据，写为新 schema。迁移规则：

1. 若已有 `text_model_id` 且模型目录中存在同 ID 的启用文本模型，直接使用。
2. 否则以旧 `ai.model` 精确匹配当前目录的 `modelId`；匹配唯一项时写入其 ID。
3. 无唯一匹配时标记 `model_binding_required`，保留任务但禁止新的 AI 执行；用户必须在配置页选择模型。
4. 不迁移 API Key、旧预设或旧分配为新执行配置；凭证始终留在后台模型目录。

迁移应可重复执行，逐账号输出统计，不删除任务正文、原始全文、121 会话、知识库或规则。完成后保留只读导出备份和回滚点。

## 错误处理与安全

模型解析错误返回稳定的机器码（如 `NOVEL_FETCH_TEXT_MODEL_REQUIRED`、`NOVEL_FETCH_TEXT_MODEL_UNAVAILABLE`），UI 显示模型名称和修复动作。审计日志绝不记录 API Key、Cookie、原文以外的敏感认证信息或完整上游请求头。121 登录仍保持服务端会话；浏览器不接收密码或 Cookie。

## 测试与验收

- 单元测试证明：模型 ID `gemini-3` 解析为该目录项；旧 `ai.model=Gemini-3.8-flash` 不能影响请求。
- API 集成测试证明：三种 AI 阶段使用同一解析器；不可用模型阻止执行且无回退。
- 迁移测试覆盖四种迁移规则与幂等性，并证明原始全文、正文版本和任务状态保留。
- 前端测试证明：页面无 iframe、无 V78/V2 资产引用、没有旧预设控件，只调用 `/api/novel-fetch/*`。
- 公网验收：以已登录账号选择 `gemini-3`，新 run 的三个 AI 阶段审计均显示 `textModelId=gemini-3` 及对应实际模型名；公网资源和 API 不出现旧工作台调用。

## 发布与回滚

按 V88 Direct Stage -> Cutover 发布。发布前备份受影响的账户配置和 MySQL 数据；Stage 运行迁移 dry-run、自动化测试和已登录验收。Cutover 后保留迁移前配置快照与上一稳定 Git SHA；若失败，回滚 Node SHA 和配置快照，不重建 MySQL/Redis/Worker 基础设施。
