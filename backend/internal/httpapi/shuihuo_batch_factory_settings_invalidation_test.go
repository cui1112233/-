package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestBatchFactorySettingsPersistenceFlagsDirectorRegenerationWhenCapabilityChanges(t *testing.T) {
	api := newBatchFactoryPersistenceTestAPI(t)
	batchFactoryPersistenceRows[batchFactoryPersistenceKey(7, "batch_1", "batch", "", "")] = []byte(`{
		"videoModelId":18,
		"videoModelVersionId":42,
		"videoModelName":"Seedance 2.0",
		"maxVideoDuration":10,
		"aspectRatio":"9:16"
	}`)
	batchFactoryPersistenceRows[batchFactoryPersistenceKey(7, "batch_1", "video", "opening_1", "1")] = []byte(`{"restriction":"旧 VIDEO 限制"}`)

	response := batchFactoryPersistenceRequest(t, api, http.MethodPut, "/api/shuihuo-production/batch-factory/batches/batch_1/settings", `{"settings":{"videoModelId":18}}`)
	if response.Code != http.StatusOK {
		t.Fatalf("save = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		DirectorRegenerationRequired bool           `json:"directorRegenerationRequired"`
		Settings                     map[string]any `json:"settings"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode save: %v", err)
	}
	if !payload.DirectorRegenerationRequired {
		t.Fatalf("model capability change must invalidate existing director output: %#v", payload)
	}
	if payload.Settings["maxVideoDuration"] != float64(15) {
		t.Fatalf("canonical max duration = %#v", payload.Settings["maxVideoDuration"])
	}

	stateResponse := batchFactoryPersistenceRequest(t, api, http.MethodGet, "/api/shuihuo-production/batch-factory/batches/batch_1/settings-state", "")
	if stateResponse.Code != http.StatusOK {
		t.Fatalf("state = %d %s", stateResponse.Code, stateResponse.Body.String())
	}
	var state struct {
		State struct {
			VideoOverrides map[string]map[string]map[string]any `json:"videoOverrides"`
		} `json:"state"`
	}
	if err := json.NewDecoder(stateResponse.Body).Decode(&state); err != nil {
		t.Fatalf("decode state: %v", err)
	}
	if len(state.State.VideoOverrides) != 0 {
		t.Fatalf("stale VIDEO overrides must be cleared when director is invalidated: %#v", state.State.VideoOverrides)
	}
}

func TestBatchFactorySettingsPersistenceKeepsDirectorValidWhenModelCapabilityIsUnchanged(t *testing.T) {
	api := newBatchFactoryPersistenceTestAPI(t)
	batchFactoryPersistenceRows[batchFactoryPersistenceKey(7, "batch_1", "batch", "", "")] = []byte(`{
		"videoModelId":18,
		"videoModelVersionId":42,
		"videoModelName":"Seedance 2.0",
		"maxVideoDuration":15,
		"aspectRatio":"9:16"
	}`)
	batchFactoryPersistenceRows[batchFactoryPersistenceKey(7, "batch_1", "video", "opening_1", "1")] = []byte(`{"restriction":"保留 VIDEO 限制"}`)

	response := batchFactoryPersistenceRequest(t, api, http.MethodPut, "/api/shuihuo-production/batch-factory/batches/batch_1/settings", `{"settings":{"videoModelId":18,"quality":"8K"}}`)
	if response.Code != http.StatusOK {
		t.Fatalf("save = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		DirectorRegenerationRequired bool `json:"directorRegenerationRequired"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode save: %v", err)
	}
	if payload.DirectorRegenerationRequired {
		t.Fatal("unrelated settings changes must not invalidate director output")
	}

	stateResponse := batchFactoryPersistenceRequest(t, api, http.MethodGet, "/api/shuihuo-production/batch-factory/batches/batch_1/settings-state", "")
	var state struct {
		State struct {
			VideoOverrides map[string]map[string]map[string]any `json:"videoOverrides"`
		} `json:"state"`
	}
	if err := json.NewDecoder(stateResponse.Body).Decode(&state); err != nil {
		t.Fatalf("decode state: %v", err)
	}
	if state.State.VideoOverrides["opening_1"]["1"]["restriction"] != "保留 VIDEO 限制" {
		t.Fatalf("unrelated settings save must preserve VIDEO overrides: %#v", state.State.VideoOverrides)
	}
}
