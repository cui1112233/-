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

func TestBatchFactorySettingsPersistenceUsesDatabaseAsPreviousState(t *testing.T) {
	api := newBatchFactoryPersistenceTestAPI(t)
	path := "/api/shuihuo-production/batch-factory/batches/batch_1/settings"

	first := batchFactoryPersistenceRequest(t, api, http.MethodPut, path, `{
		"settings":{"videoModelId":18,"aspectRatio":"16:9","quality":"第一版"},
		"previous":{"aspectRatio":"9:16"}
	}`)
	if first.Code != http.StatusOK {
		t.Fatalf("first save = %d %s", first.Code, first.Body.String())
	}

	second := batchFactoryPersistenceRequest(t, api, http.MethodPut, path, `{
		"settings":{"prefixEnabled":false},
		"previous":{"videoModelId":18,"aspectRatio":"9:16","quality":"浏览器旧缓存"}
	}`)
	if second.Code != http.StatusOK {
		t.Fatalf("second save = %d %s", second.Code, second.Body.String())
	}
	var saved struct {
		Settings map[string]any `json:"settings"`
	}
	if err := json.NewDecoder(second.Body).Decode(&saved); err != nil {
		t.Fatalf("decode second save: %v", err)
	}
	if saved.Settings["aspectRatio"] != "16:9" || saved.Settings["quality"] != "第一版" || saved.Settings["prefixEnabled"] != false {
		t.Fatalf("saved settings = %#v", saved.Settings)
	}

	stateResponse := batchFactoryPersistenceRequest(t, api, http.MethodGet, "/api/shuihuo-production/batch-factory/batches/batch_1/settings-state", "")
	if stateResponse.Code != http.StatusOK {
		t.Fatalf("state = %d %s", stateResponse.Code, stateResponse.Body.String())
	}
	var state struct {
		Persisted bool `json:"persisted"`
		State struct {
			Settings map[string]any `json:"settings"`
		} `json:"state"`
	}
	if err := json.NewDecoder(stateResponse.Body).Decode(&state); err != nil {
		t.Fatalf("decode state: %v", err)
	}
	if !state.Persisted || state.State.Settings["aspectRatio"] != "16:9" || state.State.Settings["quality"] != "第一版" {
		t.Fatalf("persisted state = %#v", state)
	}
}

func TestBatchFactoryOverridePersistenceStoresAndDeletesSparseScopes(t *testing.T) {
	api := newBatchFactoryPersistenceTestAPI(t)
	itemPath := "/api/shuihuo-production/batch-factory/batches/batch_1/items/opening_1/overrides"
	videoPath := "/api/shuihuo-production/batch-factory/batches/batch_1/items/opening_1/videos/3/overrides"

	item := batchFactoryPersistenceRequest(t, api, http.MethodPut, itemPath, `{"settings":{"quality":"4K","qualityEnabled":false},"previous":{}}`)
	if item.Code != http.StatusOK {
		t.Fatalf("item save = %d %s", item.Code, item.Body.String())
	}
	video := batchFactoryPersistenceRequest(t, api, http.MethodPut, videoPath, `{"settings":{"restriction":"禁止水印"},"previous":{}}`)
	if video.Code != http.StatusOK {
		t.Fatalf("video save = %d %s", video.Code, video.Body.String())
	}

	itemDelete := batchFactoryPersistenceRequest(t, api, http.MethodPut, itemPath, `{"settings":{},"previous":{"quality":"浏览器旧缓存"},"inheritKeys":["quality","qualityEnabled"]}`)
	if itemDelete.Code != http.StatusOK {
		t.Fatalf("item delete = %d %s", itemDelete.Code, itemDelete.Body.String())
	}
	videoDelete := batchFactoryPersistenceRequest(t, api, http.MethodPut, videoPath, `{"settings":{},"previous":{"restriction":"浏览器旧缓存"},"inheritKeys":["restriction"]}`)
	if videoDelete.Code != http.StatusOK {
		t.Fatalf("video delete = %d %s", videoDelete.Code, videoDelete.Body.String())
	}

	stateResponse := batchFactoryPersistenceRequest(t, api, http.MethodGet, "/api/shuihuo-production/batch-factory/batches/batch_1/settings-state", "")
	var state struct {
		State struct {
			ItemOverrides  map[string]map[string]any            `json:"itemOverrides"`
			VideoOverrides map[string]map[string]map[string]any `json:"videoOverrides"`
		} `json:"state"`
	}
	if err := json.NewDecoder(stateResponse.Body).Decode(&state); err != nil {
		t.Fatalf("decode state: %v", err)
	}
	if len(state.State.ItemOverrides) != 0 || len(state.State.VideoOverrides) != 0 {
		t.Fatalf("overrides should be deleted: %#v", state.State)
	}
}

func TestBatchFactorySettingsStateReportsLegacyFallbackWhenNothingPersisted(t *testing.T) {
	api := newBatchFactoryPersistenceTestAPI(t)
	response := batchFactoryPersistenceRequest(t, api, http.MethodGet, "/api/shuihuo-production/batch-factory/batches/legacy_batch/settings-state", "")
	if response.Code != http.StatusOK {
		t.Fatalf("state = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Persisted bool `json:"persisted"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Persisted {
		t.Fatalf("legacy batch without MySQL rows must report persisted=false")
	}
}

func batchFactoryPersistenceRequest(t *testing.T, api *API, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := bridgeRequest(t, method, path, "producer", false)
	if body != "" {
		req.Body = io.NopCloser(strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)
	return response
}

const batchFactoryPersistenceDriverName = "qiantie-httpapi-batch-factory-persistence-test"

var (
	registerBatchFactoryPersistenceDriver sync.Once
	batchFactoryPersistenceRows          map[string][]byte
)

func newBatchFactoryPersistenceTestAPI(t *testing.T) *API {
	t.Helper()
	registerBatchFactoryPersistenceDriver.Do(func() { sql.Register(batchFactoryPersistenceDriverName, batchFactoryPersistenceDriver{}) })
	batchFactoryPersistenceRows = map[string][]byte{}
	db, err := sql.Open(batchFactoryPersistenceDriverName, "")
	if err != nil {
		t.Fatalf("open persistence db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(Dependencies{
		DB:           db,
		BridgeSecret: "bridge-test-secret",
		Users:        &batchFactoryPersistenceUserStore{},
	})
}

type batchFactoryPersistenceUserStore struct{}

func (*batchFactoryPersistenceUserStore) FindByUsername(context.Context, string) (store.User, error) {
	return store.User{ID: 7, Username: "producer", IsActive: true}, nil
}
func (*batchFactoryPersistenceUserStore) FindByID(context.Context, int64) (store.User, error) {
	return store.User{ID: 7, Username: "producer", IsActive: true}, nil
}
func (*batchFactoryPersistenceUserStore) EnsureBridgeUser(_ context.Context, username string, isOwner bool) (store.User, error) {
	return store.User{ID: 7, Username: username, IsOwner: isOwner, IsActive: true}, nil
}

type batchFactoryPersistenceDriver struct{}

func (batchFactoryPersistenceDriver) Open(string) (driver.Conn, error) { return batchFactoryPersistenceConn{}, nil }

type batchFactoryPersistenceConn struct{}

func (batchFactoryPersistenceConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (batchFactoryPersistenceConn) Close() error                        { return nil }
func (batchFactoryPersistenceConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (batchFactoryPersistenceConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	compact := strings.Join(strings.Fields(query), " ")
	if strings.HasPrefix(compact, "INSERT INTO shuihuo_batch_factory_settings") {
		if len(args) != 6 {
			return nil, fmt.Errorf("unexpected settings upsert args: %#v", args)
		}
		key := batchFactoryPersistenceKey(args[0].Value, args[1].Value, args[2].Value, args[3].Value, args[4].Value)
		batchFactoryPersistenceRows[key] = []byte(fmt.Sprint(args[5].Value))
		return driver.RowsAffected(1), nil
	}
	if strings.HasPrefix(compact, "DELETE FROM shuihuo_batch_factory_settings") {
		if len(args) != 5 {
			return nil, fmt.Errorf("unexpected settings delete args: %#v", args)
		}
		delete(batchFactoryPersistenceRows, batchFactoryPersistenceKey(args[0].Value, args[1].Value, args[2].Value, args[3].Value, args[4].Value))
		return driver.RowsAffected(1), nil
	}
	return nil, fmt.Errorf("unexpected persistence exec: %s", compact)
}

func (batchFactoryPersistenceConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	compact := strings.Join(strings.Fields(query), " ")
	if strings.Contains(compact, "FROM model_definitions d") && strings.Contains(compact, "WHERE d.id = ? AND d.enabled = TRUE") {
		model := models.Definition{
			ID: 18, ModelID: "seedance-2", VersionID: 42, Name: "Seedance 2.0",
			Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP, Enabled: true,
			ParameterSchema: `{"maxVideoDuration":15}`,
			CredentialRef: "video-key", Endpoint: "https://api.example.com/video",
			RequestTemplate: `{"method":"POST","body":{"prompt":"{{prompt}}"}}`,
			ResponseMapping: `{"url":"$.url"}`,
		}
		if len(args) != 1 || fmt.Sprint(args[0].Value) != "18" {
			return &batchFactoryPersistenceResultRows{columns: batchFactorySettingsModelColumns}, nil
		}
		roles, _ := json.Marshal(model.AllowedRoles)
		return &batchFactoryPersistenceResultRows{
			columns: batchFactorySettingsModelColumns,
			values: [][]driver.Value{{model.ID, model.ModelID, model.VersionID, model.Name, string(model.Kind), model.AdapterKind, model.Enabled, false, int64(0), "", roles, []byte(model.ParameterSchema), model.CredentialRef, model.Endpoint, "", "", model.RequestTemplate, model.ResponseMapping, "", "", "", ""}},
		}, nil
	}
	if strings.Contains(compact, "FROM shuihuo_batch_factory_settings") {
		if len(args) != 2 {
			return nil, fmt.Errorf("unexpected settings query args: %#v", args)
		}
		prefix := fmt.Sprintf("%v|%v|", args[0].Value, args[1].Value)
		rows := &batchFactoryPersistenceResultRows{columns: []string{"scope", "item_id", "video_id", "settings_json"}}
		for key, raw := range batchFactoryPersistenceRows {
			if !strings.HasPrefix(key, prefix) {
				continue
			}
			parts := strings.SplitN(key, "|", 5)
			rows.values = append(rows.values, []driver.Value{parts[2], parts[3], parts[4], raw})
		}
		return rows, nil
	}
	return nil, fmt.Errorf("unexpected persistence query: %s", compact)
}

func batchFactoryPersistenceKey(values ...any) string {
	parts := make([]string, len(values))
	for index, value := range values {
		parts[index] = fmt.Sprint(value)
	}
	return strings.Join(parts, "|")
}

type batchFactoryPersistenceResultRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *batchFactoryPersistenceResultRows) Columns() []string { return r.columns }
func (r *batchFactoryPersistenceResultRows) Close() error      { return nil }
func (r *batchFactoryPersistenceResultRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}
