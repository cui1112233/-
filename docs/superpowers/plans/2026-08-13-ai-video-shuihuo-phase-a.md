# ai-video 水货功能迁移：阶段 A 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在一战晟铭水货生产模块中，完成 ai-video 同款项目列表、列式分镜编辑器、素材操作与角色/提示词配置的数据基础，且保持一战晟铭视觉主题。

**Architecture:** 前端扩展现有 React 水货页面与 API 封装，继续通过 Node 签名网关访问 Go 服务。Go 服务沿用现有项目、分段、资产、媒体与对象存储结构，只补充用户级配置、资产模板与项目文件所需的领域数据、存储仓库与鉴权路由；这一阶段不提交真实 AI 生成或导出任务。

**Tech Stack:** React 18、Ant Design、Vite 5、Node Express 签名网关、Go 1.23、chi、MySQL、Redis、Local/TOS/MinIO 对象存储。

## Global Constraints

- 复刻 ai-video 的功能与操作流程，不能直接嵌入 Vue 或 Python 页面。
- 使用一战晟铭现有主题、侧栏、登录 token、Node 签名网关和 Go 用户所有权校验。
- 任何 API Key、数据库密码、对象存储密钥不得进入 React、Node 浏览器响应、公开模型字段或日志。
- 长耗时 AI 与导出任务不属于本阶段；按钮必须显示“下一阶段接入”而不是伪造成功。
- Go 变更必须通过 `go test ./...`；前端变更必须通过 `npm --prefix frontend run build`；Node 网关变更必须通过 `npm test`（若仓库无 test 脚本则运行已有相关 Node 测试文件）。
- 不新增代码注释，除非所在文件已有同类必要注释且改动要求说明。

---

## 文件结构

### 后端

- Modify: `backend/internal/shuihuo/domain/types.go` — 增加 `UserProductionConfig`、`AssetType`/`AssetTemplate` 公共 JSON 字段与项目文件元数据类型。
- Create: `backend/internal/shuihuo/store/configs.go` — 用户级生产默认配置的 MySQL 读写。
- Create: `backend/internal/shuihuo/store/templates.go` — 资产类型和资产模板的用户隔离 CRUD。
- Modify: `backend/internal/shuihuo/store/projects.go` — 获取项目文件/媒体总览所需查询。
- Modify: `backend/internal/storage/migrations.go` — 迁移用户生产配置及模板参考图字段。
- Create: `backend/internal/httpapi/shuihuo_config_handlers.go` — 默认配置、资产类型、资产模板、文件清单路由处理器。
- Modify: `backend/internal/httpapi/router.go` — 注册新增签名认证路由。
- Create: `backend/internal/httpapi/shuihuo_config_handlers_test.go` — 配置、模板、所有权行为的路由测试。

### 前端

- Modify: `frontend/src/shared/api/shuihuoProduction.js` — 新增配置、资产类型/模板、文件清单 API 封装。
- Modify: `frontend/src/user/pages/shuihuo/ProjectsView.jsx` — ai-video 式项目卡片、搜索、查看文件入口。
- Create: `frontend/src/user/pages/shuihuo/ProjectFilesModal.jsx` — 项目文件和媒体清单、下载入口。
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx` — ai-video 同款工具栏及阶段 A 可用操作入口。
- Modify: `frontend/src/user/pages/shuihuo/SegmentProductionCard.jsx` — 六列分镜卡片的单段上传、编辑、主图、预览、下载和删除入口。
- Create: `frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx` — 默认提示词前后缀与已选模型展示/保存。
- Create: `frontend/src/user/pages/shuihuo/TemplateLibraryModal.jsx` — 角色类型与模板 CRUD、模板图片上传与分段绑定。
- Modify: `frontend/src/user/pages/shuihuo-production.css` — 使用既有 CSS token 完成项目卡片、列式编辑器、工具栏和模态框布局。
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx` — 组合入口、加载配置、文件和模板模态框状态。

---

### Task 1: 用户生产默认配置的数据库与 API

**Files:**
- Modify: `backend/internal/shuihuo/domain/types.go`
- Modify: `backend/internal/storage/migrations.go`
- Create: `backend/internal/shuihuo/store/configs.go`
- Create: `backend/internal/httpapi/shuihuo_config_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Create: `backend/internal/httpapi/shuihuo_config_handlers_test.go`

**Interfaces:**
- Produces `domain.UserProductionConfig`：`UserID int64`、`CharacterPrefix string`、`ImagePrefix string`、`ImageSuffix string`、`VideoPrefix string`、`VideoSuffix string`、`TextModelID *int64`、`ImageModelID *int64`、`VideoModelID *int64`、`JianyingDraftDirectory string`。
- Produces `store.NewProductionConfigs(db *sql.DB) *ProductionConfigs`，包含 `Get(ctx context.Context, userID int64) (domain.UserProductionConfig, error)` 与 `Save(ctx context.Context, config domain.UserProductionConfig) (domain.UserProductionConfig, error)`。
- Produces `GET /api/shuihuo-production/config` 和 `PUT /api/shuihuo-production/config`。

- [ ] **Step 1: 写出失败的路由测试**

在 `shuihuo_config_handlers_test.go` 添加测试，使用已存在的 API/router 测试构造方式，覆盖：未登录被拒绝；新用户 GET 返回默认空配置；PUT 后 GET 返回保存的前后缀、模型 ID 与剪映目录；用户 A 保存的配置不被用户 B 获取。

```go
func TestShuihuoProductionConfigIsScopedToCurrentUser(t *testing.T) {
    api, signedRequest := newShuihuoTestAPI(t)
    save := signedRequest(http.MethodPut, "/api/shuihuo-production/config", userA, map[string]any{
        "imagePrefix": "电影级画面，",
        "imageSuffix": "，高清细节",
        "textModelId": 1,
    })
    require.Equal(t, http.StatusOK, save.Code)

    other := signedRequest(http.MethodGet, "/api/shuihuo-production/config", userB, nil)
    require.Equal(t, http.StatusOK, other.Code)
    require.Empty(t, decodeJSON(t, other).Get("imagePrefix"))
}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `C:\PROGRA~1\Go\bin\go.exe test ./internal/httpapi -run TestShuihuoProductionConfigIsScopedToCurrentUser -v`

Expected: FAIL，因为路由和配置存储尚未定义。

- [ ] **Step 3: 添加迁移和领域类型**

在迁移中加入 `shuihuo_user_configs` 表：`user_id` 为主键和 `users(id)` 外键；存储五个提示词字段、三个 nullable 模型 ID 和 `jianying_draft_directory`。所有文本列使用 `MEDIUMTEXT NOT NULL DEFAULT ''`，模型 ID 使用 `BIGINT NULL`。

在 `types.go` 添加：

```go
type UserProductionConfig struct {
    UserID                int64  `json:"-"`
    CharacterPrefix       string `json:"characterPrefix"`
    ImagePrefix           string `json:"imagePrefix"`
    ImageSuffix           string `json:"imageSuffix"`
    VideoPrefix           string `json:"videoPrefix"`
    VideoSuffix           string `json:"videoSuffix"`
    TextModelID           *int64 `json:"textModelId"`
    ImageModelID          *int64 `json:"imageModelId"`
    VideoModelID          *int64 `json:"videoModelId"`
    JianyingDraftDirectory string `json:"jianyingDraftDirectory"`
}
```

- [ ] **Step 4: 实现存储仓库和 HTTP 处理器**

`GET` 调用当前签名用户的 `Get`；没有记录时返回 `{}` 的零值配置和 HTTP 200。`PUT` 仅接收上述 JSON 字段，强制把 `UserID` 写成当前用户 ID，调用 `Save` 使用 `INSERT ... ON DUPLICATE KEY UPDATE`。不要接收任意文件路径以外的服务器参数；剪映目录只保存为未来受控导出设置，不在本阶段执行写文件操作。

路由注册模式必须与既有 `/api/shuihuo-production/*` 路由相同，受平台认证和桥接签名保护。

- [ ] **Step 5: 运行定向和全部 Go 测试**

Run: `C:\PROGRA~1\Go\bin\go.exe test ./internal/httpapi -run TestShuihuoProductionConfigIsScopedToCurrentUser -v`

Expected: PASS。

Run: `C:\PROGRA~1\Go\bin\go.exe test ./...`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/internal/shuihuo/domain/types.go backend/internal/shuihuo/store/configs.go backend/internal/storage/migrations.go backend/internal/httpapi/shuihuo_config_handlers.go backend/internal/httpapi/shuihuo_config_handlers_test.go backend/internal/httpapi/router.go
git commit -m "feat: add user water-goods production config"
```

### Task 2: 角色类型和角色模板 API

**Files:**
- Modify: `backend/internal/shuihuo/domain/types.go`
- Modify: `backend/internal/storage/migrations.go`
- Create: `backend/internal/shuihuo/store/templates.go`
- Modify: `backend/internal/httpapi/shuihuo_config_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/shuihuo_config_handlers_test.go`

**Interfaces:**
- Produces `domain.AssetType` JSON fields `id`、`name`、`category` and `domain.AssetTemplate` JSON fields `id`、`assetTypeId`、`name`、`prompt`、`referenceObjectKey`、`source`。
- Produces REST endpoints: `GET|POST /api/shuihuo-production/asset-types`、`PUT|DELETE /api/shuihuo-production/asset-types/{id}`、`GET|POST /api/shuihuo-production/asset-templates`、`PUT|DELETE /api/shuihuo-production/asset-templates/{id}`。
- Consumed by Task 6 template library and Task 7 segment bindings.

- [ ] **Step 1: 写出失败的类型/模板测试**

覆盖：当前用户只能读取自己的类型/模板以及系统类型；创建类型、创建模板、更新模板、删除模板；以另一个用户身份更新或删除时返回 404；模板的 `asset_type_id` 必须属于当前用户或系统类型。

```go
func TestShuihuoAssetTemplatesAreOwnerScoped(t *testing.T) {
    api, signedRequest := newShuihuoTestAPI(t)
    created := signedRequest(http.MethodPost, "/api/shuihuo-production/asset-templates", userA, map[string]any{
        "assetTypeId": userACharacterTypeID,
        "name": "林晚",
        "prompt": "年轻女性，黑色长发",
    })
    require.Equal(t, http.StatusCreated, created.Code)

    denied := signedRequest(http.MethodDelete, "/api/shuihuo-production/asset-templates/"+templateID, userB, nil)
    require.Equal(t, http.StatusNotFound, denied.Code)
}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `C:\PROGRA~1\Go\bin\go.exe test ./internal/httpapi -run TestShuihuoAssetTemplatesAreOwnerScoped -v`

Expected: FAIL，因为模板端点尚未实现。

- [ ] **Step 3: 扩展迁移与领域类型**

为 `shuihuo_asset_templates` 新增 `reference_object_key VARCHAR(1024) NOT NULL DEFAULT ''`，使用可重复执行的迁移方式。给 `AssetType` 和 `AssetTemplate` 公开字段补齐 JSON tag，禁止在响应中暴露 `UserID`。

- [ ] **Step 4: 实现模板仓库**

实现 `AssetTypes` 与 `AssetTemplates` 仓库，方法必须包含：

```go
ListTypes(ctx context.Context, userID int64) ([]domain.AssetType, error)
CreateType(ctx context.Context, userID int64, name, category string) (domain.AssetType, error)
UpdateType(ctx context.Context, userID, id int64, name, category string) (domain.AssetType, error)
DeleteType(ctx context.Context, userID, id int64) error
ListTemplates(ctx context.Context, userID int64, assetTypeID *int64) ([]domain.AssetTemplate, error)
CreateTemplate(ctx context.Context, userID int64, input domain.AssetTemplate) (domain.AssetTemplate, error)
UpdateTemplate(ctx context.Context, userID, id int64, input domain.AssetTemplate) (domain.AssetTemplate, error)
DeleteTemplate(ctx context.Context, userID, id int64) error
```

更新与删除 SQL 必须包含 `user_id = ?`。对于系统类型（`user_id IS NULL`）允许读取但不允许用户更新或删除。

- [ ] **Step 5: 实现并注册 HTTP 处理器**

处理器校验名称非空、`category` 只能是 `character`、`scene` 或 `prop`。模板创建/更新前验证所属类型可由当前用户读取。不存在或非本人资源统一返回 404，防止跨用户资源枚举。

- [ ] **Step 6: 运行全部 Go 测试**

Run: `C:\PROGRA~1\Go\bin\go.exe test ./...`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add backend/internal/shuihuo/domain/types.go backend/internal/shuihuo/store/templates.go backend/internal/storage/migrations.go backend/internal/httpapi/shuihuo_config_handlers.go backend/internal/httpapi/shuihuo_config_handlers_test.go backend/internal/httpapi/router.go
git commit -m "feat: add owner-scoped character templates"
```

### Task 3: 项目文件清单与资源上传复用

**Files:**
- Modify: `backend/internal/shuihuo/store/projects.go`
- Modify: `backend/internal/httpapi/shuihuo_production_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/shuihuo_handlers_test.go`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`

**Interfaces:**
- Produces `GET /api/shuihuo-production/projects/{id}/files`，返回 `{ sourceObjectKey, media: []domain.Media }`。
- Reuses existing `POST /projects/{id}/media` and `GET /media/{id}/download` without exposing object storage keys to UI.
- Consumed by Task 4 and Task 5.

- [ ] **Step 1: 写出失败的项目文件清单路由测试**

测试为用户 A 创建项目、原文对象和两个媒体（图片与视频）后，A 能读取自己项目的清单，B 请求相同 URL 返回 404。

```go
func TestListShuihuoProjectFilesRequiresProjectOwnership(t *testing.T) {
    api, signedRequest := newShuihuoTestAPI(t)
    response := signedRequest(http.MethodGet, "/api/shuihuo-production/projects/"+projectID+"/files", userA, nil)
    require.Equal(t, http.StatusOK, response.Code)
    require.Len(t, decodeProjectFiles(t, response).Media, 2)

    denied := signedRequest(http.MethodGet, "/api/shuihuo-production/projects/"+projectID+"/files", userB, nil)
    require.Equal(t, http.StatusNotFound, denied.Code)
}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `C:\PROGRA~1\Go\bin\go.exe test ./internal/httpapi -run TestListShuihuoProjectFilesRequiresProjectOwnership -v`

Expected: FAIL，因为 files 路由不存在。

- [ ] **Step 3: 实现受控文件清单处理器**

使用现有项目仓库验证 `Get(ctx, ownerID, projectID)`；再由已有媒体仓库按项目读取记录。响应只返回客户端需要的媒体元数据和原文是否存在的布尔/文件名显示值，下载仍通过现有受鉴权 `downloadMedia` 端点。不得把本地绝对路径或 TOS URL 写进响应。

- [ ] **Step 4: 添加前端 API 封装**

在 `shuihuoProduction.js` 加：

```js
export function listProjectFiles(projectId) {
  return apiRequest(`${base}/projects/${projectId}/files`);
}
```

不要改动既有媒体上传和下载函数的调用形式。

- [ ] **Step 5: 运行 Go 测试与前端构建**

Run: `C:\PROGRA~1\Go\bin\go.exe test ./...`

Expected: PASS。

Run: `npm --prefix frontend run build`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/internal/shuihuo/store/projects.go backend/internal/httpapi/shuihuo_production_handlers.go backend/internal/httpapi/router.go backend/internal/httpapi/shuihuo_handlers_test.go frontend/src/shared/api/shuihuoProduction.js
git commit -m "feat: add project file inventory"
```

### Task 4: ai-video 式项目列表、搜索和文件入口

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/ProjectsView.jsx`
- Create: `frontend/src/user/pages/shuihuo/ProjectFilesModal.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Interfaces:**
- Consumes `listProjectFiles(projectId)` from Task 3, plus existing `createProject`/`deleteProject`/`getProject` APIs.
- Produces `ProjectsView` props: `projects`, `onCreate`, `onOpen`, `onDelete`, `onFiles`.
- Produces `ProjectFilesModal({ open, project, onClose })`.

- [ ] **Step 1: 写前端交互测试或组件可测试函数**

如果仓库已有 Vitest 测试配置，在同目录新增 `ProjectsView.test.jsx`，断言搜索“长安”时只呈现名称含“长安”的项目，点击“查看文件”会调用 `onFiles(project)`。如果没有 Vitest 配置，不新增测试依赖；提取并导出纯函数：

```js
export function filterProjects(projects, query) {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized ? projects.filter(project => project.name.toLocaleLowerCase().includes(normalized)) : projects;
}
```

并在浏览器手工验收记录中验证该行为。

- [ ] **Step 2: 实现项目卡片和文件模态框**

项目卡片必须包含：项目名、分段状态、更新时间、进入编辑器按钮、查看文件按钮和删除确认。搜索框 placeholder 使用“搜索项目名称…”。

`ProjectFilesModal` 打开时请求 `listProjectFiles(project.id)`，显示原文文件状态和按图片/视频/音频分类的媒体条目；每项下载使用现有 `downloadMedia(media.id)` 并通过 Blob 创建浏览器下载。加载、空清单、请求失败都在模态框内明确显示。

- [ ] **Step 3: 将状态接入水货入口**

在 `ShuihuoProductionPage` 添加当前文件项目状态，传入 `ProjectsView` 的 `onFiles`，并确保关闭或删除当前项目时关闭文件模态框。项目创建后立即刷新列表，删除完成后若删除项为当前工作台项目则回到列表。

- [ ] **Step 4: 补齐主题 CSS**

只使用已有 `shuihuo-*` 类和全局主题 CSS 变量。保持一战晟铭暗色、浅色模式下的文字对比度；卡片和工具栏不得使用 ai-video 的蓝紫渐变或 emoji logo。

- [ ] **Step 5: 构建并手工验收**

Run: `npm --prefix frontend run build`

Expected: PASS。

手工：登录 `http://127.0.0.1:3000`，进入“水货生产”，验证项目搜索、新建、删除确认、打开工作台与查看文件弹窗。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/user/pages/shuihuo/ProjectsView.jsx frontend/src/user/pages/shuihuo/ProjectFilesModal.jsx frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: recreate ai-video project list workflow"
```

### Task 5: 同款列式分镜编辑器与单段媒体操作

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/shuihuo/SegmentProductionCard.jsx`
- Modify: `frontend/src/user/pages/shuihuo/MediaModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Interfaces:**
- Consumes existing `createSegment`、`updateSegment`、`deleteSegment`、`reorderSegments`、`uploadMedia`、`setPrimaryMedia`、`deleteMedia`、`downloadMedia`、`replaceSegmentAssets` APIs.
- Produces six-column card flow: content, roles/assets, image prompt, images, video prompt, videos.
- Does not submit AI generation or export work in this task.

- [ ] **Step 1: 写失败的纯状态更新测试或提取函数**

若没有 JSX 测试框架，在 `SegmentProductionCard.jsx` 导出：

```js
export function splitSegmentMedia(media) {
  return {
    images: media.filter(item => item.kind === 'image'),
    videos: media.filter(item => item.kind === 'video'),
    audio: media.filter(item => item.kind === 'audio')
  };
}
```

并添加现有测试框架可执行的测试，断言图片、视频和音频不混淆。若当前项目无前端测试运行器，保留纯函数并在 Task 8 手工验证。

- [ ] **Step 2: 重构编辑器工具栏**

工具栏按 ai-video 顺序提供：返回作品列表、角色模板、默认配置、查看文件、调整分段、更新角色、批量应用、批量生成图片、批量生成视频、导出剪映草稿、批量下载视频。后五个未实现 AI/导出按钮必须 `disabled` 并有准确 `title`：`下一阶段接入 AI 生产能力` 或 `阶段 C 接入导出能力`；不能显示成功 toast。

- [ ] **Step 3: 完成六列卡片操作**

卡片内容列显示序号、原文、字幕、上移、下移、编辑、删除；角色列显示已绑定资产并打开绑定模态框；两个提示词列可以在编辑分段弹窗内保存；图片列显示多图、预览、下载、删除和设主图；视频列显示视频预览、下载与删除。

媒体上传必须从对应列的“上传图片/上传视频”按钮打开 `MediaModal`，并预设正确 `kind` 和当前 `segmentId`。不允许上传类型与按钮不匹配的文件：图片只接受 `image/*`，视频只接受 `video/*`。

- [ ] **Step 4: 实现媒体预览和浏览器下载**

预览使用 Ant `Modal`，图片使用 `<img>`，视频使用带 controls 的 `<video>`；URL 一律由 `downloadMedia()` 返回 Blob 后创建，模态框关闭时 `URL.revokeObjectURL()`。下载文件名以 `project.name + '-分镜-' + (index + 1)` 为前缀，扩展名由媒体 MIME 类型安全映射；没有可识别 MIME 时使用 `.bin`。

- [ ] **Step 5: 构建和手工验收**

Run: `npm --prefix frontend run build`

Expected: PASS。

手工：创建项目、确认分段、新增一个分段；编辑两个提示词；上传两张图片，设一张为主图；上传视频；预览、下载并删除媒体；上下移动分段，刷新页面确认顺序和数据仍正确。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/user/pages/shuihuo/StudioView.jsx frontend/src/user/pages/shuihuo/SegmentProductionCard.jsx frontend/src/user/pages/shuihuo/MediaModal.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: recreate ai-video storyboard editor workflow"
```

### Task 6: 前端默认配置弹窗

**Files:**
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Create: `frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Interfaces:**
- Consumes `GET|PUT /api/shuihuo-production/config` from Task 1 and existing `listModels()`.
- Produces `ProductionConfigModal({ open, onClose, onSaved })`.

- [ ] **Step 1: 添加 API 客户端函数**

在 `shuihuoProduction.js` 添加：

```js
export function getProductionConfig() { return apiRequest(`${base}/config`); }
export function saveProductionConfig(payload) { return apiRequest(`${base}/config`, { method: 'PUT', body: JSON.stringify(payload) }); }
```

- [ ] **Step 2: 实现配置表单**

弹窗加载配置和可用模型，提供字段：角色前缀、图片前缀、图片后缀、视频前缀、视频后缀、文本模型、图片模型、视频模型、剪映草稿目录。模型下拉仅显示对应 kind；模型空时提供“未选择”。保存时仅发送上述白名单字段。

- [ ] **Step 3: 连接编辑器入口并保留主题**

从工作台“默认配置”按钮打开弹窗；保存成功后关闭、刷新页面内配置，并显示“默认配置已保存”。表单 loading 与请求失败不应清空用户已输入的字段。

- [ ] **Step 4: 构建和手工验收**

Run: `npm --prefix frontend run build`

Expected: PASS。

手工：保存图片前后缀，关闭后再次打开仍显示保存值；换账号后确认看不到前一账号的配置。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx frontend/src/user/pages/shuihuo/StudioView.jsx frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: add water-goods production defaults"
```

### Task 7: 角色模板库与分镜资产绑定

**Files:**
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Create: `frontend/src/user/pages/shuihuo/TemplateLibraryModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Interfaces:**
- Consumes Task 2 type/template endpoints and existing `createAsset`/`replaceSegmentAssets` APIs.
- Produces `TemplateLibraryModal({ open, project, onClose, onTemplateApplied })`.
- Template application creates a project asset from a selected template then binds its returned asset ID through `replaceSegmentAssets(segmentId, assetIds)`.

- [ ] **Step 1: 添加 API 客户端函数**

新增：

```js
export function listAssetTypes() { return apiRequest(`${base}/asset-types`); }
export function createAssetType(payload) { return apiRequest(`${base}/asset-types`, { method: 'POST', body: JSON.stringify(payload) }); }
export function updateAssetType(id, payload) { return apiRequest(`${base}/asset-types/${id}`, { method: 'PUT', body: JSON.stringify(payload) }); }
export function deleteAssetType(id) { return apiRequest(`${base}/asset-types/${id}`, { method: 'DELETE' }); }
export function listAssetTemplates(assetTypeId) { return apiRequest(`${base}/asset-templates${assetTypeId ? `?assetTypeId=${encodeURIComponent(assetTypeId)}` : ''}`); }
export function createAssetTemplate(payload) { return apiRequest(`${base}/asset-templates`, { method: 'POST', body: JSON.stringify(payload) }); }
export function updateAssetTemplate(id, payload) { return apiRequest(`${base}/asset-templates/${id}`, { method: 'PUT', body: JSON.stringify(payload) }); }
export function deleteAssetTemplate(id) { return apiRequest(`${base}/asset-templates/${id}`, { method: 'DELETE' }); }
```

- [ ] **Step 2: 实现模板库**

弹窗包含类型筛选、新建/编辑/删除类型、新建/编辑/删除模板。模板字段是类型、名称、视觉提示词和参考图（参考图上传在本阶段允许复用项目媒体上传后将 `referenceObjectKey` 存入模板；如果对象存储 API 不能安全复用，先禁用模板图上传并显示“阶段 B 接入模板参考图”，不得伪造上传）。

- [ ] **Step 3: 实现从模板创建项目资产并绑定**

在编辑分段的资产绑定弹窗显示当前项目资产和模板库。选择模板时调用 `createAsset(project.id, { assetTypeId, category, name, prompt, source: 'template' })`，刷新项目资产后合并新 ID 到已有绑定，再调用 `replaceSegmentAssets`。如果同一分段已经有名称和类型相同的资产，复用该资产而不是重复创建。

- [ ] **Step 4: 构建和手工验收**

Run: `npm --prefix frontend run build`

Expected: PASS。

手工：创建“主角”类型和“林晚”模板；在分镜资产绑定中应用模板；刷新工作台，确认角色列存在“林晚”；删除模板不删除已创建的项目资产。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/shuihuo/TemplateLibraryModal.jsx frontend/src/user/pages/shuihuo/StudioView.jsx frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: add character template library"
```

### Task 8: 阶段 A 全链路验收与回归

**Files:**
- Modify: `frontend/src/user/pages/shuihuo-production.css` only if verification finds a real responsive or theme contrast defect.
- Test: `backend/internal/httpapi/shuihuo_config_handlers_test.go`
- Test: existing `backend/internal/httpapi/shuihuo_handlers_test.go`

**Interfaces:**
- Verifies all interfaces from Tasks 1–7 through the signed Node gateway.

- [ ] **Step 1: 运行后端测试**

Run: `C:\PROGRA~1\Go\bin\go.exe test ./...`

Expected: PASS。

- [ ] **Step 2: 运行前端构建**

Run: `npm --prefix frontend run build`

Expected: PASS。

- [ ] **Step 3: 验证 Node 网关与 Go 健康状态**

Run: `C:\Redis\redis-cli.exe ping`

Expected: `PONG`。

Run: 使用已登录的一战晟铭账户请求 `GET /api/shuihuo-production/health`。

Expected: HTTP 200，数据库、Redis、存储、text/image/video 模型均为 ready。

- [ ] **Step 4: 执行浏览器端到端验收**

在 `http://127.0.0.1:3000` 登录后完成：

1. 创建带原文的项目，并通过快速分段确认至少两个分镜。
2. 搜索项目并打开“查看文件”。
3. 在默认配置保存图片前后缀并重新打开确认持久化。
4. 创建角色类型和模板，在第一个分镜应用模板。
5. 修改第一段图片和视频提示词。
6. 上传两张图片，将其中一张设为主图；上传一个视频。
7. 预览、下载、删除一项非主图素材；上移/下移一个分镜。
8. 刷新页面，确认项目、分镜顺序、提示词、资产绑定和剩余素材仍存在。
9. 确认批量 AI 与导出按钮被清晰禁用，而不是显示误导性完成状态。

- [ ] **Step 5: 检查安全回归**

确认浏览器 Network 响应和控制台日志中不出现 API Key、MySQL DSN、Redis 地址密码、TOS/MinIO 凭据或服务器绝对路径。确认用户 B 无法读取、修改、删除用户 A 的配置、模板、项目文件或项目媒体。

- [ ] **Step 6: 提交验收修复（如有）**

仅当步骤 1–5 发现并修复实际问题时：

```bash
git add backend frontend
git commit -m "fix: complete phase a water-goods verification"
```

## 计划自检

- 设计文档中“项目与原文、同款列式编辑器、媒体操作、角色模板、默认/项目提示词配置”的阶段 A 范围分别由任务 1–8 覆盖。
- AI 生成、批量任务、ZIP、视频合并和剪映导出明确留在后续阶段，不会用占位成功行为冒充已实现。
- 所有新增后端资源都有当前用户范围过滤；所有浏览器下载均使用已鉴权的 Blob 端点。
- 任务间接口名称与参数保持一致：`UserProductionConfig`、`listProjectFiles`、`listAssetTypes`、`listAssetTemplates`、`replaceSegmentAssets`。
