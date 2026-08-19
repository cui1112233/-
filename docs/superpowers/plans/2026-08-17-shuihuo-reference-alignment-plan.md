# 水货生产参考流程全量对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让水货生产成为参考图所示的全宽漫剧解说工作台，并通过本项目自己的模型、任务、素材和导出服务完成预设、图片、视频、配音和批量生产。

**Architecture:** 继续使用 Go 的 `ProjectReadModel`、`Task`、`Media` 和 Redis 队列。将项目预设扩展为可关联候选图片和音色配置的资产；React 只显示、提交和轮询正式 API，不存放任何供应商密钥、内部提示词或第三方接口。

**Tech Stack:** Go, MySQL, Redis queue, object storage, React 18, Vite, Ant Design, Node test, Go test.

---

## 文件边界

- `frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx`：顶栏、工具栏、范围选择、任务抽屉和分镜表编排。
- `frontend/src/user/pages/shuihuo/StoryboardRow.jsx`：每行的合并、分镜媒体、图片/视频/配音与新增删除入口。
- `frontend/src/user/pages/shuihuo/PresetWorkbenchModal.jsx`：参考图式项目预设大弹窗，负责配置、标签、资产候选与保存。
- `frontend/src/user/pages/shuihuo/AssetsView.jsx`：保留资产卡片、编辑和候选分析，作为预设弹窗的资产区域。
- `frontend/src/shared/api/shuihuoProduction.js`：所有新增 HTTP 调用的唯一前端边界。
- `backend/internal/shuihuo/domain/types.go`：资产生成配置和公开任务数据契约。
- `backend/internal/shuihuo/store/assets.go`、`media.go`、`tasks.go`：项目资产、候选媒体和任务持久化。
- `backend/internal/httpapi/shuihuo_asset_task_handlers.go`：资产生图、音色和翻译任务请求校验。
- `backend/internal/httpapi/router.go`：挂载受平台鉴权保护的新增端点。
- `backend/internal/storage/migrations.go`：资产媒体和音色配置迁移。
- `tests/shuihuo-reference-alignment-contract.test.js`：前端布局、入口和安全边界合同。
- `backend/internal/httpapi/shuihuo_asset_task_handlers_test.go`：请求、权限、模型和任务状态合同。

### Task 1: 固定工作台结构与行级真实操作

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StoryboardRow.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Modify: `tests/shuihuo-reference-alignment-contract.test.js`

- [ ] **Step 1: 写失败的页面合同测试。**

```js
test('reference workbench keeps toolbar order and seven production columns', () => {
  assert.match(workbench, /分镜调整[\s\S]*人物场景预设[\s\S]*引擎配置[\s\S]*AI 推理[\s\S]*批量操作[\s\S]*取消操作[\s\S]*任务\/日志[\s\S]*导出/);
  assert.match(workbench, /\['序号', '字幕', '配音', '预设', '提示词', '片段库', '操作'\]/);
  assert.match(row, /mergeStoryboard/);
  assert.match(row, /splitStoryboard/);
  assert.match(row, /生成视频/);
  assert.match(row, /重新生图/);
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `node --test tests/shuihuo-reference-alignment-contract.test.js`  
Expected: FAIL，因为工具栏顺序或行级音频/主图控制尚未完整约束。

- [ ] **Step 3: 实现布局和行操作。**

保持工具栏顺序；将取消入口连接至 `TaskDrawer` 的运行中任务筛选；在 `StoryboardRow` 显示图片候选、主图标识、音频试听、视频预览。视频提交时提供 `requirePrimaryImage` 默认值，只有用户明确选择文生视频才允许无主图提交。删除使用已有 `deleteSegment`，合并使用 `mergeStoryboard`，不直接在浏览器拼接原文。

- [ ] **Step 4: 运行前端合同和构建。**

Run: `node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-reference-alignment-contract.test.js && npm --prefix frontend run build`  
Expected: PASS。

### Task 2: 建立项目预设媒体与音色配置合同

**Files:**
- Modify: `backend/internal/shuihuo/domain/types.go`
- Modify: `backend/internal/storage/migrations.go`
- Modify: `backend/internal/shuihuo/store/assets.go`
- Create: `backend/internal/shuihuo/store/assets_test.go`

- [ ] **Step 1: 写失败的资产持久化测试。**

```go
func TestAssetGenerationConfigIsProjectScoped(t *testing.T) {
    saved, err := NewAssets(db).SaveGenerationConfig(ctx, ownerID, projectID,
        domain.AssetGenerationConfig{TextModelID: &textID, ImageModelID: &imageID, AspectRatio: "16:9", ThreeView: true})
    if err != nil || !saved.ThreeView || saved.AspectRatio != "16:9" { t.Fatalf("config = %#v, %v", saved, err) }
    _, err = NewAssets(db).GetGenerationConfig(ctx, otherUserID, projectID)
    if !errors.Is(err, sql.ErrNoRows) { t.Fatalf("cross-account read = %v", err) }
}
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `cd backend && go test ./internal/shuihuo/store -run TestAssetGenerationConfigIsProjectScoped -count=1`  
Expected: FAIL，因为 `AssetGenerationConfig` 和存储方法不存在。

- [ ] **Step 3: 添加迁移、类型和存储。**

新增 `shuihuo_asset_generation_configs`，字段为 `project_id`、`user_id`、`text_model_id`、`image_model_id`、`audio_model_id`、`prompt_template_id`、`aspect_ratio`、`style_reference_media_id`、`three_view`、`updated_at`。在 `domain` 定义公开 JSON 类型；存储层所有读写 SQL 均以 `user_id + project_id` 限制。画幅只接受 `16:9`、`9:16`、`1:1`，禁止客户端传 ObjectKey、凭据或供应商地址。

- [ ] **Step 4: 运行存储与迁移测试。**

Run: `cd backend && go test ./internal/shuihuo/store ./internal/storage -count=1`  
Expected: PASS。

### Task 3: 资产生图、AI 音色和翻译任务 API

**Files:**
- Create: `backend/internal/httpapi/shuihuo_asset_task_handlers.go`
- Create: `backend/internal/httpapi/shuihuo_asset_task_handlers_test.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/shuihuo_task_handlers.go`
- Modify: `backend/internal/shuihuo/store/tasks.go`

- [ ] **Step 1: 写失败的 HTTP 合同测试。**

```go
func TestCreateAssetImageTaskRejectsUnconfiguredImageModel(t *testing.T) {
    response := requestAs(t, user, http.MethodPost,
        "/api/shuihuo-production/projects/7/assets/9/tasks/image", `{ "modelId": 12, "threeView": true }`)
    requireStatus(t, response, http.StatusConflict)
    requireJSONContains(t, response, "尚未完成运行配置")
}

func TestCreateAssetAudioTaskNeverReturnsProviderInput(t *testing.T) {
    response := requestAs(t, user, http.MethodPost,
        "/api/shuihuo-production/projects/7/assets/9/tasks/audio", `{ "modelId": 13 }`)
    requireStatus(t, response, http.StatusCreated)
    requireJSONNotContains(t, response, "credential")
    requireJSONNotContains(t, response, "endpoint")
}
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `cd backend && go test ./internal/httpapi -run 'TestCreateAsset(Image|Audio)Task' -count=1`  
Expected: FAIL，路由不存在。

- [ ] **Step 3: 实现资产任务端点。**

新增：

```text
GET/PUT  /api/shuihuo-production/projects/{id}/asset-generation-config
POST     /api/shuihuo-production/projects/{id}/assets/{assetId}/tasks/image
POST     /api/shuihuo-production/projects/{id}/assets/{assetId}/tasks/audio
POST     /api/shuihuo-production/projects/{id}/tasks/translate
```

每个处理器复用 `createShuihuoTask` 的模型启用、所有者、ProviderConfigured、队列和状态校验；仅将资产 ID、明确的画幅/三视图选项和用户可见提示词写入服务器内部 `Task.Input`。公开响应只使用 `domain.ToPublicTask`。工作器成功后把输出媒体创建成所属资产或分镜的候选媒体，不覆盖既有主图。

- [ ] **Step 4: 运行 HTTP 测试。**

Run: `cd backend && go test ./internal/httpapi ./internal/shuihuo/store -count=1 && go vet ./...`  
Expected: PASS。

### Task 4: 实现参考图式预设弹窗

**Files:**
- Create: `frontend/src/user/pages/shuihuo/PresetWorkbenchModal.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Modify: `tests/shuihuo-reference-alignment-contract.test.js`

- [ ] **Step 1: 写失败的预设弹窗合同。**

```js
test('preset modal exposes reference controls without exposing provider secrets', () => {
  for (const label of ['智能预设', '画幅', '风格参考图', '三视图', 'AI 生图', 'AI 音色', 'AI角色', 'AI场景', 'AI道具', 'AI音色', '角色库', '场景库', '音色库']) {
    assert.match(presetModal, new RegExp(label));
  }
  assert.doesNotMatch(presetModal, /credentialRef|endpoint|apiKey|requestTemplate/);
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `node --test tests/shuihuo-reference-alignment-contract.test.js`  
Expected: FAIL，因为 `PresetWorkbenchModal.jsx` 不存在。

- [ ] **Step 3: 实现独立弹窗。**

`PresetWorkbenchModal` 使用 AntD `Modal` 与 `Tabs`，顶部使用模型选择、预设提示词选择、画幅 `Select`、风格图上传、三视图 `Switch`、生图/音色按钮。左区嵌入项目资产卡片；右区使用七个标签，公共库只提供选择，项目资产允许编辑。图片和音色按钮调用 Task 3 的端点，任务成功后调用 `getProject(project.id)` 刷新。`ShuihuoProductionPage` 只负责 `assetsOpen` 和项目快照，不离开分镜表。

- [ ] **Step 4: 运行合同与构建。**

Run: `node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-reference-alignment-contract.test.js && npm --prefix frontend run build`  
Expected: PASS。

### Task 5: 范围化推理、批量控制、导出和回归

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchTaskModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/TaskDrawer.jsx`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Modify: `backend/internal/httpapi/shuihuo_prompt_generation_handlers.go`
- Modify: `backend/internal/httpapi/shuihuo_export_handlers.go`
- Modify: `tests/shuihuo-reference-alignment-contract.test.js`

- [ ] **Step 1: 写失败的范围和导出合同。**

```js
test('batch controls only submit selected confirmed segments and offer translation', () => {
  assert.match(batchModal, /未完成分镜|指定编号范围|翻译/);
  assert.match(batchModal, /segment\.confirmed/);
  assert.match(batchModal, /allowTextToVideo/);
});

test('export keeps confirmed project media only', () => {
  assert.match(exportHandler, /no confirmed storyboards/);
  assert.doesNotMatch(exportHandler, /ObjectKey|Input|Output/);
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `node --test tests/shuihuo-reference-alignment-contract.test.js`  
Expected: FAIL，因为范围和翻译模式尚未接入。

- [ ] **Step 3: 实现范围、批量和任务日志。**

为 AI 推理增加全部、未完成、指定范围过滤；批量操作增加翻译和 `allowTextToVideo` 明确开关。`TaskDrawer` 默认显示项目所有任务，取消按钮仅对 `queued` 和 `running` 可用，重试仅对 `failed` 和 `cancelled` 可用。导出继续调用服务端 ZIP，仅保留确认分镜关联的媒体、SRT 与清单。

- [ ] **Step 4: 运行全量验证。**

Run: `node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-reference-alignment-contract.test.js tests/frontend-api-client.test.mjs && npm --prefix frontend run build && cd backend && go test ./... -count=1 && go vet ./...`  
Expected: PASS。

- [ ] **Step 5: 验证本地服务而不触发真实模型费用。**

Run: `launchctl kickstart -k gui/$(id -u)/com.ming.qiantie`  
Run: `curl -si http://127.0.0.1:3000/shuihuo-production | head -20`  
Expected: HTTP 200，页面加载新构建资源。仅检查健康提示、弹窗与禁用状态；不创建真实图片、视频或音色任务。
