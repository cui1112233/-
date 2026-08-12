package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"qiantie/backend/internal/auth"
	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	shuihuotasks "qiantie/backend/internal/shuihuo/tasks"
	"qiantie/backend/internal/store"
)

type memoryUserStore struct {
	users map[int64]store.User
}

func (s *memoryUserStore) FindByUsername(_ context.Context, username string) (store.User, error) {
	for _, user := range s.users {
		if user.Username == username {
			return user, nil
		}
	}
	return store.User{}, sql.ErrNoRows
}

func (s *memoryUserStore) FindByID(_ context.Context, id int64) (store.User, error) {
	user, ok := s.users[id]
	if !ok {
		return store.User{}, sql.ErrNoRows
	}
	return user, nil
}

func newShuihuoTestAPI(t *testing.T, users map[int64]store.User) (*API, string) {
	t.Helper()
	const secret = "test-secret"
	return New(Dependencies{
		TokenSecret: secret,
		Users:       &memoryUserStore{users: users},
	}), secret
}

func authorizedRequest(t *testing.T, secret string, user store.User, method, path string) *http.Request {
	t.Helper()
	token, err := auth.NewToken(secret, user.ID, user.Username)
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	return req
}

func TestShuihuoProjectsRequiresAuthentication(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, nil)
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/projects", nil))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET projects status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestAdminModelsRejectsActiveNonOwner(t *testing.T) {
	user := store.User{ID: 7, Username: "member", IsActive: true}
	api, secret := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, authorizedRequest(t, secret, user, http.MethodGet, "/api/admin/models"))

	if response.Code != http.StatusForbidden {
		t.Fatalf("GET admin models status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestAdminModelsReturnsEmptyArrayForOwner(t *testing.T) {
	user := store.User{ID: 8, Username: "owner", IsOwner: true, IsActive: true}
	api, secret := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, authorizedRequest(t, secret, user, http.MethodGet, "/api/admin/models"))

	if response.Code != http.StatusOK {
		t.Fatalf("GET admin models status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Models []json.RawMessage `json:"models"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Models == nil || len(payload.Models) != 0 {
		t.Fatalf("models = %#v, want empty array", payload.Models)
	}
}

func TestShuihuoProjectsReturnsEmptyArrayForCurrentUser(t *testing.T) {
	user := store.User{ID: 9, Username: "producer", IsActive: true}
	api, secret := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, authorizedRequest(t, secret, user, http.MethodGet, "/api/shuihuo-production/projects"))

	if response.Code != http.StatusOK {
		t.Fatalf("GET projects status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Projects []json.RawMessage `json:"projects"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Projects == nil || len(payload.Projects) != 0 {
		t.Fatalf("projects = %#v, want empty array", payload.Projects)
	}
}

func TestRequireAuthRejectsInactiveAccount(t *testing.T) {
	user := store.User{ID: 11, Username: "inactive", IsActive: false}
	api, secret := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, authorizedRequest(t, secret, user, http.MethodGet, "/api/shuihuo-production/projects"))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET projects for inactive user status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestLoginRejectsInactiveAccountBeforeIssuingToken(t *testing.T) {
	password := "correct-password"
	user := store.User{
		ID:           12,
		Username:     "disabled-user",
		PasswordHash: auth.HashPassword(password),
		IsActive:     false,
	}
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, httptest.NewRequest(
		http.MethodPost,
		"/api/login",
		bytes.NewBufferString(`{"username":"disabled-user","password":"correct-password"}`),
	))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("POST login for inactive user status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := payload["token"]; ok {
		t.Fatalf("inactive login response unexpectedly includes token: %#v", payload)
	}
}

func TestBatchTasksRequirePlatformAuthentication(t *testing.T) {
	api := New(Dependencies{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/shuihuo-production/projects/1/tasks/batch", strings.NewReader(`{"segmentIds":[11],"kind":"image","modelId":7}`)))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("POST batch tasks status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestBatchTasksRejectInvalidRequestBeforeCreatingTasks(t *testing.T) {
	tooManySegmentIDs := make([]int64, 51)
	for index := range tooManySegmentIDs {
		tooManySegmentIDs[index] = int64(index + 1)
	}
	for _, tc := range []struct {
		name       string
		segmentIDs []int64
		kind       string
		modelID    int64
	}{
		{name: "empty segments", segmentIDs: nil, kind: "image", modelID: 7},
		{name: "duplicate segments", segmentIDs: []int64{11, 11}, kind: "image", modelID: 7},
		{name: "too many segments", segmentIDs: tooManySegmentIDs, kind: "image", modelID: 7},
		{name: "unsupported kind", segmentIDs: []int64{11}, kind: "unknown", modelID: 7},
		{name: "export is not a generation task", segmentIDs: []int64{11}, kind: "export", modelID: 7},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api, queue := newBatchTaskTestAPI(t)
			response := requestBatchTasks(t, api, tc.segmentIDs, tc.kind, tc.modelID)

			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "任务参数无效") {
				t.Fatalf("batch = %d %s", response.Code, response.Body.String())
			}
			if len(queue.ids) != 0 {
				t.Fatalf("queued tasks = %#v, want none", queue.ids)
			}
		})
	}
}

func TestBatchTasksReturnsOneResultPerRequestedSegmentInRequestOrder(t *testing.T) {
	api, queue := newBatchTaskTestAPI(t)
	response := requestBatchTasks(t, api, []int64{12, 11}, "image", 7)

	if response.Code != http.StatusCreated {
		t.Fatalf("batch = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Results []struct {
			SegmentID int64        `json:"segmentId"`
			Task      *domain.Task `json:"task"`
			Error     string       `json:"error"`
		} `json:"results"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode batch response: %v", err)
	}
	if len(payload.Results) != 2 || payload.Results[0].SegmentID != 12 || payload.Results[1].SegmentID != 11 {
		t.Fatalf("results = %#v, want request order", payload.Results)
	}
	for _, result := range payload.Results {
		if result.Task == nil || result.Task.Status != domain.TaskQueued || result.Error != "" {
			t.Fatalf("result = %#v, want queued task without error", result)
		}
	}
	if len(queue.ids) != 2 {
		t.Fatalf("queued tasks = %#v, want two", queue.ids)
	}
}

func TestBatchTasksReturnsPartialResultsWithoutRollingBackSuccessfulTasks(t *testing.T) {
	api, queue := newBatchTaskTestAPI(t)
	response := requestBatchTasks(t, api, []int64{11, 99}, "image", 7)

	if response.Code != http.StatusMultiStatus {
		t.Fatalf("batch = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Results []struct {
			SegmentID int64        `json:"segmentId"`
			Task      *domain.Task `json:"task"`
			Error     string       `json:"error"`
		} `json:"results"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode batch response: %v", err)
	}
	if len(payload.Results) != 2 || payload.Results[0].Task == nil || payload.Results[1].Task != nil || payload.Results[1].Error != "分段不存在" {
		t.Fatalf("results = %#v, want one queued task and one safe error", payload.Results)
	}
	if len(queue.ids) != 1 {
		t.Fatalf("queued tasks = %#v, want successful task preserved", queue.ids)
	}
}

func requestBatchTasks(t *testing.T, api *API, segmentIDs []int64, kind string, modelID int64) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/shuihuo-production/projects/1/tasks/batch"
	req := batchTaskBridgeRequest(t, http.MethodPost, path, "producer", false)
	body, err := json.Marshal(map[string]any{"segmentIds": segmentIDs, "kind": kind, "modelId": modelID})
	if err != nil {
		t.Fatalf("marshal batch request: %v", err)
	}
	req.Body = io.NopCloser(strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)
	return response
}

func batchTaskBridgeRequest(t *testing.T, method, requestPath, username string, isOwner bool) *http.Request {
	t.Helper()
	issuedAt := strconv.FormatInt(time.Now().Unix(), 10)
	payload := strings.Join([]string{username, issuedAt, strconv.FormatBool(isOwner), method, requestPath}, "\n")
	mac := hmac.New(sha256.New, []byte("batch-task-test-secret"))
	_, _ = mac.Write([]byte(payload))
	req := httptest.NewRequest(method, requestPath, nil)
	req.Header.Set("X-Qiantie-Username", username)
	req.Header.Set("X-Qiantie-Is-Owner", strconv.FormatBool(isOwner))
	req.Header.Set("X-Qiantie-Issued-At", issuedAt)
	req.Header.Set("X-Qiantie-Signature", hex.EncodeToString(mac.Sum(nil)))
	return req
}

type batchTaskQueue struct{ ids []int64 }

func (q *batchTaskQueue) Enqueue(_ context.Context, taskID int64) error {
	q.ids = append(q.ids, taskID)
	return nil
}
func (q *batchTaskQueue) Dequeue(context.Context, time.Duration) (int64, error) {
	return 0, fmt.Errorf("not implemented")
}

var _ shuihuotasks.Queue = (*batchTaskQueue)(nil)

const batchTaskTestDriverName = "qiantie-httpapi-batch-task-test"

var (
	registerBatchTaskTestDriver sync.Once
	batchTaskTestState          *batchTaskState
)

type batchTaskState struct {
	projects map[int64]domain.Project
	segments map[int64]domain.Segment
	model    models.Definition
	nextTask int64
}

func newBatchTaskTestAPI(t *testing.T) (*API, *batchTaskQueue) {
	t.Helper()
	registerBatchTaskTestDriver.Do(func() { sql.Register(batchTaskTestDriverName, batchTaskTestDriver{}) })
	batchTaskTestState = &batchTaskState{
		projects: map[int64]domain.Project{1: {ID: 1, UserID: 100, Name: "当前项目"}},
		segments: map[int64]domain.Segment{
			11: {ID: 11, ProjectID: 1, Confirmed: true, ImagePrompt: "雨夜车站"},
			12: {ID: 12, ProjectID: 1, Confirmed: true, ImagePrompt: "车门打开"},
			99: {ID: 99, ProjectID: 2, Confirmed: true, ImagePrompt: "其他项目"},
		},
		model: models.Definition{ID: 7, VersionID: 8, Name: "即梦", Kind: models.KindImage, AdapterKind: models.AdapterJimengImage, Enabled: true},
	}
	db, err := sql.Open(batchTaskTestDriverName, "")
	if err != nil {
		t.Fatalf("open batch task test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	queue := &batchTaskQueue{}
	api := New(Dependencies{
		DB:           db,
		BridgeSecret: "batch-task-test-secret",
		Queue:        queue,
		Users:        &batchTaskUserStore{users: map[string]store.User{}},
	})
	return api, queue
}

type batchTaskUserStore struct {
	users map[string]store.User
}

func (s *batchTaskUserStore) FindByUsername(_ context.Context, username string) (store.User, error) {
	user, ok := s.users[username]
	if !ok {
		return store.User{}, sql.ErrNoRows
	}
	return user, nil
}

func (s *batchTaskUserStore) FindByID(_ context.Context, id int64) (store.User, error) {
	for _, user := range s.users {
		if user.ID == id {
			return user, nil
		}
	}
	return store.User{}, sql.ErrNoRows
}

func (s *batchTaskUserStore) EnsureBridgeUser(_ context.Context, username string, isOwner bool) (store.User, error) {
	if user, ok := s.users[username]; ok {
		return user, nil
	}
	user := store.User{ID: 100, Username: username, IsOwner: isOwner, IsActive: true}
	s.users[username] = user
	return user, nil
}

type batchTaskTestDriver struct{}

func (batchTaskTestDriver) Open(string) (driver.Conn, error) { return batchTaskTestConn{}, nil }

type batchTaskTestConn struct{}

func (batchTaskTestConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (batchTaskTestConn) Close() error                        { return nil }
func (batchTaskTestConn) Begin() (driver.Tx, error)           { return batchTaskTestTx{}, nil }
func (batchTaskTestConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return batchTaskTestTx{}, nil
}
func (batchTaskTestConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return batchTaskTestExec(query, args)
}
func (batchTaskTestConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return batchTaskTestQuery(query, args)
}

type batchTaskTestTx struct{}

func (batchTaskTestTx) Commit() error   { return nil }
func (batchTaskTestTx) Rollback() error { return nil }
func (batchTaskTestTx) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return batchTaskTestExec(query, args)
}

func batchTaskTestExec(query string, args []driver.NamedValue) (driver.Result, error) {
	query = compactBatchTaskSQL(query)
	switch {
	case strings.HasPrefix(query, "INSERT INTO shuihuo_tasks"):
		batchTaskTestState.nextTask++
		return batchTaskResult{id: batchTaskTestState.nextTask, rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_tasks t JOIN shuihuo_projects p ON p.id = t.project_id SET t.status = ?"):
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_task_events"):
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE t FROM shuihuo_tasks"):
		return batchTaskResult{rows: 1}, nil
	default:
		return nil, fmt.Errorf("unexpected batch task exec query: %s", query)
	}
}

func batchTaskTestQuery(query string, args []driver.NamedValue) (driver.Rows, error) {
	query = compactBatchTaskSQL(query)
	switch {
	case strings.Contains(query, "FROM shuihuo_projects") && strings.Contains(query, "WHERE id = ? AND user_id = ?"):
		project, ok := batchTaskTestState.projects[args[0].Value.(int64)]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &batchTaskRows{columns: projectColumns}, nil
		}
		return &batchTaskRows{columns: projectColumns, values: [][]driver.Value{{project.ID, project.UserID, project.Name, "", "", "confirmed", int64(1), time.Now(), time.Now()}}}, nil
	case strings.Contains(query, "FROM shuihuo_segments s JOIN shuihuo_projects p"):
		segment, ok := batchTaskTestState.segments[args[0].Value.(int64)]
		if !ok {
			return &batchTaskRows{columns: segmentColumns}, nil
		}
		return &batchTaskRows{columns: segmentColumns, values: [][]driver.Value{{segment.ID, segment.ProjectID, "", segment.SubtitleText, int64(1), segment.Confirmed, false, segment.ImagePrompt, segment.VideoPrompt, false, false}}}, nil
	case strings.Contains(query, "FROM model_definitions d") && strings.Contains(query, "WHERE d.id = ? AND d.enabled = TRUE"):
		if args[0].Value.(int64) != batchTaskTestState.model.ID {
			return &batchTaskRows{columns: modelColumns}, nil
		}
		model := batchTaskTestState.model
		return &batchTaskRows{columns: modelColumns, values: [][]driver.Value{{model.ID, model.VersionID, model.Name, string(model.Kind), model.AdapterKind, model.Enabled, []byte("[]"), []byte("{}"), "", "", "", ""}}}, nil
	default:
		return nil, fmt.Errorf("unexpected batch task query: %s", query)
	}
}

func compactBatchTaskSQL(query string) string { return strings.Join(strings.Fields(query), " ") }

type batchTaskResult struct{ id, rows int64 }

func (r batchTaskResult) LastInsertId() (int64, error) { return r.id, nil }
func (r batchTaskResult) RowsAffected() (int64, error) { return r.rows, nil }

var projectColumns = []string{"id", "user_id", "name", "source_text", "source_object_key", "segmentation_status", "segmentation_version", "created_at", "updated_at"}
var segmentColumns = []string{"id", "project_id", "source_text", "subtitle_text", "order_index", "confirmed", "manually_edited", "image_prompt", "video_prompt", "image_prompt_locked", "video_prompt_locked"}
var modelColumns = []string{"id", "version_id", "name", "kind", "adapter_kind", "enabled", "allowed_roles_json", "parameter_schema_json", "credential_ref", "endpoint", "request_template", "response_mapping"}

type batchTaskRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *batchTaskRows) Columns() []string { return r.columns }
func (r *batchTaskRows) Close() error      { return nil }
func (r *batchTaskRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}
