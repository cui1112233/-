# 水货生产 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 qiantie 中交付独立的“水货生产”模块，保留 5175 已确认生产台布局，并以 Go、React、MySQL、Redis 和可替换对象存储完整实现 ai-video 的项目、资产、分段、图片、视频、配音和导出工作流。

**Architecture:** 现有 Go 服务新增 `internal/shuihuo` 领域模块和 `/api/shuihuo-production/*` 受鉴权接口；所有业务记录以项目所属用户隔离。模型与对象存储只经服务端适配器调用：模型目录与真实 prompt 均不可下发浏览器，存储实现由环境配置在本地文件、TOS、MinIO 间切换。React 的水货生产页面复用 `/Users/ming/Documents/小说前贴/frontend/src` 中确认过的 5175 布局结构，而不再使用 iframe 或通用面板替代。

**Tech Stack:** Go 1.23, chi, MySQL, go-redis/v9, minio-go/v7, Volcengine TOS Go SDK, React 18, Ant Design, Vite, Redis, local filesystem, `go test`, `go vet`, React build and browser smoke tests.

---

## File Structure

- Create `backend/internal/shuihuo/domain/types.go`: 项目、分段、资产、媒体、任务和状态机领域类型。
- Create `backend/internal/shuihuo/store/projects.go`, `segments.go`, `assets.go`, `media.go`, `tasks.go`: MySQL 仓储，所有查询带用户作用域。
- Create `backend/internal/shuihuo/segmentation/service.go`: 快速、导入、人工与 AI 候选分段以及确认门禁。
- Create `backend/internal/shuihuo/prompts/service.go`: 只在服务端组合系统预设词、项目补充词和变量。
- Create `backend/internal/shuihuo/models/catalog.go`, `adapter.go`, `http_adapter.go`: 管理员模型目录、标准适配器、通用 HTTP 适配器和 SSRF 防护。
- Create `backend/internal/shuihuo/storage/storage.go`, `local.go`, `tos.go`, `minio.go`: 对象存储统一接口及三种实现。
- Create `backend/internal/shuihuo/tasks/queue.go`, `worker.go`, `callback.go`: Redis 队列、锁、任务状态机、轮询和回调幂等处理。
- Create `backend/internal/shuihuo/media/service.go`, `exports/service.go`: 图片、视频、配音、合并、下载和剪映草稿编排。
- Create `backend/internal/httpapi/shuihuo_handlers.go`, `shuihuo_admin_handlers.go`: 用户和管理员 API。
- Modify `backend/internal/config/config.go`, `app/app.go`, `httpapi/router.go`, `storage/migrations.go`, `.env.example`, `go.mod`.
- Create `backend/internal/shuihuo/**/**_test.go` 和 `backend/internal/httpapi/shuihuo_handlers_test.go`：领域、存储、权限、任务与接口测试。
- Create `frontend/src/shared/api/shuihuoProduction.js`: 水货生产 API 客户端。
- Create `frontend/src/user/pages/ShuihuoProductionPage.jsx`, `shuihuo/ProjectsView.jsx`, `StudioView.jsx`, `AssetsView.jsx`, `SegmentationModal.jsx`, `PromptModal.jsx`, `TaskDrawer.jsx`, `ModelSelector.jsx`。
- Create `frontend/src/user/pages/shuihuo-production.css`: 5175 原始布局 scoped 样式和响应式约束。
- Modify `frontend/src/user/App.jsx`, `frontend/src/shared/layouts/UserLayout.jsx`, `frontend/src/user/pages/HomePage.jsx`, `frontend/src/shared/styles/global.css`。
- Create `frontend/src/user/pages/shuihuo-production.test.jsx` 和 `tests/shuihuo-browser-smoke.mjs`。
- Create `docs/shuihuo-production-api-contract.md` 与 `docs/shuihuo-production-operations.md`。

## Task 1: 建立模块路由、权限骨架和迁移可用性

**Files:**
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/auth_handlers.go`
- Modify: `backend/internal/storage/migrations.go`
- Create: `backend/internal/httpapi/shuihuo_handlers_test.go`

- [ ] **Step 1: 写失败的路由与所有者权限测试**

```go
func TestShuihuoEndpointsRequireAuthentication(t *testing.T) {
    api := newTestAPI(t)
    req := httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/projects", nil)
    rec := httptest.NewRecorder()
    api.Router().ServeHTTP(rec, req)
    if rec.Code != http.StatusUnauthorized { t.Fatalf("status = %d", rec.Code) }
}

func TestNonOwnerCannotReachModelAdmin(t *testing.T) {
    api, token := newUserTestAPI(t, "editor")
    req := httptest.NewRequest(http.MethodGet, "/api/admin/models", nil)
    req.Header.Set("Authorization", "Bearer "+token)
    rec := httptest.NewRecorder()
    api.Router().ServeHTTP(rec, req)
    if rec.Code != http.StatusForbidden { t.Fatalf("status = %d", rec.Code) }
}
```

- [ ] **Step 2: 运行测试确认接口尚不存在**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/httpapi -run 'TestShuihuo|TestNonOwner' -count=1`

Expected: FAIL，因为路由、管理员标志和测试依赖尚未定义。

- [ ] **Step 3: 扩展用户记录并提供唯一平台所有者检查**

```go
type User struct {
    ID int64
    Username string
    PasswordHash string
    IsOwner bool
    IsActive bool
}

func (api *API) requireOwner(next http.Handler) http.Handler {
    return api.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        user, _ := currentUser(r)
        if !user.IsOwner { writeJSON(w, http.StatusForbidden, map[string]string{"error":"管理员权限不足"}); return }
        next.ServeHTTP(w, r)
    }))
}
```

使用迁移将 `users.is_owner` 和 `users.is_active` 加入现有表；仅 `QIANTIE_SEED_USERNAME` 首次创建时获得 `is_owner=1`。`requireAuth` 必须拒绝停用账号。

- [ ] **Step 4: 挂载空的受鉴权模块路由**

```go
r.Route("/shuihuo-production", func(r chi.Router) {
    r.Use(api.requireAuth)
    r.Get("/projects", api.handleListShuihuoProjects)
})
r.Group(func(r chi.Router) {
    r.Use(api.requireOwner)
    r.Get("/admin/models", api.handleListModels)
})
```

`handleListShuihuoProjects` 暂时返回当前用户的空项目数组，`handleListModels` 返回空模型数组；响应必须是 JSON，不能通过 404 冒充功能完成。

- [ ] **Step 5: 运行路由测试、迁移测试和静态检查**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./... && go vet ./...`

Expected: PASS。

- [ ] **Step 6: 提交路由骨架**

```bash
git add backend/internal/httpapi backend/internal/store/users.go backend/internal/storage/migrations.go backend/internal/app/app.go
git commit -m "feat: add shuihuo production route skeleton"
```

## Task 2: 添加水货生产数据模型和用户隔离仓储

**Files:**
- Create: `backend/internal/shuihuo/domain/types.go`
- Create: `backend/internal/shuihuo/store/projects.go`
- Create: `backend/internal/shuihuo/store/segments.go`
- Create: `backend/internal/shuihuo/store/assets.go`
- Create: `backend/internal/shuihuo/store/media.go`
- Create: `backend/internal/shuihuo/store/tasks.go`
- Modify: `backend/internal/storage/migrations.go`
- Test: `backend/internal/shuihuo/store/projects_test.go`

- [ ] **Step 1: 写跨用户不可见和人工锁持久化失败测试**

```go
func TestProjectQueriesAreScopedToOwner(t *testing.T) {
    repo := newProjectRepo(t)
    project := mustCreateProject(t, repo, 11, "甲项目")
    if _, err := repo.GetProject(context.Background(), 12, project.ID); !errors.Is(err, sql.ErrNoRows) {
        t.Fatalf("foreign user read err = %v", err)
    }
}

func TestManualPromptLockSurvivesReload(t *testing.T) {
    repo := newSegmentRepo(t)
    segment := mustCreateSegment(t, repo, 11, "原文")
    mustUpdatePrompt(t, repo, 11, segment.ID, "图", "视频", true)
    got := mustGetSegment(t, repo, 11, segment.ID)
    if !got.ImagePromptLocked || !got.VideoPromptLocked { t.Fatal("manual locks lost") }
}
```

- [ ] **Step 2: 运行测试确认仓储不存在**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/store -run 'TestProjectQueries|TestManualPromptLock' -count=1`

Expected: FAIL，包和迁移尚未创建。

- [ ] **Step 3: 创建领域类型及明确任务状态机**

```go
type TaskStatus string
const (
    TaskDraft TaskStatus = "draft"
    TaskQueued TaskStatus = "queued"
    TaskRunning TaskStatus = "running"
    TaskSucceeded TaskStatus = "succeeded"
    TaskFailed TaskStatus = "failed"
    TaskCancelled TaskStatus = "cancelled"
)
func (s TaskStatus) CanTransitionTo(next TaskStatus) bool {
    return map[TaskStatus]map[TaskStatus]bool{
      TaskDraft:{TaskQueued:true,TaskCancelled:true}, TaskQueued:{TaskRunning:true,TaskCancelled:true},
      TaskRunning:{TaskSucceeded:true,TaskFailed:true,TaskCancelled:true},
    }[s][next]
}
```

`Segment` 包含 `SourceText`、`OrderIndex`、`Confirmed`、`ManuallyEdited`、`ImagePrompt`、`VideoPrompt` 及两个锁字段；`Asset` 和 `Media` 也必须具有 `ManuallyEdited` 或来源字段。

- [ ] **Step 4: 创建幂等、带外键的 MySQL 迁移**

创建以下表并添加必要索引：`shuihuo_projects`、`shuihuo_segments`、`shuihuo_assets`、`shuihuo_segment_assets`、`shuihuo_asset_types`、`shuihuo_asset_templates`、`shuihuo_media`、`shuihuo_tasks`、`shuihuo_task_events`。项目表保存 `user_id`；其他业务表通过项目或素材关联可追溯到用户。为 `(project_id, order_index)`、`(project_id, status)`、`(user_id, created_at)` 和供应商任务 ID 创建索引。

- [ ] **Step 5: 实现所有带 owner 条件的仓储查询**

```go
const projectByOwnerSQL = `SELECT id, user_id, name, source_object_key, segmentation_status
FROM shuihuo_projects WHERE id = ? AND user_id = ?`

func (s *Projects) GetProject(ctx context.Context, ownerID, projectID int64) (domain.Project, error) {
    var p domain.Project
    err := s.db.QueryRowContext(ctx, projectByOwnerSQL, projectID, ownerID).Scan(&p.ID, &p.UserID, &p.Name, &p.SourceObjectKey, &p.SegmentationStatus)
    return p, err
}
```

禁止只以 `project_id` 查询后在 Go 中补充检查。所有 `Update*` 和 `Delete*` SQL 必须将 `user_id` 放入 `WHERE` 或通过 `EXISTS (SELECT 1 FROM shuihuo_projects ...)` 限制。

- [ ] **Step 6: 运行仓储测试和完整后端回归**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/store ./... && go vet ./...`

Expected: PASS。

- [ ] **Step 7: 提交数据与仓储层**

```bash
git add backend/internal/shuihuo backend/internal/storage/migrations.go
git commit -m "feat: add isolated shuihuo production data model"
```

## Task 3: 实现可切换对象存储和安全对象键

**Files:**
- Create: `backend/internal/shuihuo/storage/storage.go`
- Create: `backend/internal/shuihuo/storage/local.go`
- Create: `backend/internal/shuihuo/storage/tos.go`
- Create: `backend/internal/shuihuo/storage/minio.go`
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/.env.example`
- Test: `backend/internal/shuihuo/storage/storage_test.go`

- [ ] **Step 1: 写本地存储对象键与删除隔离失败测试**

```go
func TestObjectKeyAlwaysIncludesOwnerAndProject(t *testing.T) {
    key, err := ObjectKey(7, 9, "images", "shot.png")
    if err != nil || key != "shuihuo-production/7/9/images/shot.png" { t.Fatalf("key=%q err=%v", key, err) }
}

func TestLocalStorageRejectsTraversal(t *testing.T) {
    store := NewLocal(t.TempDir(), "http://localhost/files")
    if _, err := store.Put(context.Background(), "../../etc/passwd", bytes.NewReader(nil), "text/plain"); err == nil { t.Fatal("traversal accepted") }
}
```

- [ ] **Step 2: 运行测试确认适配器不存在**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/storage -count=1`

Expected: FAIL。

- [ ] **Step 3: 定义唯一存储接口和键校验**

```go
type ObjectStorage interface {
    Put(ctx context.Context, key string, body io.Reader, contentType string) (Object, error)
    Get(ctx context.Context, key string) (io.ReadCloser, Object, error)
    Delete(ctx context.Context, key string) error
    URL(ctx context.Context, key string, expiry time.Duration) (string, error)
}

func ObjectKey(userID, projectID int64, category, filename string) (string, error) {
    clean := path.Base(filename)
    if userID < 1 || projectID < 1 || !allowedCategory(category) || clean == "." || clean == "" { return "", ErrInvalidObjectKey }
    return fmt.Sprintf("shuihuo-production/%d/%d/%s/%s", userID, projectID, category, clean), nil
}
```

- [ ] **Step 4: 实现 local、TOS 与 MinIO 适配器**

本地实现仅写 `QIANTIE_STORAGE_LOCAL_DIR/shuihuo-production/...`，并由 Go 服务的受鉴权下载路由返回文件；不能把任意本地路径暴露为静态目录。TOS 和 MinIO 实现必须完全遵循 `ObjectStorage`，不让业务层判断厂商类型。

- [ ] **Step 5: 在配置和应用注入中选择实现**

```go
type StorageConfig struct { Driver, LocalDir, PublicBaseURL, Bucket, Endpoint, Region, AccessKey, SecretKey string }
// Driver accepts local, tos, minio only; Load returns an error for all other values.
```

`.env.example` 只写变量名与示例占位，不写 ai-video 的现有凭据。生产默认无密钥不能启动 TOS/MinIO 驱动；测试默认 local。

- [ ] **Step 6: 运行存储测试和配置检查**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/storage ./internal/config && go vet ./...`

Expected: PASS。

- [ ] **Step 7: 提交存储适配器**

```bash
git add backend/internal/shuihuo/storage backend/internal/config backend/internal/app backend/.env.example backend/go.mod backend/go.sum
git commit -m "feat: add pluggable shuihuo object storage"
```

## Task 4: 实现系统预设词服务和管理员模型目录

**Files:**
- Create: `backend/internal/shuihuo/prompts/service.go`
- Create: `backend/internal/shuihuo/models/catalog.go`
- Create: `backend/internal/shuihuo/models/adapter.go`
- Create: `backend/internal/shuihuo/models/http_adapter.go`
- Create: `backend/internal/httpapi/shuihuo_admin_handlers.go`
- Modify: `backend/internal/storage/migrations.go`
- Test: `backend/internal/shuihuo/prompts/service_test.go`
- Test: `backend/internal/shuihuo/models/http_adapter_test.go`

- [ ] **Step 1: 写“真实 prompt 不泄露”和 SSRF 拦截失败测试**

```go
func TestPublicPresetDoesNotExposeBody(t *testing.T) {
    preset := mustCreatePreset(t, "segment", "分段", "SERVER ONLY {{novel_text}}")
    public := ToPublicPreset(preset)
    if strings.Contains(mustJSON(t, public), "SERVER ONLY") { t.Fatal("prompt body leaked") }
}

func TestHTTPAdapterRejectsPrivateTarget(t *testing.T) {
    _, err := ValidateOutboundURL("http://127.0.0.1:8080/admin")
    if !errors.Is(err, ErrPrivateNetworkTarget) { t.Fatalf("err=%v", err) }
}
```

- [ ] **Step 2: 运行测试确认服务不存在**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/prompts ./internal/shuihuo/models -count=1`

Expected: FAIL。

- [ ] **Step 3: 实现预设词版本、选择和变量替换**

```go
func (s *Service) Assemble(ctx context.Context, selection Selection, input AssembleInput) (PromptSnapshot, error) {
    base, addons, err := s.repo.ResolveEnabled(ctx, "shuihuo-production", selection)
    if err != nil { return PromptSnapshot{}, err }
    body := strings.Join(append([]string{base.Body}, bodies(addons)...), "\n\n")
    body = strings.NewReplacer("{{novel_text}}", input.NovelText, "{{segment_text}}", input.SegmentText, "{{project_note}}", input.ProjectNote).Replace(body)
    return PromptSnapshot{BaseVersionID: base.VersionID, AddonVersionIDs: ids(addons), Rendered: body}, nil
}
```

普通 API 只返回 `id`、`name`、`module`、`purpose`、`parameters`、`version` 和可见说明。管理员 API 在 `requireOwner` 下才可返回正文、创建版本、发布、回滚与审计。

- [ ] **Step 4: 实现标准和通用模型目录**

模型记录至少包括 `Kind`（text/image/video/audio）、`AdapterKind`、`Enabled`、`AllowedRoles`、参数 schema、密钥引用和版本。通用 HTTP 适配器用 `text/template` 只渲染允许变量：`prompt`、`image_url`、`duration`、`aspect_ratio`、`resolution`、`callback_url`。禁止模板访问任意环境变量、文件或函数。

- [ ] **Step 5: 对通用 HTTP 调用增加网络与资源限制**

```go
transport := &http.Transport{DialContext: safeDialContext(resolver)}
client := &http.Client{Transport: transport, Timeout: 90 * time.Second}
// safeDialContext resolves all addresses and rejects loopback, link-local, private and metadata ranges before dialing.
```

限制请求体和响应体大小；仅允许 `https`，开发环境的管理员测试可通过明确配置允许 HTTP；把请求 ID、模型版本、耗时和错误码写入审计，不写入密钥和完整授权头。

- [ ] **Step 6: 运行提示词和模型测试**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/prompts ./internal/shuihuo/models ./internal/httpapi && go vet ./...`

Expected: PASS。

- [ ] **Step 7: 提交模型和预设词治理**

```bash
git add backend/internal/shuihuo/prompts backend/internal/shuihuo/models backend/internal/httpapi/shuihuo_admin_handlers.go backend/internal/storage/migrations.go
git commit -m "feat: add shuihuo model catalog and server prompts"
```

## Task 5: 实现快速、导入、人工和智能分段的确认门禁

**Files:**
- Create: `backend/internal/shuihuo/segmentation/service.go`
- Create: `backend/internal/shuihuo/segmentation/importer.go`
- Create: `backend/internal/httpapi/shuihuo_segmentation_handlers.go`
- Test: `backend/internal/shuihuo/segmentation/service_test.go`
- Test: `backend/internal/httpapi/shuihuo_handlers_test.go`

- [ ] **Step 1: 写三种分段和未确认阻断生成的失败测试**

```go
func TestImportSplitsNumberedAndTimedContent(t *testing.T) {
    got := ParseImported("01\n00:00:00,000 --> 00:00:02,000\n第一句\n\n02\n第二句")
    if len(got) != 2 || got[0].Text != "第一句" { t.Fatalf("segments=%#v", got) }
}

func TestGenerationBlockedUntilSegmentsConfirmed(t *testing.T) {
    project := domain.Project{SegmentationStatus: domain.SegmentationDraft}
    if err := EnsureSegmentsConfirmed(project); !errors.Is(err, ErrSegmentsUnconfirmed) { t.Fatalf("err=%v", err) }
}
```

- [ ] **Step 2: 运行测试确认服务不存在**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/segmentation ./internal/httpapi -run 'TestImport|TestGenerationBlocked' -count=1`

Expected: FAIL。

- [ ] **Step 3: 实现四个明确入口**

```go
func FixedLineSegments(text string, linesPerSegment int) []CandidateSegment
func ParseImported(text string) []CandidateSegment
func (s *Service) SmartCandidates(ctx context.Context, project domain.Project, selection prompts.Selection, modelID int64) ([]CandidateSegment, prompts.PromptSnapshot, error)
func (s *Service) Confirm(ctx context.Context, ownerID, projectID int64, candidates []CandidateSegment) error
```

`SmartCandidates` 使用 Task 4 的服务端 prompt 组合和文本模型，返回候选但不写正式分段。`Confirm` 使用单个事务替换当前未锁定候选、重排 `order_index` 并设置 `segmentation_status=confirmed`。创建、拆分、合并、排序、删除和编辑操作必须把项目重新标为 `draft`，要求再次确认。

- [ ] **Step 4: 增加 HTTP 接口并限制后续阶段**

实现 `POST /projects/{id}/segmentation/fixed`、`/import`、`/smart`、`PUT /segments`、`POST /segmentation/confirm`。资产分析、图片任务、视频任务和导出任务的 handler 进入前统一调用 `EnsureSegmentsConfirmed`。

- [ ] **Step 5: 运行分段和 API 回归**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/segmentation ./internal/httpapi ./... && go vet ./...`

Expected: PASS。

- [ ] **Step 6: 提交分段确认门禁**

```bash
git add backend/internal/shuihuo/segmentation backend/internal/httpapi/shuihuo_segmentation_handlers.go backend/internal/httpapi/shuihuo_handlers_test.go
git commit -m "feat: add reviewed shuihuo segmentation workflow"
```

## Task 6: 迁入项目、资产、模板和分段生产 API

**Files:**
- Create: `backend/internal/shuihuo/assets/service.go`
- Create: `backend/internal/httpapi/shuihuo_project_handlers.go`
- Create: `backend/internal/httpapi/shuihuo_asset_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Test: `backend/internal/shuihuo/assets/service_test.go`
- Test: `backend/internal/httpapi/shuihuo_handlers_test.go`

- [ ] **Step 1: 写人工资产和提示词不会被分析覆盖的失败测试**

```go
func TestAnalysisSkipsLockedAssetAndPrompt(t *testing.T) {
    existing := domain.Asset{Name:"林晚", VisualPrompt:"用户设定", ManuallyEdited:true}
    merged := MergeAssetCandidates([]domain.Asset{existing}, []domain.Asset{{Name:"林晚", VisualPrompt:"AI 设定"}}, false)
    if merged[0].VisualPrompt != "用户设定" { t.Fatal("manual asset overwritten") }
}

func TestExplicitOverwriteReplacesLockedAsset(t *testing.T) {
    merged := MergeAssetCandidates([]domain.Asset{{Name:"林晚", VisualPrompt:"用户设定", ManuallyEdited:true}}, []domain.Asset{{Name:"林晚", VisualPrompt:"AI 设定"}}, true)
    if merged[0].VisualPrompt != "AI 设定" { t.Fatal("explicit overwrite ignored") }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/assets -count=1`

Expected: FAIL。

- [ ] **Step 3: 实现项目、资产与模板服务**

实现项目 CRUD、原文/字幕/音频上传、资产和角色模板 CRUD、资产-分段绑定、参考图上传、主图选择、单条/批量分析候选。所有 AI 分析结果使用 `MergeAssetCandidates(..., false)`；前端只有显式 `overwrite_manual=true` 才可进入覆盖路径。

- [ ] **Step 4: 实现分段提示词编辑与批量前后缀**

```go
func ApplyPrefixSuffix(original, prefix, suffix string) string {
    return strings.TrimSpace(strings.Join([]string{strings.TrimSpace(prefix), strings.TrimSpace(original), strings.TrimSpace(suffix)}, "\n"))
}
```

`PUT /segments/{id}` 设置人工锁；批量套用可选择图片、视频或两者，并只修改本次明确选中的分段。

- [ ] **Step 5: 运行资产、项目和 HTTP 测试**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/assets ./internal/httpapi ./... && go vet ./...`

Expected: PASS。

- [ ] **Step 6: 提交项目与资产生产能力**

```bash
git add backend/internal/shuihuo/assets backend/internal/httpapi/shuihuo_project_handlers.go backend/internal/httpapi/shuihuo_asset_handlers.go backend/internal/httpapi/router.go
git commit -m "feat: add shuihuo projects assets and prompts"
```

## Task 7: 引入 Redis 队列、锁、可恢复任务状态与回调

**Files:**
- Create: `backend/internal/shuihuo/tasks/queue.go`
- Create: `backend/internal/shuihuo/tasks/worker.go`
- Create: `backend/internal/shuihuo/tasks/callback.go`
- Create: `backend/internal/httpapi/shuihuo_task_handlers.go`
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/app/app.go`
- Test: `backend/internal/shuihuo/tasks/worker_test.go`
- Test: `backend/internal/shuihuo/tasks/callback_test.go`

- [ ] **Step 1: 写状态机、重复回调和锁竞争失败测试**

```go
func TestTaskCannotJumpFromQueuedToSucceeded(t *testing.T) {
    err := Transition(domain.TaskQueued, domain.TaskSucceeded)
    if !errors.Is(err, domain.ErrInvalidTaskTransition) { t.Fatalf("err=%v", err) }
}

func TestDuplicateCallbackCreatesOneMediaRecord(t *testing.T) {
    svc := newCallbackService(t)
    mustCallback(t, svc, "vendor-1", "done")
    mustCallback(t, svc, "vendor-1", "done")
    if got := mediaCount(t, svc, "vendor-1"); got != 1 { t.Fatalf("media=%d", got) }
}
```

- [ ] **Step 2: 运行测试确认任务层不存在**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/tasks -count=1`

Expected: FAIL。

- [ ] **Step 3: 实现队列、锁和工作者**

```go
type Queue interface { Enqueue(ctx context.Context, id int64) error; Dequeue(ctx context.Context) (int64, error) }
func (w *Worker) RunOnce(ctx context.Context) error {
    id, err := w.queue.Dequeue(ctx); if err != nil { return err }
    return w.withLock(ctx, id, func() error { return w.execute(ctx, id) })
}
```

使用 Redis `BRPOP` 或 Streams 持久队列，锁 key 为 `shuihuo:task:<id>:lock`，采用随机 token 的比较删除释放。Worker 取任务时用 SQL 条件更新 `queued -> running`，零行受影响即跳过。启动时扫描超过阈值的 `running` 任务并按供应商任务 ID 恢复轮询或标记为可重试失败。

- [ ] **Step 4: 实现签名验证与幂等回调**

回调 URL 使用随机 callback token，不接受仅凭 task ID 的匿名写入。用供应商任务 ID + 终态事件建立唯一索引；回调先写 `task_events`，再在同一事务写最终媒体和任务状态。已终态的重复事件返回 200 且不重复上传/插入。

- [ ] **Step 5: 运行任务测试和完整回归**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/tasks ./internal/httpapi ./... && go vet ./...`

Expected: PASS。

- [ ] **Step 6: 提交可靠任务执行层**

```bash
git add backend/internal/shuihuo/tasks backend/internal/httpapi/shuihuo_task_handlers.go backend/internal/config backend/internal/app backend/go.mod backend/go.sum
git commit -m "feat: add resilient shuihuo task queue"
```

## Task 8: 迁入真实图片、视频和配音任务适配器

**Files:**
- Create: `backend/internal/shuihuo/media/service.go`
- Create: `backend/internal/shuihuo/media/image.go`
- Create: `backend/internal/shuihuo/media/video.go`
- Create: `backend/internal/shuihuo/media/audio.go`
- Modify: `backend/internal/shuihuo/tasks/worker.go`
- Test: `backend/internal/shuihuo/media/service_test.go`

- [ ] **Step 1: 写“存储和 MySQL 成功后才完成”的失败测试**

```go
func TestImageTaskSucceedsOnlyAfterObjectAndMediaPersist(t *testing.T) {
    svc := newMediaService(t, failingStorage{})
    err := svc.CompleteImage(context.Background(), taskFixture())
    if err == nil || taskStatus(t, svc) != domain.TaskFailed { t.Fatal("task was marked successful without stored media") }
}

func TestVideoUsesSelectedMainImage(t *testing.T) {
    req := mustBuildVideoRequest(t, selectedImageFixture())
    if req.ImageURL != "https://files.example/main.png" { t.Fatalf("image=%q", req.ImageURL) }
}
```

- [ ] **Step 2: 运行测试确认媒体服务不存在**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/media -count=1`

Expected: FAIL。

- [ ] **Step 3: 实现图片和视频任务编排**

图片：读取分段/资产提示词快照，调用模型适配器，下载或接收生成物，写对象存储，事务创建 `shuihuo_media`，最后 `running -> succeeded`。视频：仅接受用户选择的主图或显式指定输入图；支持上游轮询和回调，两者最终进入同一 `CompleteVideo` 路径。

- [ ] **Step 4: 实现配音任务**

配音请求保存音色、语速、音调、风格和文本快照；生成音频后按 `audio/` 对象键存储，创建媒体记录并提供签名下载 URL。未配置音频模型时返回 `model_not_configured`，不生成空音频或伪成功。

- [ ] **Step 5: 运行媒体、任务和接口测试**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/media ./internal/shuihuo/tasks ./internal/httpapi ./... && go vet ./...`

Expected: PASS。

- [ ] **Step 6: 提交真实媒体任务**

```bash
git add backend/internal/shuihuo/media backend/internal/shuihuo/tasks/worker.go
git commit -m "feat: add shuihuo image video and audio jobs"
```

## Task 9: 实现合并、下载和剪映草稿导出

**Files:**
- Create: `backend/internal/shuihuo/exports/service.go`
- Create: `backend/internal/shuihuo/exports/jianying.go`
- Create: `backend/internal/httpapi/shuihuo_export_handlers.go`
- Test: `backend/internal/shuihuo/exports/service_test.go`

- [ ] **Step 1: 写导出顺序和素材缺失失败测试**

```go
func TestExportOrdersSelectedVideosBySegment(t *testing.T) {
    manifest := BuildManifest([]domain.Media{{SegmentOrder:2},{SegmentOrder:1}})
    if manifest.Clips[0].SegmentOrder != 1 { t.Fatal("clips are not sorted") }
}

func TestExportRejectsSegmentWithoutSelectedVideo(t *testing.T) {
    if err := ValidateExportSegments([]domain.Segment{{OrderIndex:1}}); !errors.Is(err, ErrSelectedVideoRequired) { t.Fatalf("err=%v", err) }
}
```

- [ ] **Step 2: 运行测试确认导出服务不存在**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/exports -count=1`

Expected: FAIL。

- [ ] **Step 3: 实现导出任务和剪映草稿包**

合并和剪映草稿均作为 `export` 任务进入 Redis。根据分段顺序读取用户明确选中的视频和音频素材，生成 manifest，调用已配置的合并工具或草稿包构建器，写入 `exports/`。`BuildJianyingDraft` 必须引用本项目对象键生成的本地临时文件，完成后清理临时目录。

- [ ] **Step 4: 添加下载接口和权限校验**

`GET /api/shuihuo-production/media/{id}/download` 和 `GET /exports/{id}/download` 先验证当前用户经项目拥有该媒体，再返回短期签名 URL 或本地受鉴权流。不得返回可猜测的裸对象键。

- [ ] **Step 5: 运行导出和后端回归**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/shuihuo/exports ./internal/httpapi ./... && go vet ./...`

Expected: PASS。

- [ ] **Step 6: 提交导出能力**

```bash
git add backend/internal/shuihuo/exports backend/internal/httpapi/shuihuo_export_handlers.go
git commit -m "feat: add shuihuo media exports"
```

## Task 10: 接入前贴导航与 5175 原作品列表布局

**Files:**
- Create: `frontend/src/shared/api/shuihuoProduction.js`
- Create: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Create: `frontend/src/user/pages/shuihuo/ProjectsView.jsx`
- Create: `frontend/src/user/pages/shuihuo-production.css`
- Modify: `frontend/src/user/App.jsx`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/user/pages/HomePage.jsx`
- Test: `frontend/src/user/pages/shuihuo-production.test.jsx`

- [ ] **Step 1: 写失败的路由与原布局结构测试**

```jsx
it('renders the original project list and opens the production workspace', async () => {
  render(<ShuihuoProductionPage />)
  expect(await screen.findByRole('heading', { name: '水货生产' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '创建作品' })).toBeInTheDocument()
  expect(screen.getByText('作品列表')).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行前端测试确认页面不存在**

Run: `cd /Users/ming/Downloads/qiantie/frontend && npm test -- --run src/user/pages/shuihuo-production.test.jsx`

Expected: FAIL；若仓库没有测试命令，先在 `package.json` 增加 `vitest` 和 `@testing-library/react`，再运行同一命令。

- [ ] **Step 3: 挂载水货生产一级入口**

```jsx
// UserLayout.jsx
{ href: '/shuihuo-production', icon: '🎞', label: '水货生产' }

// user/App.jsx
if (pathname === '/shuihuo-production') return <ShuihuoProductionPage />;
```

首页快捷入口与导航都使用 `Link`，不使用 `window.location` 全页跳转。旧 `/novel-panel` 不改动；水货生产是新模块，不替换它。

- [ ] **Step 4: 以 5175 为来源迁入作品列表**

将 `5175` 的 `app-shell`、项目切换、作品列表、搜索、创建作品弹窗和“制作流程”二级栏重写为 React 组件。保留布局语义和操作顺序：作品列表、分段生产台、人物场景预设；不要替换成新草图中的 tabs 或卡片工作台。所有 CSS 用 `.shuihuo-production` 前缀限定，避免影响已有页面。

- [ ] **Step 5: 运行前端测试、构建和现有架构验证**

Run: `cd /Users/ming/Downloads/qiantie/frontend && npm test -- --run src/user/pages/shuihuo-production.test.jsx && npm run build`

Run: `cd /Users/ming/Downloads/qiantie && node scripts/validate-react-frontend-architecture.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交导航和项目布局**

```bash
git add frontend/src/user frontend/src/shared frontend/package.json frontend/package-lock.json
git commit -m "feat: add shuihuo production project workspace"
```

## Task 11: 迁入 5175 分段生产台、分段确认和资产预设 UI

**Files:**
- Create: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Create: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Create: `frontend/src/user/pages/shuihuo/SegmentationModal.jsx`
- Create: `frontend/src/user/pages/shuihuo/PromptModal.jsx`
- Create: `frontend/src/user/pages/shuihuo/AssetEditorModal.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Test: `frontend/src/user/pages/shuihuo-production.test.jsx`

- [ ] **Step 1: 写人工锁和确认门禁的 UI 失败测试**

```jsx
it('does not expose image generation before segmentation is confirmed', async () => {
  render(<StudioView project={{ segmentationStatus: 'draft', segments: [] }} />)
  expect(screen.getByRole('button', { name: '生成图片' })).toBeDisabled()
  expect(screen.getByText('请先确认分段')).toBeInTheDocument()
})

it('marks a saved prompt as manually edited', async () => {
  render(<PromptModal segment={{ imagePrompt: '', videoPrompt: '' }} />)
  await userEvent.type(screen.getByLabelText('图片提示词'), '用户图词')
  await userEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(mockUpdateSegment).toHaveBeenCalledWith(expect.objectContaining({ lockImagePrompt: true }))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/ming/Downloads/qiantie/frontend && npm test -- --run src/user/pages/shuihuo-production.test.jsx`

Expected: FAIL。

- [ ] **Step 3: 迁入分段表格而不改变其信息架构**

表格必须保留：序号、字幕/原文、配音、人物/场景/道具、图片提示词、视频提示词、片段库、操作。增加明确的分段状态条：草稿、候选待审核、已确认。确认前隐藏或禁用资产分析、图片、视频和导出操作，并提示原因。

- [ ] **Step 4: 实现智能、快速、导入和人工分段 UI**

`SegmentationModal` 以分段模式选择器、系统预设词下拉、管理员开放文本模型下拉、导入文本区域和候选预览组成。候选项支持拆分、合并、排序、编辑和删除；调用确认 API 后才更新项目状态。前端绝不发送真实 prompt 正文。

- [ ] **Step 5: 实现资产预设和模板交互**

保留 5175 的人物、场景、道具分类、编辑、上传参考图、AI 识别来源、人工修改标记和分段绑定。新增角色类型/模板管理入口、模板图预览、单条/批量重生成；管理员模型和系统预设词仅选择 ID。

- [ ] **Step 6: 运行组件测试和构建**

Run: `cd /Users/ming/Downloads/qiantie/frontend && npm test -- --run src/user/pages/shuihuo-production.test.jsx && npm run build`

Expected: PASS。

- [ ] **Step 7: 提交生产台和资产页面**

```bash
git add frontend/src/user/pages/shuihuo frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: add shuihuo segmentation and asset studio"
```

## Task 12: 接入图片、视频、配音、任务抽屉与导出 UI

**Files:**
- Create: `frontend/src/user/pages/shuihuo/TaskDrawer.jsx`
- Create: `frontend/src/user/pages/shuihuo/ModelSelector.jsx`
- Create: `frontend/src/user/pages/shuihuo/MediaLibrary.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Test: `frontend/src/user/pages/shuihuo-production.test.jsx`
- Create: `tests/shuihuo-browser-smoke.mjs`

- [ ] **Step 1: 写真实状态显示和重试 UI 失败测试**

```jsx
it('shows queued work as queued rather than generated media', () => {
  render(<TaskDrawer task={{ status: 'queued', kind: 'image' }} />)
  expect(screen.getByText('排队中')).toBeInTheDocument()
  expect(screen.queryByText('生成完成')).not.toBeInTheDocument()
})

it('offers retry only for failed tasks', () => {
  const { rerender } = render(<TaskDrawer task={{ status: 'running' }} />)
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  rerender(<TaskDrawer task={{ status: 'failed', errorMessage: '上游超时' }} />)
  expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/ming/Downloads/qiantie/frontend && npm test -- --run src/user/pages/shuihuo-production.test.jsx`

Expected: FAIL。

- [ ] **Step 3: 实现模型选择和任务提交**

`ModelSelector` 只请求公开模型元数据和参数 schema，按文本、图片、视频、配音能力过滤。用户提交时把模型 ID 与允许参数传给 Go API；不要接受 API URL、密钥、请求模板或隐藏参数。提交后立即显示 `queued`，使用短轮询或 SSE 更新真实状态。

- [ ] **Step 4: 实现任务、素材和导出操作**

分段行保留单条/批量生成图片和视频、素材上传、删除、主图选择；`TaskDrawer` 显示模型快照摘要、预设词版本、状态事件、失败原因、取消/重试。媒体库只显示当前项目授权素材。导出选择当前选定视频、音频和顺序，发起导出任务，完成后显示下载按钮。

- [ ] **Step 5: 编写浏览器 smoke 测试**

```js
await page.goto(process.env.QIANTIE_WEB_URL + '/shuihuo-production');
await page.getByRole('link', { name: '水货生产' }).click();
await page.getByRole('button', { name: '创建作品' }).click();
await expect(page.getByText('快速初分段')).toBeVisible();
await expect(page.getByText('智能分段')).toBeVisible();
await expect(page.getByText('人工分段')).toBeVisible();
```

测试在无模型环境只验证禁用/未配置状态，不触发真实供应商费用。

- [ ] **Step 6: 运行前端测试、构建和浏览器 smoke**

Run: `cd /Users/ming/Downloads/qiantie/frontend && npm test -- --run src/user/pages/shuihuo-production.test.jsx && npm run build`

Run: `cd /Users/ming/Downloads/qiantie && node tests/shuihuo-browser-smoke.mjs`

Expected: PASS；若未启动本地服务，脚本明确报出缺失 URL，不伪称通过。

- [ ] **Step 7: 提交媒体任务 UI**

```bash
git add frontend/src/user/pages/shuihuo tests/shuihuo-browser-smoke.mjs
git commit -m "feat: add shuihuo media task interface"
```

## Task 13: 管理员后台、部署文档和端到端验收

**Files:**
- Create: `frontend/src/admin/pages/ModelCatalogPage.jsx`
- Create: `frontend/src/admin/pages/ShuihuoPromptPage.jsx`
- Modify: `frontend/src/admin/App.jsx`
- Modify: `frontend/src/shared/layouts/AdminLayout.jsx`
- Create: `docs/shuihuo-production-api-contract.md`
- Create: `docs/shuihuo-production-operations.md`
- Modify: `deploy/docker-compose.yml`
- Modify: `README.md`
- Test: `backend/internal/httpapi/shuihuo_e2e_test.go`

- [ ] **Step 1: 写管理员 API 与用户可见边界失败测试**

```go
func TestUserModelCatalogDoesNotExposeCredentialsOrHTTPTemplate(t *testing.T) {
    body := getAsUser(t, "/api/shuihuo-production/models")
    if strings.Contains(body, "secret") || strings.Contains(body, "request_template") { t.Fatal("private model config leaked") }
}

func TestOwnerCanCreateDisabledGenericModel(t *testing.T) {
    rec := postAsOwner(t, "/api/admin/models", `{"name":"测试","kind":"image","adapterKind":"generic_http","enabled":false}`)
    if rec.Code != http.StatusCreated { t.Fatalf("status=%d", rec.Code) }
}
```

- [ ] **Step 2: 运行测试确认后台页面/API 未完成**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./internal/httpapi -run 'TestUserModelCatalog|TestOwnerCanCreate' -count=1`

Expected: FAIL 或暴露字段测试失败。

- [ ] **Step 3: 完成管理员模型与系统预设词页面**

管理员页面提供模型标准/通用接入表单、连接测试、启停、参数 schema、用户范围、版本和审计。预设词页面按用途管理真实正文、发布、回滚、兼容性；普通用户页面仅显示选择用的元数据。密钥输入只允许写入，读取时只显示“已配置”。

- [ ] **Step 4: 写部署与运行文档**

`docs/shuihuo-production-operations.md` 必须列出：MySQL、Redis、local/TOS/MinIO 的必填环境变量、密钥轮换、回调公网 URL、Worker 启动方式、备份与清理策略、任务卡死恢复、配置错误诊断。`docker-compose.yml` 提供本地 MySQL、Redis 和 MinIO profile，不包含真实凭据。

- [ ] **Step 5: 完成端到端 API 验收**

端到端测试应使用 local storage 和 fake model adapter，覆盖：创建项目、快速分段、确认、资产候选、人工锁、提交图片任务、worker 完成、本地对象存在、媒体记录存在、生成视频、导出、跨用户 404、重复回调不重复插入。真实 TOS/MinIO 和真实模型调用作为单独手工环境验收记录。

- [ ] **Step 6: 运行完整验证矩阵**

Run: `cd /Users/ming/Downloads/qiantie/backend && go test ./... && go vet ./...`

Run: `cd /Users/ming/Downloads/qiantie/frontend && npm test && npm run build`

Run: `cd /Users/ming/Downloads/qiantie && node scripts/validate-react-frontend-architecture.js && node tests/shuihuo-browser-smoke.mjs`

Expected: 所有本地可运行验证 PASS；真实 TOS/MinIO、回调和外部模型测试按运行文档单独记录结果。

- [ ] **Step 7: 提交发布准备工作**

```bash
git add frontend/src/admin deploy/docker-compose.yml docs README.md backend/internal/httpapi/shuihuo_e2e_test.go
git commit -m "feat: prepare shuihuo production operations"
```

## Plan Self-Review

- [x] 覆盖规格中的 5175 原布局、ai-video 功能清单、系统预设词、管理员模型目录、模型选择、Redis 状态机、local/TOS/MinIO、对象键隔离、人工锁、确认门禁、配音、导出和剪映草稿。
- [x] 每个阶段有明确文件、失败测试、最小实现、验证命令和独立提交点。
- [x] 前后端名称一致：模块路径 `shuihuo-production`，后端包 `internal/shuihuo`，状态 `draft/queued/running/succeeded/failed/cancelled`。
- [x] 未使用 TBD、TODO、以后实现或未定义的泛化实现步骤。
