package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func batchFactoryConfigRequest(t *testing.T, api *API, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := bridgeRequest(t, method, path, "producer", false)
	req.Body = io.NopCloser(strings.NewReader(body))
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)
	return response
}

const batchFactoryConfigRowsJSON = `[
  {"id":"director","module":"batch-factory","name":"导演","version":1,"status":"archived","body":"director-v1","publishedAt":"2026-08-20T00:00:00.000Z"},
  {"id":"assets","module":"batch-factory","name":"资产","version":1,"status":"archived","body":"assets-v1","publishedAt":"2026-08-20T00:01:00.000Z"},
  {"id":"director","module":"batch-factory","name":"导演","version":2,"status":"published","body":"director-v2","publishedAt":"2026-08-21T00:00:00.000Z"},
  {"id":"assets","module":"batch-factory","name":"资产","version":2,"status":"published","body":"assets-v2","publishedAt":"2026-08-22T00:00:00.000Z"}
]`

func TestBatchFactoryConfigSnapshotsResolveHistoricalCatalog(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	path := "/api/shuihuo-production/batch-factory/config-snapshots/resolve"
	response := batchFactoryConfigRequest(t, api, http.MethodPost, path, `{"presets":`+batchFactoryConfigRowsJSON+`}`)
	if response.Code != http.StatusOK {
		t.Fatalf("config snapshots = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Latest struct {
			Revision       string         `json:"revision"`
			Label          string         `json:"label"`
			PresetVersions map[string]int `json:"presetVersions"`
		} `json:"latest"`
		Versions []struct {
			PresetVersions map[string]int `json:"presetVersions"`
		} `json:"versions"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode config snapshots: %v", err)
	}
	if len(payload.Versions) != 3 || payload.Latest.Label != "配置 v3" || len(payload.Latest.Revision) != 12 {
		t.Fatalf("catalog = %#v", payload)
	}
	if payload.Latest.PresetVersions["director"] != 2 || payload.Latest.PresetVersions["assets"] != 2 {
		t.Fatalf("latest pins = %#v", payload.Latest.PresetVersions)
	}
}

func TestBatchFactoryConfigSnapshotsRejectInvalidJSON(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	path := "/api/shuihuo-production/batch-factory/config-snapshots/resolve"
	response := batchFactoryConfigRequest(t, api, http.MethodPost, path, `{`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid json = %d %s", response.Code, response.Body.String())
	}
}

func TestBatchFactoryPresetResolveReturnsPinnedHistoricalVersion(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	path := "/api/shuihuo-production/batch-factory/presets/resolve"
	response := batchFactoryConfigRequest(t, api, http.MethodPost, path, `{"presets":`+batchFactoryConfigRowsJSON+`,"id":"director","version":1}`)
	if response.Code != http.StatusOK {
		t.Fatalf("preset resolve = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Preset struct {
			ID      string `json:"id"`
			Version int    `json:"version"`
			Status  string `json:"status"`
			Body    string `json:"body"`
		} `json:"preset"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode preset: %v", err)
	}
	if payload.Preset.ID != "director" || payload.Preset.Version != 1 || payload.Preset.Status != "archived" || payload.Preset.Body != "director-v1" {
		t.Fatalf("preset = %#v", payload.Preset)
	}
}

func TestBatchFactoryPresetResolveRejectsMissingOrWrongModulePreset(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	path := "/api/shuihuo-production/batch-factory/presets/resolve"
	missing := batchFactoryConfigRequest(t, api, http.MethodPost, path, `{"presets":`+batchFactoryConfigRowsJSON+`,"id":"missing","version":1}`)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing preset = %d %s", missing.Code, missing.Body.String())
	}
	wrongModule := batchFactoryConfigRequest(t, api, http.MethodPost, path, `{"presets":[{"id":"director","module":"script","version":1,"status":"published","body":"wrong"}],"id":"director","version":1}`)
	if wrongModule.Code != http.StatusNotFound {
		t.Fatalf("wrong module = %d %s", wrongModule.Code, wrongModule.Body.String())
	}
}
