# 巨量执行器 Mac/Win 双平台切换 + 同机身份合并 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让巨量素材执行器按用户偏好把读取任务派给 Windows 或 macOS（偏好离线/干砸自动兜底、恢复自动切回），同一台电脑只保留一条设备身份。

**Architecture:** 不改任务表结构语义、不在 job 上贴平台标签；执行器 claim 时控制面根据"账号偏好 + 两平台在线状态 + 近 5 分钟失败记录"当场判定。配对改为认老设备（owner+os+device_name 命中即复用并换 token）；启动时幂等合并现存重复记录。服务器侧用 `progress_changed_at` 列识别 10 分钟无进度的假死任务并重新派发。

**Tech Stack:** Go（控制面，`backend/internal/giantmaterialexecutor` + `httpapi` + `storage` 迁移）；React + Antd（设置页 / dot 状态条）；MySQL。

## Global Constraints

- 所有提交直接进 `v88` 主干，禁止建分支、禁止 GitHub Actions。
- 部署必须用精确 Git commit SHA；本次 Go + Node 都有改动，走增量部署，Node 镜像禁止手挑单文件 COPY（2026-09-30 404 事故教训）。
- 常量精确值：心跳 15 秒、在线阈值 45 秒、租约 60 秒、失败冷却 `FailureCooldown = 5 * time.Minute`、假死判定 `StuckProgressLimit = 10 * time.Minute`。
- 平台 os 取值只有 `windows` / `darwin`；无偏好记录时默认 `windows`。
- 前端按钮/选项始终可点击，不禁用；出错用明确提示，不假报成功。
- 本次**不重新生成、不发布执行器安装包**（Mac/Win exe 都不动）；`main.go` 设备名源码可改，随以后打包生效。
- 提示词、其他业务功能本次零改动。

---

## File Structure

后端：

- Modify: `backend/internal/storage/giant_material_executor_schema.go` — 新增迁移 7802002（偏好表 + jobs 增加 `progress_changed_at`）。
- Modify: `backend/internal/storage/giant_material_executor_schema_test.go` — 迁移数从 1 改 2。
- Modify: `backend/internal/giantmaterialexecutor/types.go` — 新错误、新常量、`PreferenceRecord/PreferenceView`、`ExecutorView.RecentFailureAt`。
- Modify: `backend/internal/giantmaterialexecutor/store.go` — Store 接口新增 6 个方法。
- Modify: `backend/internal/giantmaterialexecutor/service.go` — 偏好读写、claim 门控、合并入口、删除设备、ListExecutors 富化、版本比较工具。
- Modify: `backend/internal/giantmaterialexecutor/mysql_store.go` — 全部新方法的 MySQL 实现；ClaimJob 增加 stuck 分支；SetProgress/Requeue 维护 `progress_changed_at`；PairExecutor 改 upsert。
- Modify: `backend/internal/giantmaterialexecutor/memory_store.go` — 内存实现对齐（含 `preferences`、`progressChanged` 两个新 map）。
- Modify: `backend/internal/httpapi/giant_material_executor.go` — GET/PUT 偏好、DELETE 设备路由 + 错误映射。
- Modify: `backend/internal/app/app.go` — 启动时调用 `ConsolidateExecutors`。
- Create 测试: `preference_test.go`、`claim_routing_test.go`、`pair_identity_test.go`、`consolidate_test.go`、`delete_executor_test.go`（均在 `backend/internal/giantmaterialexecutor/`）。

前端：

- Modify: `frontend/src/shared/api/giantMaterialExecutorPublic.js` — 3 个新 API 函数。
- Modify: `frontend/src/user/pages/SettingsPage.jsx` — 优先平台切换 + 提示语 + 每设备删除。
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.jsx` — dot 变双平台 + 偏好后缀。
- Modify: `frontend/src/user/pages/shuihuo-production.css` — 双平台 pill、设置页偏好样式。
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go` — Mac 设备名改"电脑名/用户名"（仅源码不打包）。
- Create 测试: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.source.test.js`、`frontend/src/user/pages/SettingsPageGiant.source.test.js`。

---

### Task 1: 偏好表迁移 + 偏好读写（后端基础）

**Files:**
- Modify: `backend/internal/storage/giant_material_executor_schema.go`
- Modify: `backend/internal/storage/giant_material_executor_schema_test.go`
- Modify: `backend/internal/giantmaterialexecutor/types.go`
- Modify: `backend/internal/giantmaterialexecutor/store.go`
- Modify: `backend/internal/giantmaterialexecutor/mysql_store.go`
- Modify: `backend/internal/giantmaterialexecutor/memory_store.go`
- Modify: `backend/internal/giantmaterialexecutor/service.go`
- Modify: `backend/internal/httpapi/giant_material_executor.go`
- Test: `backend/internal/giantmaterialexecutor/preference_test.go`

**Interfaces:**
- Produces: `Service.GetPreference(ctx, owner) (PreferenceView, error)`；`Service.SavePreference(ctx, owner, preferredOS) (PreferenceView, error)`；类型 `PreferenceView{ PreferredOS string; UpdatedAt time.Time }`；Store 接口新增 `GetPreference`/`SavePreference`。后续所有任务依赖它们。

- [ ] **Step 1: 写失败测试**

Create `backend/internal/giantmaterialexecutor/preference_test.go`:

```go
package giantmaterialexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPreferenceDefaultsToWindows(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	view, err := service.GetPreference(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if view.PreferredOS != "windows" {
		t.Fatalf("preferred=%s", view.PreferredOS)
	}
}

func TestSavePreferencePersistsAndOverwrites(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)}
	service := NewService(NewMemoryStore(), clock.Now)
	first, err := service.SavePreference(context.Background(), "alice", "darwin")
	if err != nil {
		t.Fatal(err)
	}
	if first.PreferredOS != "darwin" {
		t.Fatalf("first=%s", first.PreferredOS)
	}
	again, err := service.GetPreference(context.Background(), "alice")
	if err != nil || again.PreferredOS != "darwin" {
		t.Fatalf("again=%+v err=%v", again, err)
	}
	overwritten, err := service.SavePreference(context.Background(), "alice", "WINDOWS")
	if err != nil || overwritten.PreferredOS != "windows" {
		t.Fatalf("overwritten=%+v err=%v", overwritten, err)
	}
}

func TestSavePreferenceRejectsInvalidOS(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	for _, bad := range []string{"", "linux", "ios"} {
		if _, err := service.SavePreference(context.Background(), "alice", bad); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("bad %q error=%v", bad, err)
		}
	}
}

func TestStoreGetPreferenceMissingIsSentinel(t *testing.T) {
	store := NewMemoryStore()
	if _, err := store.GetPreference(context.Background(), "alice"); !errors.Is(err, ErrPreferenceNotFound) {
		t.Fatalf("error=%v", err)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ -run TestPreference -v`
Expected: 编译失败 / FAIL（`undefined: ErrPreferenceNotFound` 等）。

- [ ] **Step 3: 加迁移**

在 `backend/internal/storage/giant_material_executor_schema.go` 新增函数，并在 `GiantMaterialExecutorMigrations()` 返回切片末尾追加一条（先 Read 该函数确认现有写法，保持风格一致）：

```go
func GiantMaterialExecutorV2Statements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS giant_executor_preferences (
  owner_username VARCHAR(191) NOT NULL PRIMARY KEY,
  preferred_os VARCHAR(32) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`ALTER TABLE giant_executor_jobs ADD COLUMN progress_changed_at DATETIME(6) NULL`,
		`UPDATE giant_executor_jobs SET progress_changed_at = updated_at WHERE progress_changed_at IS NULL`,
	}
}
```

在 migrations 切片中追加：

```go
{Version: 7802002, SQL: GiantMaterialExecutorV2Statements(), CallbackChecksum: "v78-giant-material-executor-preferences-v1"},
```

同步更新 `giant_material_executor_schema_test.go` 的断言：

```go
if len(migrations) != 2 || migrations[0].Version != 7802001 || migrations[1].Version != 7802002 {
	t.Fatalf("migrations=%+v", migrations)
}
```

- [ ] **Step 4: types.go 加错误、常量和类型**

在 errors 组中加：

```go
ErrPreferenceNotFound = errors.New("giant material executor preference not found")
```

在常量组中加：

```go
DefaultPreferredOS = "windows"
```

文件末尾加：

```go
type PreferenceRecord struct {
	OwnerUsername string
	PreferredOS   string
	UpdatedAt     time.Time
}

type PreferenceView struct {
	PreferredOS string    `json:"preferredOs"`
	UpdatedAt   time.Time `json:"updatedAt,omitempty"`
}
```

- [ ] **Step 5: Store 接口加方法**

在 `store.go` 的接口中加：

```go
GetPreference(context.Context, string) (PreferenceRecord, error)
SavePreference(context.Context, PreferenceRecord) error
```

- [ ] **Step 6: MySQL 实现**

在 `mysql_store.go` 加：

```go
func (s *MySQLStore) GetPreference(ctx context.Context, owner string) (PreferenceRecord, error) {
	var record PreferenceRecord
	err := s.db.QueryRowContext(ctx, `SELECT owner_username, preferred_os, updated_at
FROM giant_executor_preferences WHERE owner_username = ?`, owner).Scan(&record.OwnerUsername, &record.PreferredOS, &record.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PreferenceRecord{}, ErrPreferenceNotFound
	}
	if err != nil {
		return PreferenceRecord{}, err
	}
	return record, nil
}

func (s *MySQLStore) SavePreference(ctx context.Context, record PreferenceRecord) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO giant_executor_preferences (owner_username, preferred_os, updated_at)
VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE preferred_os = VALUES(preferred_os), updated_at = VALUES(updated_at)`,
		record.OwnerUsername, record.PreferredOS, record.UpdatedAt)
	return err
}
```

- [ ] **Step 7: Memory 实现**

`memory_store.go` 的结构体加字段 `preferences map[string]PreferenceRecord`；构造函数初始化它。然后加：

```go
func (s *MemoryStore) GetPreference(_ context.Context, owner string) (PreferenceRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.preferences[owner]
	if !ok {
		return PreferenceRecord{}, ErrPreferenceNotFound
	}
	return record, nil
}

func (s *MemoryStore) SavePreference(_ context.Context, record PreferenceRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.preferences[record.OwnerUsername] = record
	return nil
}
```

- [ ] **Step 8: Service 方法**

在 `service.go` 加：

```go
func (s *Service) GetPreference(ctx context.Context, owner string) (PreferenceView, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return PreferenceView{}, ErrInvalidInput
	}
	record, err := s.store.GetPreference(ctx, owner)
	if errors.Is(err, ErrPreferenceNotFound) {
		return PreferenceView{PreferredOS: DefaultPreferredOS}, nil
	}
	if err != nil {
		return PreferenceView{}, err
	}
	return PreferenceView{PreferredOS: record.PreferredOS, UpdatedAt: record.UpdatedAt}, nil
}

func (s *Service) SavePreference(ctx context.Context, owner, preferredOS string) (PreferenceView, error) {
	owner = strings.TrimSpace(owner)
	preferredOS = strings.ToLower(strings.TrimSpace(preferredOS))
	if owner == "" {
		return PreferenceView{}, ErrInvalidInput
	}
	if !validExecutorOS(preferredOS) {
		return PreferenceView{}, ErrInvalidInput
	}
	now := s.now().UTC()
	record := PreferenceRecord{OwnerUsername: owner, PreferredOS: preferredOS, UpdatedAt: now}
	if err := s.store.SavePreference(ctx, record); err != nil {
		return PreferenceView{}, err
	}
	return PreferenceView{PreferredOS: preferredOS, UpdatedAt: now}, nil
}

func validExecutorOS(value string) bool {
	return value == "windows" || value == "darwin"
}
```

- [ ] **Step 9: HTTP 路由**

在 `giant_material_executor.go` 的 `RegisterGiantMaterialExecutorRoutes` 中（executors 列表路由之后）加两个路由：

```go
root.Handle("GET /api/shuihuo-production/giant-material-executor/preference", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
	identity, ok := BridgeIdentityFromContext(req.Context())
	if !ok {
		writeGiantExecutorError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	preference, err := service.GetPreference(req.Context(), identity.Username)
	if err != nil {
		writeGiantExecutorServiceError(w, err)
		return
	}
	writeGiantExecutorJSON(w, http.StatusOK, preference)
})))

root.Handle("PUT /api/shuihuo-production/giant-material-executor/preference", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
	identity, ok := BridgeIdentityFromContext(req.Context())
	if !ok {
		writeGiantExecutorError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var input struct {
		PreferredOS string `json:"preferredOs"`
	}
	if err := decodeGiantExecutorJSON(w, req, &input); err != nil {
		writeGiantExecutorError(w, http.StatusBadRequest, "invalid request")
		return
	}
	preference, err := service.SavePreference(req.Context(), identity.Username, input.PreferredOS)
	if err != nil {
		writeGiantExecutorServiceError(w, err)
		return
	}
	writeGiantExecutorJSON(w, http.StatusOK, preference)
})))
```

- [ ] **Step 10: 跑测试 + 全量编译**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ ./internal/storage/ -v`
Expected: PASS（含更新后的 schema 测试）。
Run: `cd backend; go build ./...`
Expected: 无错误。

- [ ] **Step 11: 提交**

```bash
git add backend/
git commit -m "巨量执行器偏好表与Windows/macOS偏好读写"
```

---

### Task 2: Claim 平台门控 + 假死任务保护

**Files:**
- Modify: `backend/internal/giantmaterialexecutor/types.go`
- Modify: `backend/internal/giantmaterialexecutor/store.go`
- Modify: `backend/internal/giantmaterialexecutor/service.go`
- Modify: `backend/internal/giantmaterialexecutor/mysql_store.go`
- Modify: `backend/internal/giantmaterialexecutor/memory_store.go`
- Test: `backend/internal/giantmaterialexecutor/claim_routing_test.go`

**Interfaces:**
- Consumes: Task 1 的 `GetPreference`/`SavePreference`。
- Produces: Store 新增 `LatestPlatformFailure(ctx, owner, osName, since) (*time.Time, error)`。行为契约见测试。

- [ ] **Step 1: 写失败测试**

Create `backend/internal/giantmaterialexecutor/claim_routing_test.go`:

```go
package giantmaterialexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func pairExecutorVersion(t *testing.T, service *Service, owner, osName, device, version string) string {
	t.Helper()
	pairing, err := service.CreatePairing(context.Background(), owner, PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	paired, err := service.Pair(context.Background(), PairInput{
		Code: pairing.Code, Platform: PlatformGiantMaterial,
		DeviceName: device, OS: osName, Version: version,
	})
	if err != nil {
		t.Fatal(err)
	}
	return paired.Token
}

func heartbeatExecutorVersion(t *testing.T, service *Service, token, osName, device, version string) {
	t.Helper()
	err := service.Heartbeat(context.Background(), token, HeartbeatInput{
		DeviceName: device, OS: osName, Version: version,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestPreferredDarwinBothOnlineOnlyDarwinClaims(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC)}
	service := NewService(NewMemoryStore(), clock.Now)
	winToken := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.4.9")
	macToken := pairExecutorVersion(t, service, "alice", "darwin", "mac-box", "0.5.0")
	if _, err := service.SavePreference(context.Background(), "alice", "darwin"); err != nil {
		t.Fatal(err)
	}
	heartbeatExecutorVersion(t, service, winToken, "windows", "win-box", "0.4.9")
	heartbeatExecutorVersion(t, service, macToken, "darwin", "mac-box", "0.5.0")
	job, err := service.CreateJob(context.Background(), "alice", testJobInput("m1", "b1"))
	if err != nil {
		t.Fatal(err)
	}
	macClaim, err := service.Claim(context.Background(), macToken)
	if err != nil || macClaim.Job.ID != job.ID {
		t.Fatalf("mac claim=%+v err=%v", macClaim, err)
	}
	if _, err := service.Claim(context.Background(), winToken); !errors.Is(err, ErrNoClaimableJob) {
		t.Fatalf("windows claim error=%v", err)
	}
}

func TestPreferredDarwinOfflineWindowsClaims(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 1, 10, 10, 0, 0, time.UTC)}
	service := NewService(NewMemoryStore(), clock.Now)
	winToken := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.4.9")
	pairExecutorVersion(t, service, "alice", "darwin", "mac-box", "0.5.0")
	if _, err := service.SavePreference(context.Background(), "alice", "darwin"); err != nil {
		t.Fatal(err)
	}
	heartbeatExecutorVersion(t, service, winToken, "windows", "win-box", "0.4.9")
	job, err := service.CreateJob(context.Background(), "alice", testJobInput("m2", "b2"))
	if err != nil {
		t.Fatal(err)
	}
	winClaim, err := service.Claim(context.Background(), winToken)
	if err != nil || winClaim.Job.ID != job.ID {
		t.Fatalf("windows claim=%+v err=%v", winClaim, err)
	}
}

func TestFailureCooldownFallbackAndTrialRestore(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 1, 10, 20, 0, 0, time.UTC)}
	service := NewService(NewMemoryStore(), clock.Now)
	winToken := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.4.9")
	macToken := pairExecutorVersion(t, service, "alice", "darwin", "mac-box", "0.5.0")
	if _, err := service.SavePreference(context.Background(), "alice", "darwin"); err != nil {
		t.Fatal(err)
	}
	heartbeatExecutorVersion(t, service, winToken, "windows", "win-box", "0.4.9")
	heartbeatExecutorVersion(t, service, macToken, "darwin", "mac-box", "0.5.0")
	job, err := service.CreateJob(context.Background(), "alice", testJobInput("m3", "b3"))
	if err != nil {
		t.Fatal(err)
	}
	macClaim, err := service.Claim(context.Background(), macToken)
	if err != nil {
		t.Fatal(err)
	}
	macLease := LeaseCredential{Token: macClaim.LeaseToken, Generation: macClaim.LeaseGeneration}
	if err := service.Progress(context.Background(), macToken, job.ID, macLease, JobRunning,
		ProgressInput{Completed: 1, Total: 10, Percent: 10}); err != nil {
		t.Fatal(err)
	}
	if err := service.Fail(context.Background(), macToken, job.ID, macLease,
		FailureInput{Code: "ocr_crash", Message: "worker died"}); err != nil {
		t.Fatal(err)
	}
	// 同 key 重新创建 = 失败任务重新排队
	if _, err := service.CreateJob(context.Background(), "alice", testJobInput("m3", "b3")); err != nil {
		t.Fatal(err)
	}
	winClaim, err := service.Claim(context.Background(), winToken)
	if err != nil || winClaim.Job.ID != job.ID || winClaim.LeaseGeneration != 3 {
		t.Fatalf("windows fallback=%+v err=%v", winClaim, err)
	}
	if _, err := service.Claim(context.Background(), macToken); !errors.Is(err, ErrNoClaimableJob) {
		t.Fatalf("mac in cooldown error=%v", err)
	}
	// Windows 也干砸
	winLease := LeaseCredential{Token: winClaim.LeaseToken, Generation: winClaim.LeaseGeneration}
	if err := service.Progress(context.Background(), winToken, job.ID, winLease, JobRunning,
		ProgressInput{Completed: 2, Total: 10, Percent: 20}); err != nil {
		t.Fatal(err)
	}
	if err := service.Fail(context.Background(), winToken, job.ID, winLease,
		FailureInput{Code: "ocr_crash", Message: "also died"}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateJob(context.Background(), "alice", testJobInput("m3", "b3")); err != nil {
		t.Fatal(err)
	}
	// 两台都在冷却：都领不到
	if _, err := service.Claim(context.Background(), macToken); !errors.Is(err, ErrNoClaimableJob) {
		t.Fatalf("both cooling mac error=%v", err)
	}
	if _, err := service.Claim(context.Background(), winToken); !errors.Is(err, ErrNoClaimableJob) {
		t.Fatalf("both cooling windows error=%v", err)
	}
	clock.now = clock.now.Add(FailureCooldown + time.Second)
	heartbeatExecutorVersion(t, service, winToken, "windows", "win-box", "0.4.9")
	heartbeatExecutorVersion(t, service, macToken, "darwin", "mac-box", "0.5.0")
	trial, err := service.Claim(context.Background(), macToken)
	if err != nil || trial.Job.ID != job.ID || trial.LeaseGeneration != 5 {
		t.Fatalf("trial restore=%+v err=%v", trial, err)
	}
}

func TestStuckLeaseReclaimedWithoutWaitingForExpiry(t *testing.T) {
	start := time.Date(2026, 10, 1, 11, 0, 0, 0, time.UTC)
	clock := &testClock{now: start}
	service := NewService(NewMemoryStore(), clock.Now)
	winToken := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.4.9")
	job, err := service.CreateJob(context.Background(), "alice", testJobInput("m4", "b4"))
	if err != nil {
		t.Fatal(err)
	}
	claim, err := service.Claim(context.Background(), winToken)
	if err != nil {
		t.Fatal(err)
	}
	lease := LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	for clock.now.Before(start.Add(10*time.Minute + 30*time.Second)) {
		clock.now = clock.now.Add(30 * time.Second)
		if _, err := service.Renew(context.Background(), winToken, job.ID, lease); err != nil {
			t.Fatal(err)
		}
	}
	reclaim, err := service.Claim(context.Background(), winToken)
	if err != nil {
		t.Fatal(err)
	}
	if reclaim.Job.ID != job.ID || reclaim.LeaseGeneration != 2 || !reclaim.LeaseExpiresAt.After(clock.now) {
		t.Fatalf("reclaim=%+v", reclaim)
	}
}

func TestFreshProgressIsNotReclaimedAsStuck(t *testing.T) {
	start := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	clock := &testClock{now: start}
	service := NewService(NewMemoryStore(), clock.Now)
	winToken := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.4.9")
	job, err := service.CreateJob(context.Background(), "alice", testJobInput("m5", "b5"))
	if err != nil {
		t.Fatal(err)
	}
	claim, err := service.Claim(context.Background(), winToken)
	if err != nil {
		t.Fatal(err)
	}
	lease := LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	for clock.now.Before(start.Add(8*time.Minute)) {
		clock.now = clock.now.Add(30 * time.Second)
		if _, err := service.Renew(context.Background(), winToken, job.ID, lease); err != nil {
			t.Fatal(err)
		}
	}
	if err := service.Progress(context.Background(), winToken, job.ID, lease, JobRunning,
		ProgressInput{Completed: 100, Total: 281, Percent: 35}); err != nil {
		t.Fatal(err)
	}
	for clock.now.Before(start.Add(10*time.Minute+30*time.Second)) {
		clock.now = clock.now.Add(30 * time.Second)
		if _, err := service.Renew(context.Background(), winToken, job.ID, lease); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.Claim(context.Background(), winToken); !errors.Is(err, ErrNoClaimableJob) {
		t.Fatalf("fresh progress reclaimed error=%v", err)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ -run 'TestPreferred|TestFailureCooldown|TestStuck|TestFreshProgress' -v`
Expected: FAIL（未定义行为）。

- [ ] **Step 3: types.go 加常量**

```go
FailureCooldown    = 5 * time.Minute
StuckProgressLimit = 10 * time.Minute
```

- [ ] **Step 4: Store 接口加方法**

```go
LatestPlatformFailure(context.Context, string, string, time.Time) (*time.Time, error)
```

- [ ] **Step 5: MySQL 实现**

```go
func (s *MySQLStore) LatestPlatformFailure(ctx context.Context, owner, osName string, since time.Time) (*time.Time, error) {
	var latest sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT MAX(e.created_at)
FROM giant_executor_job_events e
WHERE e.event_type = 'failed' AND e.created_at >= ?
AND e.executor_id IN (SELECT id FROM giant_executors WHERE owner_username = ? AND os = ?)`,
		since, owner, osName).Scan(&latest)
	if err != nil {
		return nil, err
	}
	if !latest.Valid {
		return nil, nil
	}
	value := latest.Time
	return &value, nil
}
```

- [ ] **Step 6: Memory 实现**（内存模式用"失败台账"保留失败事实，任务重新排队也不丢）

MemoryStore 结构体加字段 `lastFailure map[string]time.Time`（键 executorID；在 Step 10 与 progressChanged 一起初始化）。

FailJob 现有实现末尾（state 已改为 JobFailed 之后）加一行记录：

```go
s.lastFailure[executorID] = now
```

然后加：

```go
func (s *MemoryStore) LatestPlatformFailure(_ context.Context, owner, osName string, since time.Time) (*time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest *time.Time
	for executorID, failedAt := range s.lastFailure {
		if failedAt.Before(since) {
			continue
		}
		executor, ok := s.executors[executorID]
		if !ok || executor.OwnerUsername != owner || executor.OS != osName {
			continue
		}
		copyTime := failedAt
		if latest == nil || copyTime.After(*latest) {
			latest = &copyTime
		}
	}
	return latest, nil
}
```

- [ ] **Step 7: Service Claim 加门控**

先 Read `service.go` 中现有 `Claim` 方法，在"token 校验之后、调用 `s.store.ClaimJob` 之前"插入门控（其余原代码保留，注意现有返回结构不变）：

```go
now := s.now().UTC()
allowed, err := s.canClaimPlatform(ctx, executor, now)
if err != nil {
	return ClaimResult{}, err
}
if !allowed {
	return ClaimResult{}, ErrNoClaimableJob
}
```

（删除原来位于同一位置的 `now := s.now().UTC()` 重复声明；`expires` 与 `ClaimJob` 调用保持原样。）

新增方法：

```go
func (s *Service) canClaimPlatform(ctx context.Context, executor ExecutorRecord, now time.Time) (bool, error) {
	// 自己刚干砸：先冷却，任何平台都一样
	callerFailure, err := s.store.LatestPlatformFailure(ctx, executor.OwnerUsername, executor.OS, now.Add(-FailureCooldown))
	if err != nil {
		return false, err
	}
	if callerFailure != nil {
		return false, nil
	}
	preference, err := s.GetPreference(ctx, executor.OwnerUsername)
	if err != nil {
		return false, err
	}
	preferred := preference.PreferredOS
	if executor.OS == preferred {
		// 它就是偏好平台且没在冷却：恢复优先
		return true, nil
	}
	preferredFailure, err := s.store.LatestPlatformFailure(ctx, executor.OwnerUsername, preferred, now.Add(-FailureCooldown))
	if err != nil {
		return false, err
	}
	if preferredFailure != nil {
		// 偏好平台在冷却：非偏好平台兜底
		return true, nil
	}
	executors, err := s.store.ListExecutors(ctx, executor.OwnerUsername)
	if err != nil {
		return false, err
	}
	for _, item := range executors {
		if item.OS == preferred && item.LastSeenAt != nil && !item.LastSeenAt.Before(now.Add(-OnlineThreshold)) {
			// 偏好平台在岗：单子留给它
			return false, nil
		}
	}
	// 偏好平台不在线：兜底
	return true, nil
}
```

- [ ] **Step 8: MySQL ClaimJob 增加 stuck 分支**

把 `ClaimJob` 中 `queryJobTx` 的 WHERE/参数整体替换为：

```go
record, err := queryJobTx(ctx, tx, jobSelect+` WHERE j.owner_username = ? AND j.platform = ? AND j.cancel_requested = FALSE
 AND (j.state = ?
 OR (j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= ? AND j.state NOT IN (?, ?, ?))
 OR (j.state IN (?, ?, ?, ?) AND j.lease_expires_at > ? AND j.progress_changed_at IS NOT NULL AND j.progress_changed_at <= ?))
 ORDER BY j.created_at ASC, j.id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
	executor.OwnerUsername, PlatformGiantMaterial, JobQueued,
	now, JobSucceeded, JobFailed, JobCancelled,
	JobLeased, JobRunning, JobCleaning, JobUploading,
	now, now.Add(-StuckProgressLimit))
```

把随后的 UPDATE 语句替换为（同时重置 progress_changed_at）：

```go
wasStuck := record.State != JobQueued
record.State = JobLeased
record.LeaseExecutorID = executor.ID
record.LeaseTokenHash = leaseHash
record.LeaseGeneration++
record.LeaseExpiresAt = &expires
record.UpdatedAt = now
if _, err := tx.ExecContext(ctx, `UPDATE giant_executor_jobs
SET state = ?, lease_executor_id = ?, lease_token_hash = ?, lease_generation = ?, lease_expires_at = ?,
 progress_changed_at = ?, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?`,
	JobLeased, executor.ID, leaseHash[:], record.LeaseGeneration, expires, now, now, record.ID); err != nil {
	return JobRecord{}, err
}
eventType := "claimed"
if wasStuck {
	eventType = "stuck_reclaimed"
}
if err := appendEvent(ctx, tx, record.ID, executor.ID, eventType, JobLeased, "", now); err != nil {
	return JobRecord{}, err
}
```

- [ ] **Step 9: MySQL SetProgress 维护 progress_changed_at**

替换 SetProgress 闭包内的 UPDATE：

```go
record.State = next
record.Progress = progress
record.UpdatedAt = now
if _, err := tx.ExecContext(ctx, `UPDATE giant_executor_jobs
SET state = ?, progress_completed = ?, progress_total = ?, progress_percent = ?,
 progress_changed_at = CASE WHEN progress_completed <> ? OR progress_total <> ? OR progress_percent <> ? THEN ? ELSE progress_changed_at END,
 updated_at = ? WHERE id = ?`,
	next, progress.Completed, progress.Total, progress.Percent,
	progress.Completed, progress.Total, progress.Percent, now, now, id); err != nil {
	return err
}
```

RequeueJob 的 UPDATE 中增加 `progress_changed_at = NULL`（与 lease 字段放在一起）。

- [ ] **Step 10: Memory ClaimJob/SetProgress/Requeue 对齐**

MemoryStore 结构体加 `progressChanged map[string]time.Time`、`lastFailure map[string]time.Time`，构造函数初始化两个 map。

ClaimJob 循环中，在现有 `claimable` 计算前增加 stuck 判定，并把最终 claimable 改为：

```go
stuck := false
switch candidate.State {
case JobLeased, JobRunning, JobCleaning, JobUploading:
	if candidate.LeaseExpiresAt != nil && candidate.LeaseExpiresAt.After(now) {
		if pc, ok := s.progressChanged[candidate.ID]; ok && !pc.After(now.Add(-StuckProgressLimit)) {
			stuck = true
		}
	}
}
claimable := candidate.State == JobQueued ||
	(candidate.LeaseExpiresAt != nil && !candidate.LeaseExpiresAt.After(now)) ||
	stuck
```

选中并写完 record 后加：`s.progressChanged[record.ID] = now`。

SetProgress 在更新 record 前比较旧进度，不同则加标记：

```go
if record.Progress.Completed != progress.Completed || record.Progress.Total != progress.Total || record.Progress.Percent != progress.Percent {
	s.progressChanged[id] = now
}
```

RequeueJob 中加：`delete(s.progressChanged, id)`。

- [ ] **Step 11: 跑测试**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ -v`
Expected: 全部 PASS（含旧测试）。
Run: `cd backend; go build ./...`
Expected: 无错误。

- [ ] **Step 12: 提交**

```bash
git add backend/
git commit -m "巨量执行器claim按偏好平台门控且10分钟无进度假死可重派"
```

---

### Task 3: 配对认老设备（同机复用身份 + 旧 token 作废）

**Files:**
- Modify: `backend/internal/giantmaterialexecutor/mysql_store.go`
- Modify: `backend/internal/giantmaterialexecutor/memory_store.go`
- Test: `backend/internal/giantmaterialexecutor/pair_identity_test.go`

**Interfaces:**
- Produces: `PairExecutor` 内部行为变更——同 `owner + os + device_name` 命中即复用 ID、换 token/version；Store 接口签名不变。

- [ ] **Step 1: 写失败测试**

Create `backend/internal/giantmaterialexecutor/pair_identity_test.go`:

```go
package giantmaterialexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPairReusesSameDeviceIdentityAndInvalidatesOldToken(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	first, err := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	oldPair, err := service.Pair(context.Background(), PairInput{
		Code: first.Code, Platform: PlatformGiantMaterial,
		DeviceName: "win-box", OS: "windows", Version: "0.4.3",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	newPair, err := service.Pair(context.Background(), PairInput{
		Code: second.Code, Platform: PlatformGiantMaterial,
		DeviceName: "win-box", OS: "windows", Version: "0.4.9",
	})
	if err != nil {
		t.Fatal(err)
	}
	executors, err := service.ListExecutors(context.Background(), "alice")
	if err != nil || len(executors) != 1 {
		t.Fatalf("executors=%+v err=%v", executors, err)
	}
	if executors[0].Version != "0.4.9" || executors[0].ID != newPair.ExecutorID {
		t.Fatalf("executor=%+v", executors[0])
	}
	err = service.Heartbeat(context.Background(), oldPair.Token, HeartbeatInput{
		DeviceName: "win-box", OS: "windows", Version: "0.4.3",
	})
	if !errors.Is(err, ErrExecutorUnauthorized) {
		t.Fatalf("old token error=%v", err)
	}
	if err := service.Heartbeat(context.Background(), newPair.Token, HeartbeatInput{
		DeviceName: "win-box", OS: "windows", Version: "0.4.9",
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPairDifferentOSCreatesSeparateExecutor(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	first, err := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Pair(context.Background(), PairInput{
		Code: first.Code, Platform: PlatformGiantMaterial,
		DeviceName: "same-name", OS: "windows", Version: "0.4.9",
	}); err != nil {
		t.Fatal(err)
	}
	second, err := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Pair(context.Background(), PairInput{
		Code: second.Code, Platform: PlatformGiantMaterial,
		DeviceName: "same-name", OS: "darwin", Version: "0.5.0",
	}); err != nil {
		t.Fatal(err)
	}
	executors, err := service.ListExecutors(context.Background(), "alice")
	if err != nil || len(executors) != 2 {
		t.Fatalf("executors=%+v err=%v", executors, err)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ -run TestPair -v`
Expected: FAIL（当前每次 Pair 都新增记录，len 为 2/3）。

- [ ] **Step 3: MySQL PairExecutor 改 upsert**

在 `PairExecutor` 中，`executor.OwnerUsername = pairing.OwnerUsername` 之后、INSERT 之前插入查询；命中则走 UPDATE 分支并跳过 INSERT：

```go
var existingID string
lookupErr := tx.QueryRowContext(ctx, `SELECT id FROM giant_executors
WHERE owner_username = ? AND os = ? AND device_name = ?
ORDER BY updated_at DESC, id ASC LIMIT 1 FOR UPDATE`,
	executor.OwnerUsername, executor.OS, executor.DeviceName).Scan(&existingID)
switch {
case errors.Is(lookupErr, sql.ErrNoRows):
	if _, err := tx.ExecContext(ctx, `INSERT INTO giant_executors
(id, owner_username, platform, token_hash, device_name, os, app_version, last_seen_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`, executor.ID, executor.OwnerUsername, executor.Platform,
		executor.TokenHash[:], executor.DeviceName, executor.OS, executor.Version,
		executor.CreatedAt, executor.UpdatedAt); err != nil {
		return ExecutorRecord{}, err
	}
case lookupErr != nil:
	return ExecutorRecord{}, lookupErr
default:
	executor.ID = existingID
	executor.UpdatedAt = now
	if _, err := tx.ExecContext(ctx, `UPDATE giant_executors
SET token_hash = ?, app_version = ?, updated_at = ? WHERE id = ?`,
		executor.TokenHash[:], executor.Version, now, existingID); err != nil {
		return ExecutorRecord{}, err
	}
}
```

（用此块替换原来的 INSERT 语句。）

- [ ] **Step 4: Memory PairExecutor 改 upsert**

在 memory_store.go 的 `PairExecutor` 中，`executor.OwnerUsername = pairing.OwnerUsername` 之后加：

```go
var existingID string
for id, item := range s.executors {
	if item.OwnerUsername != pairing.OwnerUsername || item.OS != executor.OS || item.DeviceName != executor.DeviceName {
		continue
	}
	if existingID == "" || item.UpdatedAt.After(s.executors[existingID].UpdatedAt) {
		existingID = id
	}
}
if existingID != "" {
	old := s.executors[existingID]
	delete(s.tokens, secretHashKey(old.TokenHash))
	executor.ID = existingID
	executor.UpdatedAt = now
	s.executors[existingID] = executor
	s.tokens[secretHashKey(executor.TokenHash)] = existingID
} else {
	s.executors[executor.ID] = executor
	s.tokens[secretHashKey(executor.TokenHash)] = executor.ID
}
```

（替换原来的 `s.executors[executor.ID] = executor` 和 `s.tokens[...] = executor.ID` 两行。）

- [ ] **Step 5: 跑测试 + 全量回归**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ -v`
Expected: PASS。
Run: `cd backend; go test ./... `
Expected: 全绿（超时可加 `-timeout 120s`）。

- [ ] **Step 6: 提交**

```bash
git add backend/
git commit -m "巨量执行器配对认老设备复用身份并作废旧token"
```

---

### Task 4: 启动一次性合并重复设备 + 执行器列表失败标记

**Files:**
- Modify: `backend/internal/giantmaterialexecutor/types.go`
- Modify: `backend/internal/giantmaterialexecutor/store.go`
- Modify: `backend/internal/giantmaterialexecutor/service.go`
- Modify: `backend/internal/giantmaterialexecutor/mysql_store.go`
- Modify: `backend/internal/giantmaterialexecutor/memory_store.go`
- Modify: `backend/internal/app/app.go`
- Test: `backend/internal/giantmaterialexecutor/consolidate_test.go`

**Interfaces:**
- Produces: `Service.ConsolidateExecutors(ctx) (int, error)`；Store 新增 `ConsolidateDuplicateExecutors(ctx, now) (int, error)`、`RecentFailures(ctx, owner, since) (map[string]time.Time, error)`；`ExecutorView` 增加 `RecentFailureAt *time.Time`。

- [ ] **Step 1: 写失败测试**

Create `backend/internal/giantmaterialexecutor/consolidate_test.go`:

```go
package giantmaterialexecutor

import (
	"context"
	"testing"
	"time"
)

func seedDuplicateSetup(t *testing.T, now time.Time) (*MemoryStore, string, []string) {
	t.Helper()
	store := NewMemoryStore()
	versions := []string{"0.3.0", "0.4.2", "0.4.3", "0.4.9"}
	jobIDs := make([]string, 0, len(versions))
	for index, version := range versions {
		executorID := "gme_executor_dup_" + version
		created := now.Add(time.Duration(index) * time.Minute)
		record := ExecutorRecord{
			ID: executorID, OwnerUsername: "alice", Platform: PlatformGiantMaterial,
			TokenHash: hashSecret(version + "win-box"), DeviceName: "win-box",
			OS: "windows", Version: version, CreatedAt: created, UpdatedAt: created,
		}
		store.executors[executorID] = record
		store.tokens[secretHashKey(record.TokenHash)] = executorID
		jobID := "gme_job_dup_" + version
		leaseExpires := now.Add(JobLeaseTTL)
		store.jobs[jobID] = JobRecord{
			ID: jobID, OwnerUsername: "alice", Platform: PlatformGiantMaterial,
			MaterialID: "m-" + version, PlatformBookID: "b-" + version, Title: "测试书",
			State: JobLeased, LeaseExecutorID: executorID, LeaseGeneration: 1,
			LeaseExpiresAt: &leaseExpires, CreatedAt: created, UpdatedAt: created,
		}
		store.jobKeys["alice\x00"+jobKey(store.jobs[jobID])] = jobID
		store.progressChanged[jobID] = created
		jobIDs = append(jobIDs, jobID)
	}
	return store, "win-box", jobIDs
}

func TestConsolidateMergesDuplicatesToLatestVersion(t *testing.T) {
	now := time.Date(2026, 10, 1, 13, 0, 0, 0, time.UTC)
	store, _, jobIDs := seedDuplicateSetup(t, now)
	service := NewService(store, func() time.Time { return now })
	merged, err := service.ConsolidateExecutors(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if merged != 3 {
		t.Fatalf("merged=%d", merged)
	}
	executors, err := service.ListExecutors(context.Background(), "alice")
	if err != nil || len(executors) != 1 {
		t.Fatalf("executors=%+v err=%v", executors, err)
	}
	if executors[0].Version != "0.4.9" {
		t.Fatalf("kept version=%s", executors[0].Version)
	}
	for _, jobID := range jobIDs {
		record, err := store.JobForOwner(context.Background(), "alice", jobID)
		if err != nil {
			t.Fatal(err)
		}
		if record.LeaseExecutorID != executors[0].ID {
			t.Fatalf("job %s lease=%s not migrated", jobID, record.LeaseExecutorID)
		}
	}
	again, err := service.ConsolidateExecutors(context.Background())
	if err != nil || again != 0 {
		t.Fatalf("second run=%d err=%v", again, err)
	}
}

func TestListExecutorsExposesRecentFailure(t *testing.T) {
	now := time.Date(2026, 10, 1, 13, 30, 0, 0, time.UTC)
	service := NewService(NewMemoryStore(), func() time.Time { return now })
	token := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.4.9")
	job, err := service.CreateJob(context.Background(), "alice", testJobInput("m-fail", "b-fail"))
	if err != nil {
		t.Fatal(err)
	}
	claim, err := service.Claim(context.Background(), token)
	if err != nil {
		t.Fatal(err)
	}
	lease := LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	if err := service.Fail(context.Background(), token, job.ID, lease,
		FailureInput{Code: "x", Message: "boom"}); err != nil {
		t.Fatal(err)
	}
	executors, err := service.ListExecutors(context.Background(), "alice")
	if err != nil || len(executors) != 1 || executors[0].RecentFailureAt == nil {
		t.Fatalf("executors=%+v err=%v", executors, err)
	}
}
```

注意：`pairExecutorVersion` 在 Task 2 测试文件中定义（同包共享）；内存模式的 `RecentFailures` 从 failed 状态 job 推导。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ -run 'TestConsolidate|TestListExecutorsExposes' -v`
Expected: FAIL。

- [ ] **Step 3: types.go / store.go 扩展**

`ExecutorView` 加字段：

```go
RecentFailureAt *time.Time `json:"recentFailureAt,omitempty"`
```

Store 接口加：

```go
ConsolidateDuplicateExecutors(context.Context, time.Time) (int, error)
RecentFailures(context.Context, string, time.Time) (map[string]time.Time, error)
```

- [ ] **Step 4: 版本比较与选择工具（放 service.go）**

```go
type executorCandidate struct {
	id        string
	version   string
	lastSeen  *time.Time
	updatedAt time.Time
}

func pickKeeping(list []executorCandidate) string {
	target := list[0]
	for _, item := range list[1:] {
		cmp := compareVersion(item.version, target.version)
		if cmp > 0 ||
			(cmp == 0 && compareSeen(item.lastSeen, target.lastSeen) > 0) ||
			(cmp == 0 && compareSeen(item.lastSeen, target.lastSeen) == 0 && item.updatedAt.After(target.updatedAt)) {
			target = item
		}
	}
	return target.id
}

func compareVersion(a, b string) int {
	pa := strings.Split(strings.TrimSpace(a), ".")
	pb := strings.Split(strings.TrimSpace(b), ".")
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		var x, y int
		if i < len(pa) {
			x = atoiOrZero(pa[i])
		}
		if i < len(pb) {
			y = atoiOrZero(pb[i])
		}
		if x != y {
			if x > y {
				return 1
			}
			return -1
		}
	}
	return 0
}

func atoiOrZero(value string) int {
	value = strings.TrimSpace(value)
	out := 0
	for _, r := range value {
		if r < '0' || r > '9' {
			return 0
		}
		out = out*10 + int(r-'0')
	}
	return out
}

func compareSeen(a, b *time.Time) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return -1
	}
	if b == nil {
		return 1
	}
	if a.After(*b) {
		return 1
	}
	if b.After(*a) {
		return -1
	}
	return 0
}
```

（避免引入 strconv；如 service.go 已 import strconv 也可直接用 strconv.Atoi，二选一。）

- [ ] **Step 5: Service 方法**

```go
func (s *Service) ConsolidateExecutors(ctx context.Context) (int, error) {
	return s.store.ConsolidateDuplicateExecutors(ctx, s.now().UTC())
}
```

修改 `ListExecutors`：在构造 views 前查询失败标记，循环中赋值。在 `now := s.now().UTC()` 之后加：

```go
failures, err := s.store.RecentFailures(ctx, owner, now.Add(-FailureCooldown))
if err != nil {
	return nil, err
}
```

构造每个 view 时（原 ExecutorView{...} 后保留全部现有字段）追加：

```go
if value, ok := failures[record.ID]; ok {
	copyValue := value
	views = append(views, ExecutorView{
		ID: record.ID, Name: record.DeviceName, Platform: record.Platform, OS: record.OS,
		Version: record.Version, Online: record.LastSeenAt != nil && !record.LastSeenAt.Before(now.Add(-OnlineThreshold)),
		LastSeenAt: record.LastSeenAt, RecentFailureAt: &copyValue,
	})
	continue
}
```

即把原来单条 append 改为"有/无失败标记"两个分支，无标记分支保持原字段。

- [ ] **Step 6: MySQL 实现合并**

```go
func (s *MySQLStore) ConsolidateDuplicateExecutors(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT owner_username, os, device_name
FROM giant_executors GROUP BY owner_username, os, device_name HAVING COUNT(*) > 1`)
	if err != nil {
		return 0, err
	}
	type groupRow struct{ owner, osName, deviceName string }
	groups := make([]groupRow, 0)
	for rows.Next() {
		var group groupRow
		if err := rows.Scan(&group.owner, &group.osName, &group.deviceName); err != nil {
			rows.Close()
			return 0, err
		}
		groups = append(groups, group)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	merged := 0
	for _, group := range groups {
		if err := s.consolidateOneGroup(ctx, group.owner, group.osName, group.deviceName, now); err != nil {
			return merged, err
		}
		merged++
	}
	return merged, nil
}

func (s *MySQLStore) consolidateOneGroup(ctx context.Context, owner, osName, deviceName string, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id, app_version, last_seen_at, updated_at
FROM giant_executors WHERE owner_username = ? AND os = ? AND device_name = ? ORDER BY id ASC FOR UPDATE`,
		owner, osName, deviceName)
	if err != nil {
		return err
	}
	candidates := make([]executorCandidate, 0)
	for rows.Next() {
		var item executorCandidate
		var lastSeen sql.NullTime
		if err := rows.Scan(&item.id, &item.version, &lastSeen, &item.updatedAt); err != nil {
			rows.Close()
			return err
		}
		if lastSeen.Valid {
			seen := lastSeen.Time
			item.lastSeen = &seen
		}
		candidates = append(candidates, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(candidates) < 2 {
		return err
	}
	keeping := pickKeeping(candidates)
	oldIDs := make([]string, 0, len(candidates)-1)
	for _, item := range candidates {
		if item.id != keeping {
			oldIDs = append(oldIDs, item.id)
		}
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(oldIDs)), ",")
	args := make([]any, 0, len(oldIDs)+1)
	args = append(args, keeping)
	for _, id := range oldIDs {
		args = append(args, id)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE giant_executor_jobs SET lease_executor_id = ? WHERE lease_executor_id IN (`+placeholders+`)`, args...); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE giant_executor_job_events SET executor_id = ? WHERE executor_id IN (`+placeholders+`)`, args...); err != nil {
		return err
	}
	deleteArgs := make([]any, 0, len(oldIDs))
	for _, id := range oldIDs {
		deleteArgs = append(deleteArgs, id)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM giant_executors WHERE id IN (`+placeholders+`)`, deleteArgs...); err != nil {
		return err
	}
	return tx.Commit()
}
```

- [ ] **Step 7: MySQL RecentFailures**

```go
func (s *MySQLStore) RecentFailures(ctx context.Context, owner string, since time.Time) (map[string]time.Time, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT executor_id, MAX(created_at)
FROM giant_executor_job_events
WHERE event_type = 'failed' AND created_at >= ?
AND executor_id IN (SELECT id FROM giant_executors WHERE owner_username = ?)
GROUP BY executor_id`, since, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]time.Time)
	for rows.Next() {
		var id string
		var value time.Time
		if err := rows.Scan(&id, &value); err != nil {
			return nil, err
		}
		out[id] = value
	}
	return out, rows.Err()
}
```

- [ ] **Step 8: Memory 实现**

```go
func (s *MemoryStore) ConsolidateDuplicateExecutors(_ context.Context, now time.Time) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	type groupKey struct {
		owner, osName, deviceName string
	}
	groups := make(map[groupKey][]executorCandidate)
	for id, item := range s.executors {
		key := groupKey{item.OwnerUsername, item.OS, item.DeviceName}
		groups[key] = append(groups[key], executorCandidate{
			id: id, version: item.Version, lastSeen: item.LastSeenAt, updatedAt: item.UpdatedAt,
		})
	}
	merged := 0
	for _, candidates := range groups {
		if len(candidates) < 2 {
			continue
		}
		keeping := pickKeeping(candidates)
		for _, item := range candidates {
			if item.id == keeping {
				continue
			}
			for _, job := range s.jobs {
				if job.LeaseExecutorID == item.id {
					job.LeaseExecutorID = keeping
					s.jobs[job.ID] = job
				}
			}
			delete(s.executors, item.id)
			merged++
		}
	}
	return merged, nil
}

func (s *MemoryStore) RecentFailures(_ context.Context, owner string, since time.Time) (map[string]time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]time.Time)
	for executorID, failedAt := range s.lastFailure {
		if failedAt.Before(since) {
			continue
		}
		executor, ok := s.executors[executorID]
		if !ok || executor.OwnerUsername != owner {
			continue
		}
		out[executorID] = failedAt
	}
	return out, nil
}
```

- [ ] **Step 9: app.go 启动调用**

在 `backend/internal/app/app.go` 中 giantMaterialExecutorService 创建行（约 45 行）之后加：

```go
if _, err := giantMaterialExecutorService.ConsolidateExecutors(ctx); err != nil {
	return nil, err
}
```

- [ ] **Step 10: 跑测试 + 回归**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ -v`
Expected: PASS。
Run: `cd backend; go build ./...`
Expected: 无错误。

- [ ] **Step 11: 提交**

```bash
git add backend/
git commit -m "巨量执行器启动幂等合并重复设备且列表返回近5分钟失败标记"
```

---

### Task 5: 删除设备（接口 + 任务自动回队）

**Files:**
- Modify: `backend/internal/giantmaterialexecutor/types.go`
- Modify: `backend/internal/giantmaterialexecutor/store.go`
- Modify: `backend/internal/giantmaterialexecutor/service.go`
- Modify: `backend/internal/giantmaterialexecutor/mysql_store.go`
- Modify: `backend/internal/giantmaterialexecutor/memory_store.go`
- Modify: `backend/internal/httpapi/giant_material_executor.go`
- Test: `backend/internal/giantmaterialexecutor/delete_executor_test.go`

**Interfaces:**
- Produces: `Service.DeleteExecutor(ctx, owner, id) error`；Store 新增 `DeleteExecutor(ctx, owner, id, now) error`；新错误 `ErrExecutorNotFound`；HTTP `DELETE /api/shuihuo-production/giant-material-executors/{id}`。

- [ ] **Step 1: 写失败测试**

Create `backend/internal/giantmaterialexecutor/delete_executor_test.go`:

```go
package giantmaterialexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDeleteExecutorReleasesActiveJobAndDisappears(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	pairing, err := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	paired, err := service.Pair(context.Background(), PairInput{
		Code: pairing.Code, Platform: PlatformGiantMaterial,
		DeviceName: "win-box", OS: "windows", Version: "0.4.9",
	})
	if err != nil {
		t.Fatal(err)
	}
	job, err := service.CreateJob(context.Background(), "alice", testJobInput("m-del", "b-del"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Claim(context.Background(), paired.Token); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteExecutor(context.Background(), "alice", paired.ExecutorID); err != nil {
		t.Fatal(err)
	}
	record, err := service.GetJob(context.Background(), "alice", job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if record.State != JobQueued || record.LeaseExecutorID != "" {
		t.Fatalf("record state=%s lease=%s", record.State, record.LeaseExecutorID)
	}
	if err := service.DeleteExecutor(context.Background(), "alice", paired.ExecutorID); !errors.Is(err, ErrExecutorNotFound) {
		t.Fatalf("second delete error=%v", err)
	}
}

func TestDeleteExecutorRejectsOtherOwner(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	pairing, _ := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	paired, _ := service.Pair(context.Background(), PairInput{
		Code: pairing.Code, Platform: PlatformGiantMaterial,
		DeviceName: "win-box", OS: "windows", Version: "0.4.9",
	})
	if err := service.DeleteExecutor(context.Background(), "bob", paired.ExecutorID); !errors.Is(err, ErrExecutorNotFound) {
		t.Fatalf("other owner error=%v", err)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ -run TestDeleteExecutor -v`
Expected: FAIL。

- [ ] **Step 3: 错误与接口**

types.go errors 组加：

```go
ErrExecutorNotFound = errors.New("giant material executor not found")
```

store.go 接口加：

```go
DeleteExecutor(context.Context, string, string, time.Time) error
```

- [ ] **Step 4: Service 方法**

```go
func (s *Service) DeleteExecutor(ctx context.Context, owner, id string) error {
	owner = strings.TrimSpace(owner)
	id = strings.TrimSpace(id)
	if owner == "" || id == "" {
		return ErrInvalidInput
	}
	return s.store.DeleteExecutor(ctx, owner, id, s.now().UTC())
}
```

- [ ] **Step 5: MySQL 实现**

```go
func (s *MySQLStore) DeleteExecutor(ctx context.Context, owner, id string, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var dbOwner string
	err = tx.QueryRowContext(ctx, `SELECT owner_username FROM giant_executors WHERE id = ? FOR UPDATE`, id).Scan(&dbOwner)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrExecutorNotFound
	}
	if err != nil {
		return err
	}
	if dbOwner != owner {
		return ErrExecutorNotFound
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM giant_executor_jobs
WHERE lease_executor_id = ? AND state NOT IN (?, ?, ?) FOR UPDATE`,
		id, JobSucceeded, JobFailed, JobCancelled)
	if err != nil {
		return err
	}
	jobIDs := make([]string, 0)
	for rows.Next() {
		var jobID string
		if err := rows.Scan(&jobID); err != nil {
			rows.Close()
			return err
		}
		jobIDs = append(jobIDs, jobID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, jobID := range jobIDs {
		if _, err := tx.ExecContext(ctx, `UPDATE giant_executor_jobs
SET state = 'queued', cancel_requested = FALSE, lease_executor_id = NULL, lease_token_hash = NULL,
 lease_expires_at = NULL, lease_generation = lease_generation + 1,
 progress_completed = 0, progress_total = 0, progress_percent = 0, progress_changed_at = NULL,
 error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?`, now, jobID); err != nil {
			return err
		}
		if err := appendEvent(ctx, tx, jobID, "", "requeued", JobQueued, "", now); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM giant_executors WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}
```

- [ ] **Step 6: Memory 实现**

```go
func (s *MemoryStore) DeleteExecutor(_ context.Context, owner, id string, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.executors[id]
	if !ok || record.OwnerUsername != owner {
		return ErrExecutorNotFound
	}
	delete(s.tokens, secretHashKey(record.TokenHash))
	for jobID, job := range s.jobs {
		terminal := false
		switch job.State {
		case JobSucceeded, JobFailed, JobCancelled:
			terminal = true
		}
		if job.LeaseExecutorID == id && !terminal {
			job.State = JobQueued
			job.CancelRequested = false
			job.LeaseExecutorID = ""
			job.LeaseTokenHash = SecretHash{}
			job.LeaseExpiresAt = nil
			job.LeaseGeneration++
			job.Progress = ProgressInput{}
			job.ErrorCode = ""
			job.ErrorMessage = ""
			job.UpdatedAt = now
			s.jobs[jobID] = job
			delete(s.progressChanged, jobID)
		}
	}
	delete(s.executors, id)
	delete(s.lastFailure, id)
	return nil
}
```

- [ ] **Step 7: HTTP 路由 + 错误映射**

在 RegisterGiantMaterialExecutorRoutes 中加：

```go
root.Handle("DELETE /api/shuihuo-production/giant-material-executors/{id}", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
	identity, ok := BridgeIdentityFromContext(req.Context())
	if !ok {
		writeGiantExecutorError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err := service.DeleteExecutor(req.Context(), identity.Username, req.PathValue("id")); err != nil {
		writeGiantExecutorServiceError(w, err)
		return
	}
	writeGiantExecutorJSON(w, http.StatusOK, map[string]any{"ok": true})
})))
```

在 `writeGiantExecutorServiceError` 中加分支：

```go
case errors.Is(err, giantmaterialexecutor.ErrExecutorNotFound):
	writeGiantExecutorError(w, http.StatusNotFound, err.Error())
```

- [ ] **Step 8: 跑测试 + 回归**

Run: `cd backend; go test ./internal/giantmaterialexecutor/ -v`
Expected: PASS。
Run: `cd backend; go build ./...`
Expected: 无错误。

- [ ] **Step 9: 提交**

```bash
git add backend/
git commit -m "巨量执行器可删除且其未完成任务自动重新排队"
```

---

### Task 6: 前端（偏好切换 + 删除设备 + 双平台状态条）

**Files:**
- Modify: `frontend/src/shared/api/giantMaterialExecutorPublic.js`
- Modify: `frontend/src/user/pages/SettingsPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go`（仅源码，不打包）
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.source.test.js`
- Test: `frontend/src/user/pages/SettingsPageGiant.source.test.js`

**Interfaces:**
- Consumes: 后端 GET/PUT preference、DELETE executor、executors 列表中每条的 `os/online/recentFailureAt`。

- [ ] **Step 1: 写源码级失败测试**

Create `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.source.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryGiantMaterialExecutorStatus.jsx'), 'utf8');

test('dot status renders windows and macos separately', () => {
  assert.match(source, /gme-platform-pill/);
  assert.match(source, /Windows/);
  assert.match(source, /macOS/);
  assert.match(source, /getGiantExecutorPreference/);
});
```

Create `frontend/src/user/pages/SettingsPageGiant.source.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'SettingsPage.jsx'), 'utf8');

test('settings offers platform preference and per-executor delete', () => {
  assert.match(source, /优先读取平台/);
  assert.match(source, /saveGiantExecutorPreference/);
  assert.match(source, /deleteGiantMaterialExecutor/);
  assert.match(source, /Segmented/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend; node --test src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.source.test.js src/user/pages/SettingsPageGiant.source.test.js`
Expected: FAIL。

- [ ] **Step 3: API 客户端加函数**

在 `giantMaterialExecutorPublic.js` 末尾加：

```js
const PREFERENCE_PATH = '/api/shuihuo-production/giant-material-executor/preference';

export function getGiantExecutorPreference() {
  return apiRequest(PREFERENCE_PATH);
}

export function saveGiantExecutorPreference(preferredOs) {
  return apiRequest(PREFERENCE_PATH, {
    method: 'PUT',
    body: JSON.stringify({ preferredOs: String(preferredOs || 'windows') })
  });
}

export function deleteGiantMaterialExecutor(executorId) {
  return apiRequest(`${EXECUTORS_PATH}/${encodeURIComponent(executorId)}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: SettingsPage 接入**

先 Read `SettingsPage.jsx`，定位"巨量素材执行器/读取通道"区块与现有 giant executor 数据加载函数。

import 增加：

```jsx
import { Segmented, Popconfirm } from 'antd';
import {
  listGiantMaterialExecutors,
  getGiantExecutorPreference,
  saveGiantExecutorPreference,
  deleteGiantMaterialExecutor
} from '../shared/api/giantMaterialExecutorPublic.js';
```

（按现有 import 路径风格调整相对路径；不破坏已有 import。）

状态（与现有 giant 状态并列）：

```jsx
const [giantPreference, setGiantPreference] = useState({ preferredOs: 'windows' });
```

在现有加载 executor 列表的函数中追加：

```js
const prefResp = await getGiantExecutorPreference();
setGiantPreference({ preferredOs: prefResp?.preferredOs || 'windows' });
```

处理函数：

```js
const changeGiantPreference = async (value) => {
  const previous = giantPreference?.preferredOs || 'windows';
  if (value === previous) return;
  setGiantPreference({ preferredOs: value });
  try {
    const saved = await saveGiantExecutorPreference(value);
    setGiantPreference({ preferredOs: saved?.preferredOs || value });
  } catch (error) {
    setGiantPreference({ preferredOs: previous });
    message.error('偏好保存失败，请重试');
  }
};

const removeGiantExecutor = async (executorId) => {
  await deleteGiantMaterialExecutor(executorId);
  message.success('设备已删除，未完成任务已重新排队');
  // 调用现有的 executor 列表刷新函数（按该函数实际名称替换）
  await refreshGiantExecutors();
};
```

（选项不加 disabled，保存失败回滚显示并提示，符合全局约束。）

设备清单上方插入：

```jsx
<div className="settings-giant-preference">
  <span className="settings-giant-preference-label">优先读取平台</span>
  <Segmented size="small" value={giantPreference?.preferredOs || 'windows'}
    options={[{ label: 'Windows', value: 'windows' }, { label: 'macOS', value: 'darwin' }]}
    onChange={changeGiantPreference} />
  {giantPreferenceHint ? <span className="settings-giant-preference-hint">{giantPreferenceHint}</span> : null}
</div>
```

提示语计算（放在 render 内，使用现有 executor 列表变量名替换 `giantExecutors`）：

```js
const giantPreferenceHint = (() => {
  const selected = giantPreference?.preferredOs || 'windows';
  const devices = giantExecutors.filter(item => String(item.os || '').toLowerCase() === selected);
  const label = selected === 'darwin' ? 'macOS' : 'Windows';
  const fallback = selected === 'darwin' ? 'Windows' : 'macOS';
  if (!devices.length) return `当前没有绑定的 ${label} 设备，任务仍会交给 ${fallback}`;
  if (devices.some(item => item.recentFailureAt)) return `${label} 刚读取失败（冷却中），任务暂交给 ${fallback}`;
  if (!devices.some(item => item.online)) return `${label} 当前离线，任务仍会交给 ${fallback}`;
  return '';
})();
```

每条设备行内加删除入口（保持与现有行布局一致）：

```jsx
<Popconfirm title="确定删除这台设备吗？未完成的任务会自动重新排队。"
  okText="删除" cancelText="取消" onConfirm={() => removeGiantExecutor(executor.id)}>
  <Button size="small" type="text" danger>删除</Button>
Popconfirm>
```

- [ ] **Step 5: dot 状态条改双平台**

Read `BatchFactoryGiantMaterialExecutorStatus.jsx`。改动四处：

1. 顶部 import 加 `getGiantExecutorPreference`。
2. 新增状态：

```jsx
const [backendExecutorList, setBackendExecutorList] = useState([]);
const [preference, setPreference] = useState({ preferredOs: 'windows' });
```

3. 在现有轮询 executor 列表的 effect 中，成功拿到 payload 后追加（保留现有 setBackendOnline 逻辑不动）：

```js
setBackendExecutorList(Array.isArray(payload.executors) ? payload.executors : []);
```

新增偏好轮询 effect：

```jsx
useEffect(() => {
  let active = true;
  const load = async () => {
    try {
      const value = await getGiantExecutorPreference();
      if (active) setPreference({ preferredOs: value?.preferredOs || 'windows' });
    } catch { /* 静默，下一周期重试 */ }
  };
  load();
  const timer = setInterval(load, 10000);
  return () => { active = false; clearInterval(timer); };
}, []);
```

4. 用以下块替换现有 dot 变体（variant === 'dot'）的整个 JSX return：

```jsx
const platformGroups = {
  windows: { online: false, cooling: false },
  darwin: { online: false, cooling: false }
};
for (const item of backendExecutorList) {
  const key = String(item.os || '').toLowerCase();
  if (!platformGroups[key]) continue;
  if (item.online) platformGroups[key].online = true;
  if (item.recentFailureAt) platformGroups[key].cooling = true;
}
if (health === 'online') {
  platformGroups.windows.online = true; // 本机客户端存活的兜底显示
}
const preferred = preference?.preferredOs || 'windows';
const preferredLabel = preferred === 'darwin' ? 'macOS' : 'Windows';
const fallbackLabel = preferred === 'darwin' ? 'Windows' : 'macOS';
let suffix = `优先：${preferredLabel}`;
if (platformGroups[preferred].cooling) {
  suffix = `优先：${preferredLabel}（冷却中，暂用 ${fallbackLabel}）`;
} else if (!platformGroups[preferred].online) {
  suffix = `优先：${preferredLabel}（离线，暂用 ${fallbackLabel}）`;
}
return (
  <span className="gme-executor-dot is-dual">
    <span className={`gme-platform-pill${platformGroups.windows.online ? ' is-online' : ''}${platformGroups.windows.cooling ? ' is-cooling' : ''}`}>
      <i />Windows
    </span>
    <span className={`gme-platform-pill${platformGroups.darwin.online ? ' is-online' : ''}${platformGroups.darwin.cooling ? ' is-cooling' : ''}`}>
      <i />macOS
    </span>
    <span className="gme-executor-dot-version">{suffix}</span>
  </span>
);
```

（注意把这段计算放在组件函数体内、现有 alert 等分支的 return 之前不影响其他变体；仅替换 dot 分支。）

- [ ] **Step 6: 执行器 Mac 设备名改"电脑名/用户名"（只改源码，不打包）**

Read `giant-material-executor/cmd/giant-material-executor/main.go` 的 `localDeviceName()`，替换为：

```go
func localDeviceName() string {
	if current, err := user.Current(); err == nil && strings.TrimSpace(current.Username) != "" {
		if runtime.GOOS == "darwin" {
			if hostname, hostErr := os.Hostname(); hostErr == nil && strings.TrimSpace(hostname) != "" {
				return strings.TrimSpace(hostname) + "/" + strings.TrimSpace(current.Username)
			}
		}
		return current.Username
	}
	if hostname, err := os.Hostname(); err == nil && strings.TrimSpace(hostname) != "" {
		return hostname
	}
	return "giant-executor"
}
```

（`runtime` 已在该文件 import；Windows 分支行为不变。只改源码，本次不生成 Mac/Win 安装包。）
验证编译：`cd giant-material-executor; go build ./cmd/giant-material-executor/`
Expected: 无错误；不打包、不发布。

- [ ] **Step 7: CSS**

在 `frontend/src/user/pages/shuihuo-production.css` 末尾追加：

```css
.gme-executor-dot.is-dual {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.gme-platform-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--sh-text-muted, #8b98a5);
}
.gme-platform-pill i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5b6b79;
  display: inline-block;
}
.gme-platform-pill.is-online {
  color: #cfe8d8;
}
.gme-platform-pill.is-online i {
  background: #52c41a;
  box-shadow: 0 0 6px rgba(82, 196, 26, 0.55);
}
.gme-platform-pill.is-cooling {
  color: #ffd591;
}
.gme-platform-pill.is-cooling i {
  background: #faad14;
}
.gme-executor-dot-version {
  font-size: 12px;
  color: var(--sh-text-muted, #8b98a5);
}
.settings-giant-preference {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 6px 0 8px;
}
.settings-giant-preference-label {
  font-size: 13px;
  color: var(--sh-text, #d9e2ec);
}
.settings-giant-preference-hint {
  color: #d48806;
  font-size: 12px;
}
```

- [ ] **Step 8: 跑测试 + 构建**

Run: `cd frontend; node --test src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.source.test.js src/user/pages/SettingsPageGiant.source.test.js`
Expected: PASS。
Run: `cd frontend; npm run build`
Expected: 构建成功。

- [ ] **Step 9: 回归既有前端测试**

Run: `cd frontend; node --test src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`
Expected: PASS（既有断言不受影响）。

- [ ] **Step 10: 提交**

```bash
git add frontend/ giant-material-executor/
git commit -m "设置页可切换Windows/macOS优先平台与删除设备顶部条双平台显示"
```

---

### Task 7: 全分支终审 + Go/Node 增量部署与公网验证

**Files:** 无代码改动（除非终审发现必须修复项）。

**Interfaces:** 无。

- [ ] **Step 1: 全分支代码终审**

控制器派最终审查代理，范围：`387de920..HEAD`（Task 1-6 全部提交），按"正确性 / 并发安全 / 与设计文档一致性 / 命名与可维护性"审查；发现问题：一次修复派发 + 定向复审；残留项逐条裁定并记入台账。

- [ ] **Step 2: 确认待发布 SHA 与回滚点**

```bash
git log --oneline 387de920..HEAD
git rev-parse HEAD
```

回滚点：当前公网版本 `d03dd75e`（镜像 `local/qiantie-v88-node:d03dd75e-v88`；Go 侧记录当前线上 go-api 版本，部署时先备份）。

- [ ] **Step 3: 推送 v88**

```bash
git push origin v88
```

- [ ] **Step 4: 部署前安全检查（执行器无在跑任务）**

服务器 MySQL 执行：

```sql
SELECT id, state FROM giant_executor_jobs WHERE state IN ('queued','leased','running','cleaning','uploading');
```

如有用户正在跑的任务，等待完成或与用户确认后再部署。

- [ ] **Step 5: Go 侧构建部署**

按仓库现有 Go 部署脚本执行（部署时先 Read `v88_deploy_buildgo.py` 及相关脚本，严格沿用，不自造流程）：Linux 交叉编译 → 精确 SHA 部署 go-api → 重启 Go 服务 → 迁移自动执行（建偏好表、加 progress_changed_at 列）。

验证 Go：

```bash
curl -s https://115.190.156.223/api/shuihuo-production/giant-material-executor/preference -H "Authorization: Bearer <token>"
```

Expected: `{"preferredOs":"windows"}`；SHOW COLUMNS FROM giant_executor_jobs LIKE 'progress_changed_at' 存在。

- [ ] **Step 6: Node 镜像增量构建（整目录覆盖，禁止手挑文件）**

基础镜像：`local/qiantie-v88-node:d03dd75e-v88`；从精确 SHA 整目录覆盖 `app.js server.js index.html package.json lib/ middleware/ pets/ prompts/ public/ routes/ frontend/dist/`（依赖不变可不碰 node_modules）；标签 `local/qiantie-v88-node:<新SHA>-v88`，按现有发布脚本切量。

- [ ] **Step 7: 公网验证清单**

1. `curl -I https://<域名>/` → 200。
2. Ctrl+Shift+R 打开设置页：重复设备已合并（4→1），有 Windows/macOS 切换和删除按钮。
3. Win 执行器在线时新建巨量批量：顶部条显示 `Windows 在线 / macOS 离线 / 优先：Windows`，任务正常派发。
4. 普通书城新建批量回归一次。
5. 记录发布 SHA、验证结果到项目执行记忆。

- [ ] **Step 8: 清理 SDD 工作区**

终审与发布均干净后：删除本计划 `.superpowers/sdd/2026-10-01-giant-material-executor-platform-switch/` 工作区，按 finishing-a-development-branch 收尾（已在 v88 主干，无需合并动作）。

---

## Self-Review 记录（计划作者自查）

- Spec 覆盖：偏好存储(T1)、claim 判定在线/冷却/离线(T2)、试岗恢复(T2)、进行中不抢(T2 既有租约机制+测试)、配对认设备(T3)、一次性合并(T4)、删除设备(T5)、设备名 Mac 规则——见下注；设置页/顶部条(T6)、验收与发布(T7) 均有对应任务。
- 注：设计 §6.4 的 Mac 设备名"电脑名+用户名"源码改动已落入 Task 6 Step 6（`giant-material-executor/cmd/giant-material-executor/main.go`，仅源码不打包；Windows 行为不变）。
- 类型/命名一致性：`PreferenceView.PreferredOS`（Go）/ `preferredOs`（JSON）、`ExecutorView.RecentFailureAt`（Go）/ `recentFailureAt`（JSON）、Store 方法名在各任务间统一。
- 已知边界（设计已确认）：内存 Store 用进程内失败台账（`lastFailure`）保留失败事实，重启进程后丢失（仅测试/本地模式；MySQL 事件表持久）；删除设备后其历史失败与平台的关联不再可查。
