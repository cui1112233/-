# 水货生产真实生成闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复文本模型调用并补齐资产候选采纳、提示词生成和生产向导，使一战晟铭水货生产可真实完成原文到图片与 Vidu 图生视频。

**Architecture:** Go 服务继续负责模型凭据、提示词版本快照、候选生成、用户所有权和 Redis 队列；React 通过签名网关呈现向导和人工确认节点。文本分析统一经过一个 OpenAI 兼容或 prompt JSON 适配器，AI 只产生候选，资产绑定与提示词覆盖均需用户明确应用。

**Tech Stack:** Go 1.23、chi、MySQL、Redis、React 18、Ant Design、Vite 5、OpenAI-compatible text API、即梦图片、Vidu 图生视频。

## Global Constraints

- 使用真实文本、图片和 Vidu 视频模型进行短样本验收，真实调用可能产生费用。
- 浏览器不得发送或收到模型密钥、模型端点、数据库连接、Redis 凭据、对象存储凭据或服务器绝对路径。
- OpenAI 兼容文本端点按 `/chat/completions` 和 `model + messages` 调用；内部 `prompt_json` 模型继续使用 `{ "prompt": "..." }`。
- 所有 AI 文本结果必须先返回候选；资产、分镜绑定和提示词修改只能由用户确认后写入。
- 继续使用 `prompt_definitions`、`prompt_versions` 和 `shuihuo_prompt_snapshots`，不能把默认提示词写死在 HTTP 处理器。
- Go 变更运行 `go test ./...`；前端变更运行 `npm run frontend:build`；真实调用验证不得输出密钥或完整 Authorization 头。
- 本计划到真实图片和真实 Vidu 图生视频完成为止；ZIP、视频合并和剪映草稿导出另立计划。

---

## 文件结构

- Modify: `backend/internal/shuihuo/models/definition.go` or the existing model-definition source — 显式表达文本协议、模型名和安全参数。
- Modify: `backend/internal/shuihuo/providers/text_completion.go` — OpenAI chat 与 prompt JSON 请求构造、响应解析和脱敏错误。
- Modify: `backend/internal/shuihuo/providers/text_completion_test.go` — HTTP 测试服务器验证路径、载荷、响应与错误。
- Modify: `backend/internal/storage/migrations.go` — 扩展默认提示词种子。
- Modify: `backend/internal/httpapi/shuihuo_analysis_handlers.go` — 资产采纳、资产匹配、图片/视频提示词候选与应用路由。
- Create: `backend/internal/httpapi/shuihuo_prompt_generation_handlers.go` — 生成和应用提示词的专用请求/响应处理器。
- Modify: `backend/internal/shuihuo/store/assets.go` and `segments.go` — 批量安全写入资产绑定、未锁定提示词。
- Modify: `backend/internal/httpapi/router.go` — 注册候选和应用路由。
- Create: `backend/internal/httpapi/shuihuo_prompt_generation_handlers_test.go` — 所有权、锁定提示词、候选和采纳测试。
- Modify: `frontend/src/shared/api/shuihuoProduction.js` — 新增候选/应用 API 函数。
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx` — 候选卡、编辑、选择和采纳。
- Create: `frontend/src/user/pages/shuihuo/ProductionGuide.jsx` — 七步流程、依赖状态和下一步动作。
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx` — 工作台和向导切换、批量提示词操作。
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx` — 默认显示向导并装配数据。
- Modify: `frontend/src/user/pages/shuihuo-production.css` — 使用现有主题 token 的向导和候选布局。

### Task 1: OpenAI 兼容文本模型适配

**Files:**
- Modify: `backend/internal/shuihuo/providers/text_completion.go`
- Modify: `backend/internal/shuihuo/providers/text_completion_test.go`
- Modify: existing model-definition source containing `models.Definition`

**Interfaces:**
- Produces `TextCompletion.Complete(ctx, model, renderedPrompt) (string, error)`。
- `models.Definition` exposes server-managed text protocol and upstream model name; no client-provided endpoint/model/credential fields.
- `openai_chat` POSTs `/chat/completions` with `model`, `messages`, `temperature: 0.2`; `prompt_json` preserves `{prompt}`.

- [ ] **Step 1: 写失败的 OpenAI chat 测试**

用 `httptest.NewServer` 配置模型 endpoint 为 server URL + `/v1/`，调用 `Complete` 并断言：请求路径是 `/v1/chat/completions`，Authorization 为 Bearer 但测试日志不打印 token，JSON 的 `model` 为模型定义值、`messages[0].content` 为渲染提示词、`temperature` 为 `0.2`；响应 `{"choices":[{"message":{"content":"[]"}}]}` 返回 `[]`。

- [ ] **Step 2: 运行测试确认失败**

Run: `go test ./internal/shuihuo/providers -run TestTextCompletionOpenAIChat -v`

Expected: FAIL，因为当前请求直接发送到 `/v1/`，且正文没有 `messages`。

- [ ] **Step 3: 写最小协议实现**

实现 `openAIChatEndpoint(raw string) (*url.URL, error)`，仅当 endpoint path 不以 `/chat/completions` 结束时追加该段；实现：

```go
type openAIChatRequest struct {
    Model string `json:"model"`
    Messages []struct { Role string `json:"role"`; Content string `json:"content"` } `json:"messages"`
    Temperature float64 `json:"temperature"`
}
```

协议取值只允许 `openai_chat` 或 `prompt_json`；空协议向后兼容为 `openai_chat`。`openai_chat` 模型名为空时返回 `text model upstream name is required`。HTTP 非 2xx 错误仅保留状态码和最多 180 个字符的去换行错误类别，不返回原始 URL、token 或完整正文。

- [ ] **Step 4: 补充失败响应和 prompt JSON 回归测试**

增加测试：OpenAI 401 响应映射为包含 `HTTP 401` 的错误且不包含 token；`prompt_json` 路径保持模型 endpoint 且请求仅含 `prompt`。

- [ ] **Step 5: 验证测试**

Run: `go test ./internal/shuihuo/providers -run TestTextCompletion -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/internal/shuihuo/models backend/internal/shuihuo/providers/text_completion.go backend/internal/shuihuo/providers/text_completion_test.go
git commit -m "fix: support OpenAI compatible text models"
```

### Task 2: 默认提示词预设与文本候选路由

**Files:**
- Modify: `backend/internal/storage/migrations.go`
- Modify: `backend/internal/httpapi/shuihuo_analysis_handlers.go`
- Create: `backend/internal/httpapi/shuihuo_prompt_generation_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Create: `backend/internal/httpapi/shuihuo_prompt_generation_handlers_test.go`

**Interfaces:**
- Produces purpose presets `storyboard`, `asset_match`, `image_prompt`, `video_prompt` under module `shuihuo-production`.
- Produces candidate routes: `POST /projects/{id}/assets/candidates/apply`, `POST /projects/{id}/prompt-candidates/image`, `POST /projects/{id}/prompt-candidates/video`, `PUT /projects/{id}/prompt-candidates/{kind}/apply`.
- Candidate requests include only `modelId`; application body includes validated candidate payloads.

- [ ] **Step 1: 写失败的候选应用路由测试**

测试当前用户向自己的项目提交两项资产候选后得到 201 和两个项目资产；另一个用户对该项目提交得到 404；传入 `category: "invalid"` 或空名称返回 400。测试应用图片提示词时未锁定分镜更新，`imagePromptLocked=true` 的分镜保持原值并在结果标记 skipped。

- [ ] **Step 2: 运行测试确认失败**

Run: `go test ./internal/httpapi -run 'TestShuihuo(ApplyAssetCandidates|ApplyImagePromptCandidates)' -v`

Expected: FAIL，因为新路由不存在。

- [ ] **Step 3: 增加版本化默认提示词**

在新迁移版本的 seed 中添加四个预设，并使用正确参数 JSON：

- `storyboard`: `novel_text`
- `asset_match`: `segment_text`, `project_note`
- `image_prompt`: `segment_text`, `project_note`
- `video_prompt`: `segment_text`, `project_note`

每个 body 明确要求只输出 JSON 数组，且符合规格文件中的字段。只为不存在版本的定义新增 v1，不覆盖用户/管理员已有版本。

- [ ] **Step 4: 实现资产采纳**

定义 `assetCandidateApplyRequest{Candidates []providers.AssetCandidate}`。限制 1–50 项，复用 `providers.ParseAssetCandidates` 验证。写入 `shuihuo_assets`，全部记录 `source: "ai_candidate"`、`manuallyEdited: false`，并只对项目拥有者生效。响应 `{ "created": [...] }`。

- [ ] **Step 5: 实现提示词候选和应用**

对项目的已确认分镜组装 `segment_text` 和 `project_note`，调用 `prompts.NewService(... purpose ...)` 与 `TextCompletion.Complete`，解析 `[{"segmentId": number, "prompt": string}]`。校验所有 segment ID 属于项目且 prompt 非空。应用时图片或视频只更新没有锁定的分镜，响应 `{ "appliedSegmentIds": [...], "skippedLockedSegmentIds": [...] }`。

- [ ] **Step 6: 验证路由测试**

Run: `go test ./internal/httpapi -run 'TestShuihuo(ApplyAssetCandidates|ApplyImagePromptCandidates)' -v`

Expected: PASS。

Run: `go test ./internal/shuihuo/prompts ./internal/shuihuo/providers -v`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add backend/internal/storage/migrations.go backend/internal/httpapi/shuihuo_analysis_handlers.go backend/internal/httpapi/shuihuo_prompt_generation_handlers.go backend/internal/httpapi/shuihuo_prompt_generation_handlers_test.go backend/internal/httpapi/router.go backend/internal/shuihuo/store
git commit -m "feat: add water-goods AI candidate workflows"
```

### Task 3: 资产候选审阅与采纳界面

**Files:**
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Interfaces:**
- Consumes `analyzeAssets(projectId, {modelId})` and `applyAssetCandidates(projectId, {candidates})`.
- Produces editable candidate rows with `category`, `name`, `prompt`, `selected` local state.

- [ ] **Step 1: 写失败的候选过滤纯函数测试**

如果项目已有 Vitest，添加测试覆盖：空名称候选不会包含在 `selectedCandidates`；未选中候选不会包含；有效人物、场景、道具按用户编辑后的字段返回。如果没有前端测试运行器，导出：

```js
export function selectedAssetCandidates(candidates) {
  return candidates.filter(item => item.selected && item.name.trim() && item.prompt.trim());
}
```

在 Task 6 浏览器验收中验证该函数对应交互。

- [ ] **Step 2: 添加 API 封装**

```js
export function applyAssetCandidates(projectId, candidates) {
  return apiRequest(`${base}/projects/${projectId}/assets/candidates/apply`, {
    method: 'POST', body: JSON.stringify({ candidates })
  });
}
```

- [ ] **Step 3: 在资产分析弹窗渲染候选**

生成候选后，显示类型 Select、名称 Input、视觉提示词 TextArea、Checkbox。提供“全选”“全部采纳”“采纳已选”，没有候选时显示模型输出为空的说明。提交成功后清空已采纳候选、刷新资产列表，未采纳候选仍保留以供继续编辑。

- [ ] **Step 4: 构建验证**

Run: `npm run frontend:build`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/shuihuo/AssetsView.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: review and apply asset candidates"
```

### Task 4: 图片和视频提示词候选界面

**Files:**
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Create: `frontend/src/user/pages/shuihuo/PromptCandidatesModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Interfaces:**
- Consumes `generatePromptCandidates(projectId, kind, {modelId})` and `applyPromptCandidates(projectId, kind, {candidates})`.
- `kind` only `image` or `video`.
- Produces modal with model selection, generated candidates, editable prompt fields, and application summary.

- [ ] **Step 1: 添加 API 封装**

```js
export function generatePromptCandidates(projectId, kind, payload) {
  return apiRequest(`${base}/projects/${projectId}/prompt-candidates/${kind}`, { method: 'POST', body: JSON.stringify(payload) });
}
export function applyPromptCandidates(projectId, kind, candidates) {
  return apiRequest(`${base}/projects/${projectId}/prompt-candidates/${kind}/apply`, { method: 'PUT', body: JSON.stringify({ candidates }) });
}
```

- [ ] **Step 2: 实现候选模态框**

打开时读取文本模型；用户选择模型后点击“生成候选”；每项显示分镜序号、原文摘要、可编辑 TextArea 和是否应用 Checkbox。点击“应用已选”调用应用 API，并显示未应用锁定分镜的编号。不得将空 prompt 提交。

- [ ] **Step 3: 接入工作台**

在编辑器工具栏增加“批量生成图片提示词”和“批量生成视频提示词”。未确认分镜、无文本模型或文本服务未 ready 时禁用并说明原因。应用成功调用 `onRefresh()`，使六列卡片即时显示新提示词。

- [ ] **Step 4: 构建验证**

Run: `npm run frontend:build`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/shuihuo/PromptCandidatesModal.jsx frontend/src/user/pages/shuihuo/StudioView.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: generate storyboard media prompts"
```

### Task 5: 七步生产向导

**Files:**
- Create: `frontend/src/user/pages/shuihuo/ProductionGuide.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Interfaces:**
- `ProductionGuide({ data, readiness, onOpenStudio, onOpenAssets, onOpenTasks })` computes step completion from `data.project`, `data.segments`, `data.assets`, and `data.media`.
- Step completion: confirmed segments; at least one asset; every confirmed segment has at least one bound asset; every confirmed segment has image prompt and an image; every confirmed segment has video prompt and a video; export remains future/disabled.

- [ ] **Step 1: 写失败的步骤状态纯函数测试**

导出 `getProductionSteps(data)`，测试未确认项目停在“分镜”；确认分镜且无资产停在“资产候选”；有资产无绑定停在“资产绑定”；每段有图片提示词但无图片停在图片步骤；视频主图不足时视频步骤返回“请先选择主图片”。

- [ ] **Step 2: 实现向导组件**

每步卡片显示标题、完成/待处理状态、依赖说明和单一主操作。主操作分别为：进入工作台分段、打开资产页、进入工作台绑定资产、打开图片提示词候选、打开任务中心生成图片、打开视频提示词候选、打开任务中心生成视频。导出步骤显示“将在视频全部完成后开放”。

- [ ] **Step 3: 设为默认项目入口**

项目打开后默认 `view='guide'`；提供“高级编辑”进入 `StudioView`，工作台顶部提供“返回生产向导”。所有动作复用已有页面状态和弹窗，不复制项目数据。

- [ ] **Step 4: 构建验证**

Run: `npm run frontend:build`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/user/pages/shuihuo/ProductionGuide.jsx frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo/StudioView.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: guide users through water-goods production"
```

### Task 6: 真实短样本端到端验证

**Files:**
- Test: existing Go route/provider tests.
- No production source changes unless verification identifies a reproducible defect; any defect must first receive a failing test.

**Interfaces:**
- Validates Task 1–5 through `http://127.0.0.1:3000/api/shuihuo-production/*` with existing login/bridge behavior.

- [ ] **Step 1: 运行自动化验证**

Run: `go test ./internal/shuihuo/providers ./internal/shuihuo/prompts ./internal/httpapi -v`

Expected: PASS。

Run: `npm run frontend:build`

Expected: PASS。

- [ ] **Step 2: 验证服务健康**

登录后请求 `GET /api/shuihuo-production/health`。

Expected: HTTP 200，database、redis、storage、text、image、video 都是 ready。

- [ ] **Step 3: 建立短样本并真实验证文本模型**

创建仅 2–3 段的测试项目，调用智能分段并确认。调用资产分析，确认返回至少一个格式正确候选；采纳一项并确认其出现在项目资产中。调用图片提示词候选和视频提示词候选，应用至少一个未锁定分镜提示词。

- [ ] **Step 4: 真实验证图片和 Vidu 视频**

选择现有启用图片模型，对一个已确认且有图片提示词的分镜提交图片任务，轮询到 succeeded，确认生成媒体存在。将该图片设为主图。选择 Vidu 视频模型、写入视频提示词、提交视频任务，轮询到 succeeded，确认生成视频媒体存在并可经受鉴权下载端点读取。

- [ ] **Step 5: 检查失败路径与安全**

尝试对无主图分镜提交视频任务，应得到“请先为该分段选择主图片”。确认浏览器网络响应、任务错误和终端日志不包含模型 token、DSN、Redis 密码或对象存储密钥。

- [ ] **Step 6: 提交修复（如有）**

若步骤 1–5 发现并修复实际问题：

```bash
git add backend frontend
git commit -m "fix: complete real water-goods generation flow"
```

## 计划自检

- 文本模型兼容、候选采纳、四类缺失提示词、生产向导、真实文本/图片/Vidu 验收分别由 Task 1–6 覆盖。
- 本计划未把 ZIP、视频合并和剪映草稿导出伪装为已完成，符合规格的导出边界。
- 所有写入 API 都要求当前项目所有权，候选先审阅再写入，锁定提示词不被批量覆盖。
- 没有把密钥或服务器敏感配置暴露给浏览器。