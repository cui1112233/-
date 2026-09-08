# 统一视频模型目录与 MiniMax H3 实施计划

## Goal

在 v88 中建立统一的视频模型目录，并接入 MiniMax H3。用户只选择一个“MiniMax H3”模型；服务端根据是否存在用户上传的参考图自动路由：无图使用 `minimax_h3_lightx2v_no_pic`，有图使用 `minimax_h3_lightx2v_v5_15s`。剧本页和批量工厂必须使用同一份目录与同一套路由规则，先完成本地可验收版本，再准备公网发布。

## Architecture

- 统一目录继续作为前端唯一的视频模型来源，模型记录使用稳定内部 ID、`kind: video`、能力字段和脱敏配置状态。
- H3 使用独立 `autodl_comfyui` provider 适配器，不复用只理解 YD2 响应格式的通用适配器。
- 页面只提交统一的视频请求和可选参考图，不提交 workflow ID；服务端按参考图是否存在选择 workflow。
- AutoDL 任务采用“提交任务 → 保存 `data.task_id` → 轮询结果 → 下载并持久化短时资源地址 → 复用现有任务结果链路”。
- 剧本页与批量工厂均从统一目录读取 H3；批量工厂锁定模型时保存模型 ID 和能力快照。

## Tech Stack

- Go：`backend/internal/batchfactoryv11`、HTTP API、provider adapter、任务状态映射。
- Node.js/Express：`routes/batch-factory-v11.js`、`routes/batch-factory.js`、`routes/script-video.js`。
- React/Vite：`frontend/src/user/pages/ScriptPage.jsx`、批量工厂生产控件及共享模型 API。
- Tests：现有 Go 测试、Node test runner、前端现有测试工具；优先使用项目已有测试脚本。
- External API：AutoDL ComfyUI API；Token 只由服务端环境变量或密钥配置注入。

## Spec path

`C:\Users\Administrator\Documents\Codex\2026-09-04\new-chat-2\qiantie-v88\docs\superpowers\specs\2026-09-08-unified-video-model-catalog-h3-design.md`

## Global Constraints

- 只在 v88 工作树开发；不得修改 `master`。
- 不停止、删除、接管旧 V78 容器；不把 H3 代码混入小说获取登录修复。
- 不把 AutoDL Token 写入 Git、前端构建产物、浏览器 localStorage、日志、错误响应或 Obsidian。
- 不增加“文生/图生”模式选择框；上传图的判定由服务端统一执行，空数组、缺失字段和未上传都按无图处理。
- 不以单元测试、健康检查、401、提交成功或 task_id 存在作为真实视频成功；必须完成本地用户验收链路。
- 任何已有 YD2、豆包执行器和旧目录能力不能被 H3 接入破坏。
- 每个阶段先测试后实现；每个阶段完成后报告测试、改动文件、未解决项和用户可见验收结果。
- 只精确提交本任务涉及的文件，不清理或覆盖用户已有的其他改动。

## Tasks

### Task 1 — 定义统一目录合同与 H3 能力字段

**Write set**

- 统一模型记录和视图的 Go 类型/目录实现文件。
- 对应 Go/Node/API 合同测试文件。

**Tests first**

1. 写测试，要求 H3 的稳定 ID、显示名、`kind: video`、15 秒上限、支持的分辨率和两种 workflow ID 可被目录返回。
2. 写测试，要求前端/服务端目录只有一个 H3 模型记录，不暴露 Token，不要求页面维护第二份 H3 选项。
3. 写测试，要求目录返回 `configured=false` 时只有脱敏状态。

**Implementation**

1. 将 H3 作为一个规范模型记录加入统一目录。
2. 将无图 workflow 与有图 workflow 放入服务端能力/配置字段，不把有图 workflow 当作“必须上传图片”的前端选择项。
3. 保持 YD2 和本地豆包执行器的已有目录行为。

**Acceptance**

目录合同测试通过，并能明确证明页面只需要选择一个 H3。

### Task 2 — 实现 AutoDL H3 provider 适配器

**Write set**

- H3 provider adapter 及其 Go 测试。
- 仅与 provider 注册和任务状态映射直接相关的后端文件。

**Tests first**

1. 使用 HTTP 测试服务器验证无参考图时 POST 路径为 `/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_no_pic`。
2. 验证存在至少一张有效参考图时 POST 路径为 `/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_v5_15s`。
3. 验证请求包含 `Authorization` 和 `Content-Type`，Token 不出现在响应日志/错误文本中。
4. 验证成功解析 `data.task_id`，并正确映射 `QUEUED`、`RUNNING`、`SUCCESS`、`FAILED`。
5. 验证 `SUCCESS` 没有可下载结果、外部资源下载失败、401/403/429/5xx、解析失败和轮询超时都会闭合为可识别失败。

**Implementation**

1. 增加 H3 专用提交、轮询、结果解析和资源持久化逻辑。
2. 统一请求体字段：prompt、duration、resolution，以及有图时的参考图字段；不让浏览器决定 workflow ID。
3. 将短时有效的 AutoDL 结果尽快下载到现有受控结果存储，再返回现有媒体结果结构。
4. 将 H3 provider 注册到现有 provider registry，并保持其他 provider 不变。

**Acceptance**

适配器合同测试通过；假 Token 或缺失 Token 时不发起真实远程生成。

### Task 3 — 配置、密钥和服务端统一路由

**Write set**

- H3 配置读取/脱敏/保存相关后端文件。
- `routes/batch-factory-v11.js`、`routes/script-video.js` 中与 H3 路由直接相关的代码及测试。

**Tests first**

1. 验证 H3 Token 仅从服务端配置读取，模型目录、前端响应、错误响应和日志均不包含 Token。
2. 验证请求没有 `referenceImages`、为空数组或全为空值时选择无图 workflow。
3. 验证请求带有一张或多张有效参考图时选择有图 workflow。
4. 验证页面请求不带 workflow ID 时服务端仍能完成路由。

**Implementation**

1. 提供 H3 默认 base URL、无图 workflow、有图 workflow 和 Token 配置项。
2. 在剧本视频和批量工厂生产入口复用同一个服务端路由函数/合同。
3. 增加清晰的“未配置、上传图后可用、提交中、排队中、生成中、成功、失败”状态映射。

**Acceptance**

服务端路由测试通过，且前端网络请求中看不到 AutoDL Token 和 workflow 选择逻辑。

### Task 4 — 剧本页接入统一目录和自动路由

**Write set**

- `frontend/src/user/pages/ScriptPage.jsx`。
- 剧本视频共享 API/合同测试及必要的页面测试。

**Tests first**

1. 验证剧本页视频模型列表从统一目录得到一个 H3，不再维护独立的 H3 硬编码选项。
2. 验证 H3 请求没有参考图时只发送统一请求，不发送模式选择字段。
3. 验证 H3 请求有参考图时只发送统一请求和参考图，不发送模式选择字段。
4. 验证 H3 未配置时显示明确提示并阻止提交。

**Implementation**

1. 移除剧本页固定的 H3/YD2 选项重复定义，改用目录过滤 `kind: video`。
2. 保留已有模型和本地豆包执行器的用户体验。
3. 将剧本页已有的首帧/参考图状态转换为统一的可选参考图数组。
4. 显示 H3 15 秒和分辨率能力；不显示文生/图生切换控件。

**Acceptance**

本地剧本页可看到 H3；无图、有图两种提交都会产生正确的服务端请求合同。

### Task 5 — 批量工厂接入统一目录和能力校验

**Write set**

- `frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx`。
- 批量工厂模型绑定/生产合同相关文件及测试。

**Tests first**

1. 验证 H3 作为 `kind: video` 出现在批量工厂。
2. 验证 H3 不会因 `requiresImageInput` 旧过滤条件被错误隐藏。
3. 验证导演锁定模型时保存 H3 模型 ID 和能力快照。
4. 验证批量工厂无图任务和有图任务都发送统一请求，由服务端自动选择 workflow。
5. 验证原有 YD2、豆包执行器模型仍可选择和提交。

**Implementation**

1. 使用统一目录的自动路由能力字段调整兼容性过滤。
2. 保持批量工厂已有的模型锁定、任务状态和结果列表机制。
3. 将批量工厂使用的参考图来源适配为可选数组，不强制所有 H3 任务上传图片。

**Acceptance**

本地批量工厂可以看到并锁定 H3；两种输入形态都能进入现有任务链路。

### Task 6 — 本地构建、功能验收和发布包准备

**Write set**

- 仅补充必要的测试夹具、验收文档和发布元数据。

**Verification**

1. 运行后端、Node、前端相关聚焦测试。
2. 运行前端构建和后端构建；记录真实输出，不用旧 dist 或旧 build-info 代替。
3. 启动本地 v88 验收环境，确认剧本页和批量工厂都使用同一 H3 目录。
4. 在未配置 Token 时验收阻止提交和脱敏状态。
5. 在配置测试 Token/可用 Token 后分别验收无图和有图请求；记录实际状态流和结果下载情况。
6. 只有本地真实链路通过后，生成带提交 SHA、构建时间和校验值的 v88 发布包；公网部署另开明确步骤，不自动触碰 ECS。

**Final report**

必须区分：代码测试通过、本地页面可见、AutoDL 真实任务成功、公网部署成功。任何一项没有证据都标为未验证。
