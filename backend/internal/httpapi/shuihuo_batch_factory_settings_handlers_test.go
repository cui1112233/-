package httpapi

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/store"
)

func TestBatchFactorySettingsCanonicalizeRequiresAuthentication(t *testing.T) {
	api := New(Dependencies{})
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/shuihuo-production/batch-factory/settings/canonicalize", strings.NewReader(`{"settings":{"videoModelId":18}}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
}

func TestBatchFactorySettingsCanonicalizeRejectsInvalidJSON(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	req := bridgeRequest(t, http.MethodPost, "/api/shuihuo-production/batch-factory/settings/canonicalize", "producer", false)
	req.Body = io.NopCloser(strings.NewReader(`{"settings":`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
}

func TestBatchFactorySettingsCanonicalizeUsesServerModelSnapshot(t *testing.T) {
	api := newBatchFactorySettingsTestAPI(t, models.Definition{
		ID: 18, ModelID: "seedance-2", VersionID: 42, Name: "Seedance 2.0",
		Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP, Enabled: true,
		ParameterSchema: `{"maxVideoDuration":15}`,
		CredentialRef: "video-key", Endpoint: "https://api.example.com/video",
		RequestTemplate: `{"method":"POST","body":{"prompt":"{{prompt}}"}}`,
		ResponseMapping: `{"url":"$.url"}`,
	})

	response := canonicalizeBatchFactorySettingsRequest(t, api, "producer", false, `{
		"settings": {
			"videoModelId": 18,
			"videoModelVersionId": 999,
			"videoModelName": "浏览器伪造名称",
			"maxVideoDuration": 60,
			"aspectRatio": "16:9",
			"prefixEnabled": false
		},
		"previous": {"aspectRatio":"9:16"}
	}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload struct {
		Settings map[string]any `json:"settings"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	checks := map[string]any{
		"videoModelId":        float64(18),
		"videoModelVersionId": float64(42),
		"videoModelName":      "Seedance 2.0",
		"maxVideoDuration":    float64(15),
		"aspectRatio":         "16:9",
		"prefixEnabled":       false,
	}
	for key, want := range checks {
		if got := payload.Settings[key]; got != want {
			t.Fatalf("%s = %#v, want %#v; settings=%#v", key, got, want, payload.Settings)
		}
	}
}

func TestBatchFactorySettingsCanonicalizeRejectsUnavailableVideoModels(t *testing.T) {
	base := models.Definition{
		ID: 18, ModelID: "video-model", VersionID: 42, Name: "视频模型",
		Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP, Enabled: true,
		ParameterSchema: `{"maxVideoDuration":15}`,
		CredentialRef: "video-key", Endpoint: "https://api.example.com/video",
		RequestTemplate: `{"method":"POST","body":{"prompt":"{{prompt}}"}}`,
		ResponseMapping: `{"url":"$.url"}`,
	}

	tests := []struct {
		name       string
		mutate     func(*models.Definition)
		username   string
		isOwner    bool
		wantStatus int
	}{
		{name: "hidden", mutate: func(model *models.Definition) { model.Hidden = true }, username: "producer", wantStatus: http.StatusConflict},
		{name: "image input", mutate: func(model *models.Definition) { model.RequestTemplate = `{"image":"{{image_url}}","prompt":"{{prompt}}"}` }, username: "producer", wantStatus: http.StatusConflict},
		{name: "owner only", mutate: func(model *models.Definition) { model.AllowedRoles = []string{"owner"} }, username: "member", wantStatus: http.StatusForbidden},
		{name: "provider unconfigured", mutate: func(model *models.Definition) { model.CredentialRef = "" }, username: "producer", wantStatus: http.StatusConflict},
		{name: "duration missing", mutate: func(model *models.Definition) { model.ParameterSchema = `{}` }, username: "producer", wantStatus: http.StatusConflict},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			model := base
			tc.mutate(&model)
			api := newBatchFactorySettingsTestAPI(t, model)
			response := canonicalizeBatchFactorySettingsRequest(t, api, tc.username, tc.isOwner, `{"settings":{"videoModelId":18}}`)
			if response.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, tc.wantStatus, response.Body.String())
			}
		})
	}
}

func TestBatchFactorySettingsCanonicalizeRejectsMissingModel(t *testing.T) {
	api := newBatchFactorySettingsTestAPI(t, models.Definition{
		ID: 18, ModelID: "video-model", VersionID: 42, Name: "视频模型",
		Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP, Enabled: true,
		ParameterSchema: `{"maxVideoDuration":15}`,
		CredentialRef: "video-key", Endpoint: "https://api.example.com/video",
		RequestTemplate: `{"prompt":"{{prompt}}"}`, ResponseMapping: `{"url":"$.url"}`,
	})
	response := canonicalizeBatchFactorySettingsRequest(t, api, "producer", false, `{"settings":{"videoModelId":999}}`)
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusConflict, response.Body.String())
	}
}

func TestBatchFactoryOverrideCanonicalizePreservesFalseEmptyTextAndInheritance(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	path := "/api/shuihuo-production/batch-factory/overrides/canonicalize"
	req := bridgeRequest(t, http.MethodPost, path, "producer", false)
	req.Body = io.NopCloser(strings.NewReader(`{
		"settings":{"quality":"","qualityEnabled":false,"aspectRatio":"16:9"},
		"previous":{"restriction":"旧限制","negativeEnabled":false},
		"inheritKeys":["restriction"]
	}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload struct {
		Settings map[string]any `json:"settings"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, exists := payload.Settings["restriction"]; exists {
		t.Fatalf("restriction should be removed by inheritance: %#v", payload.Settings)
	}
	if payload.Settings["quality"] != "" || payload.Settings["qualityEnabled"] != false || payload.Settings["negativeEnabled"] != false || payload.Settings["aspectRatio"] != "16:9" {
		t.Fatalf("settings = %#v", payload.Settings)
	}
}

func canonicalizeBatchFactorySettingsRequest(t *testing.T, api *API, username string, isOwner bool, body string) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/shuihuo-production/batch-factory/settings/canonicalize"
	req := bridgeRequest(t, http.MethodPost, path, username, isOwner)
	req.Body = io.NopCloser(strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)
	return response
}

const batchFactorySettingsDriverName = "qiantie-httpapi-batch-factory-settings-test"

var (
	registerBatchFactorySettingsDriver sync.Once
	batchFactorySettingsModel          models.Definition
)

func newBatchFactorySettingsTestAPI(t *testing.T, model models.Definition) *API {
	t.Helper()
	registerBatchFactorySettingsDriver.Do(func() { sql.Register(batchFactorySettingsDriverName, batchFactorySettingsDriver{}) })
	batchFactorySettingsModel = model
	db, err := sql.Open(batchFactorySettingsDriverName, "")
	if err != nil {
		t.Fatalf("open settings test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(Dependencies{
		DB:           db,
		BridgeSecret: "bridge-test-secret",
		Users:        &memoryUserStore{users: map[int64]store.User{}},
	})
}

type batchFactorySettingsDriver struct{}

func (batchFactorySettingsDriver) Open(string) (driver.Conn, error) { return batchFactorySettingsConn{}, nil }

type batchFactorySettingsConn struct{}

func (batchFactorySettingsConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (batchFactorySettingsConn) Close() error                        { return nil }
func (batchFactorySettingsConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }
func (batchFactorySettingsConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	compact := strings.Join(strings.Fields(query), " ")
	if !strings.Contains(compact, "FROM model_definitions d") || !strings.Contains(compact, "WHERE d.id = ? AND d.enabled = TRUE") {
		return nil, fmt.Errorf("unexpected settings query: %s", compact)
	}
	if len(args) != 1 {
		return nil, fmt.Errorf("unexpected settings query args: %#v", args)
	}
	requested, ok := args[0].Value.(int64)
	if !ok || requested != batchFactorySettingsModel.ID {
		return &batchFactorySettingsRows{columns: batchFactorySettingsModelColumns}, nil
	}
	model := batchFactorySettingsModel
	roles, _ := json.Marshal(model.AllowedRoles)
	schema := []byte(model.ParameterSchema)
	if len(schema) == 0 {
		schema = []byte(`{}`)
	}
	return &batchFactorySettingsRows{
		columns: batchFactorySettingsModelColumns,
		values: [][]driver.Value{{
			model.ID, model.ModelID, model.VersionID, model.Name, string(model.Kind), model.AdapterKind,
			model.Enabled, model.Hidden, int64(model.SortOrder), model.AdminNote, roles, schema,
			model.CredentialRef, model.Endpoint, model.BaseDomain, model.BasePath, model.RequestTemplate,
			model.ResponseMapping, model.PollingTemplate, model.ImageInputFormat, model.ImageRequestMode, model.RuntimePolicyJSON,
		}},
	}, nil
}

var batchFactorySettingsModelColumns = []string{
	"id", "model_key", "version_id", "name", "kind", "adapter_kind", "enabled", "hidden", "sort_order", "admin_note",
	"allowed_roles_json", "parameter_schema_json", "credential_ref", "endpoint", "base_domain", "base_path", "request_template",
	"response_mapping", "polling_template", "image_input_format", "image_request_mode", "runtime_policy_json",
}

type batchFactorySettingsRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (rows *batchFactorySettingsRows) Columns() []string { return rows.columns }
func (rows *batchFactorySettingsRows) Close() error      { return nil }
func (rows *batchFactorySettingsRows) Next(dest []driver.Value) error {
	if rows.index >= len(rows.values) {
		return io.EOF
	}
	copy(dest, rows.values[rows.index])
	rows.index++
	return nil
}
