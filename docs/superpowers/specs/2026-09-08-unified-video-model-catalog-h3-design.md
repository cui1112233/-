# 统一视频模型目录与 MiniMax H3 对接设计

## 目标

把视频模型变成 v88 的统一能力目录。剧本页、批量工厂和后续所有生成视频入口都从同一目录读取模型；MiniMax H3 作为其中一个可选视频模型，能够显示、配置、提交异步任务并保存生成结果。

## 用户可见结果

1. 用户在剧本生成页的“视频模型”下拉中可以看到“MiniMax H3 多图生视频”。
2. 用户在批量工厂的视频模型设置中可以看到同一个 H3，模型名称、时长能力和可用状态保持一致。
3. 选择 H3 后，界面会说明它需要参考图片，支持的时长上限为 15 秒，并显示相应分辨率选项。
4. 未配置 H3 Token、缺少参考图片、提交失败、排队中、生成中、成功和失败，均有明确的中文状态和下一步操作提示。
5. 生成成功后，视频进入现有结果列表/任务状态链路，用户可以预览或下载；Token 不出现在浏览器、前端构建产物、日志或错误提示中。

## 当前代码事实

- 批量工厂已有视频模型目录过滤：`kind === 'video'`，并通过视频模型 ID、版本、名称和最大时长锁定生产方案。
- v11 后端已有 provider 配置、异步任务、provider task id、轮询和 media URL 保存抽象。
- 当前个人视频 HTTP 适配器发送通用 `model/prompt/duration/aspectRatio/resolution` 请求，并以 `{id}` 模板轮询。
- 剧本页 `frontend/src/user/pages/ScriptPage.jsx` 的视频模型选项目前包含固定的 YD2 和本地豆包执行器，不能直接作为模型目录使用。
- 剧本页视频请求由 `routes/script-video.js` 处理，本地豆包执行器有专用分支；不能把 H3 伪装成本地执行器。
- AutoDL H3 使用两个接口：
  - `POST /api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_v5_15s`
  - `GET /api/v1/comfyui/comfyui_workflow/result/{task_id}`
- H3 提交后返回 `data.task_id`，状态可能为 `QUEUED`、`RUNNING`、`SUCCESS` 或 `FAILED`；成功结果在 `data.results` 中返回短时有效的资源地址，服务端必须尽快下载或持久化。
- H3 是多图参考生成视频工作流，不应被当成无参考图的纯文生视频模型。

## 推荐架构

### 1. 一个规范化视频模型目录

在 v88 服务端定义规范化视频模型记录，至少包含：

- `id`：稳定的内部模型 ID，不使用页面显示名称作为主键。
- `name`：用户可见名称，例如 `MiniMax H3 多图生视频`。
- `kind: video`。
- `provider`：例如 `autodl_comfyui`、现有个人 API 或 `doubao_local_executor`。
- `model`：对 H3 使用工作流 ID `minimax_h3_lightx2v_v5_15s`。
- `maxVideoDuration: 15`。
- `requiresReferenceImages: true`。
- `supportedResolutions` 与 `supportedAspectRatios`。
- `configured`、`enabled` 和面向当前账号的可用状态。

目录只对前端返回脱敏信息。API Token、完整请求地址中的鉴权信息和服务端凭据不返回。

### 2. provider 适配器负责差异

保留现有通用视频生产接口，但为 H3 增加单独的 AutoDL ComfyUI 适配器。适配器负责：

- 把统一的最终 prompt、时长、分辨率和参考图转换为 H3 工作流请求体。
- 使用 `Authorization` Token 调用 AutoDL。
- 读取 `data.task_id`，保存为现有 `providerTaskId`。
- 按 H3 的 `data.status` 轮询，不把 `QUEUED`/`RUNNING` 当成失败。
- 在 `SUCCESS` 时提取 `data.results`，尽快下载到受控的结果存储，再交给现有媒体结果链路。
- 将 HTTP 401、403、429、5xx、解析失败、超时、FAILED 分成可识别的错误类型。

H3 不能复用只理解通用 YD 响应字段的逻辑，也不能回退到猜测式 PHP 接口或浏览器 Cookie。

### 3. 两个页面共用目录

- 批量工厂继续使用现有视频模型目录，但目录数据改为包含规范化能力字段。
- 剧本页移除固定的 YD2/H3 选项列表，改为读取同一份脱敏视频模型目录，并按 `kind: video` 过滤。
- 豆包本地执行器仍保留专用的在线状态检查；它作为目录中的一个模型，但执行方式仍由其 provider 适配器负责。
- 选中 H3 时，剧本页把可用的参考图、prompt、duration、resolution 传给服务端；没有参考图时，在提交前给出明确提示，不发送无效任务。
- 批量工厂在导演锁定模型时保存模型 ID 和能力快照，正式生产继续使用已锁定模型，避免任务中途模型能力变化。

## 配置边界

H3 需要服务端配置：

- AutoDL API Base URL，默认使用 `https://autodl.art`。
- H3 workflow ID，默认使用 `minimax_h3_lightx2v_v5_15s`。
- H3 API Token，使用服务端密钥存储或 ECS 环境变量注入。
- H3 最大时长 15 秒和支持分辨率等能力声明。

前端只看到“已配置/未配置”和脱敏模型信息。真实 Token 不写入 Git、Obsidian、任务报告、前端 localStorage、浏览器请求体以外的日志或错误文本。

## 数据流

```text
页面读取统一视频模型目录
        ↓
用户选择 MiniMax H3
        ↓
页面提交统一视频请求和参考图
        ↓
v88 服务端按 provider 选择 AutoDL H3 适配器
        ↓
POST workflow → 保存 task_id
        ↓
轮询 result/{task_id}
        ↓
下载/持久化短时结果地址
        ↓
现有任务状态、预览和下载界面
```

## 测试与验收

### 自动化测试

- 模型目录合同：H3 为 `kind: video`，名称、workflow ID、15 秒能力和参考图要求正确；前端不得维护第二份 H3 列表。
- 配置合同：Token 缺失时返回脱敏的未配置状态，不返回 Token。
- H3 提交合同：请求方法、路径、Authorization、Content-Type 和 `data.task_id` 解析正确。
- H3 轮询合同：QUEUED/RUNNING/SUCCESS/FAILED 状态映射正确，SUCCESS 缺少资源时失败闭合。
- 安全合同：日志、错误响应和前端状态不包含 Token；外部资源地址必须通过现有安全校验。
- 剧本页合同：H3 出现在同一目录下；没有参考图时显示可操作提示。
- 批量工厂合同：H3 可被选择、锁定并传递到正式生产任务。

### 用户验收

1. 本地打开剧本页，视频模型下拉能看到 H3。
2. 本地打开批量工厂，视频模型设置能看到同一个 H3。
3. 未填写 Token 时选择 H3，页面明确显示“未配置”，不产生远程任务。
4. 配置 Token 并提供参考图后提交一条测试视频，看到“已提交/排队中/生成中/成功”状态变化。
5. 成功结果可预览和下载，失败时可看到具体原因。
6. 本地验收通过后，再在目标 v88 公网环境进行同样验收；不以单元测试、健康检查或 401 作为真实视频成功证据。

## 发布与回滚

- 只在 v88 开发工作树实现，先按小任务提交，再由总控制审核后合入 v88。
- 不修改 master，不接管或停止旧 V78 容器。
- 本地构建和页面验收通过后，才生成目标 v88 发布包。
- 公网发布前确认目标 Node、Go API、模型配置和结果存储均来自同一个 v88 版本。
- H3 发布失败时，只回滚 H3 相关 v88 提交和配置；现有 YD2、豆包和旧 V78 不受影响。

## 非目标

- 本次不重写批量工厂，不重写所有现有视频适配器。
- 本次不把 H3 Token 暴露给浏览器，也不要求用户学习 API 调用。
- 本次不保证 H3 在没有参考图时具备纯文生视频能力；页面必须按真实能力提示用户。
- 本次不同时改小说获取登录链路；小说获取仍由原固定员工并行处理。
