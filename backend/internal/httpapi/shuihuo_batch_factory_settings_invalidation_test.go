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
}
