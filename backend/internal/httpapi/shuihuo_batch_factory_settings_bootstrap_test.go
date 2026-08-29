package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestBatchFactorySettingsBootstrapMigratesCompleteLegacyState(t *testing.T) {
	api := newBatchFactoryPersistenceTestAPI(t)
	path := "/api/shuihuo-production/batch-factory/batches/batch_legacy/settings-state/bootstrap"
	response := batchFactoryPersistenceRequest(t, api, http.MethodPut, path, `{
		"state":{
			"settings":{"videoModelId":18,"videoModelVersionId":999,"videoModelName":"旧模型快照","maxVideoDuration":8,"aspectRatio":"16:9","quality":"旧批次画质"},
			"itemOverrides":{"opening_1":{"quality":"旧小说覆盖","qualityEnabled":false}},
			"videoOverrides":{"opening_1":{"3":{"restriction":"旧 VIDEO 限制","negativeEnabled":false}}}
		}
	}`)
	if response.Code != http.StatusOK {
		t.Fatalf("bootstrap = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Persisted bool `json:"persisted"`
		State struct {
			Settings       map[string]any                       `json:"settings"`
			ItemOverrides  map[string]map[string]any            `json:"itemOverrides"`
			VideoOverrides map[string]map[string]map[string]any `json:"videoOverrides"`
		} `json:"state"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode bootstrap: %v", err)
	}
	if !payload.Persisted {
		t.Fatalf("bootstrap must mark batch persisted")
	}
	if payload.State.Settings["quality"] != "旧批次画质" || payload.State.Settings["aspectRatio"] != "16:9" {
		t.Fatalf("settings = %#v", payload.State.Settings)
	}
	if payload.State.Settings["videoModelVersionId"] != float64(42) || payload.State.Settings["videoModelName"] != "Seedance 2.0" || payload.State.Settings["maxVideoDuration"] != float64(15) {
		t.Fatalf("bootstrap must canonicalize model metadata from Go model center: %#v", payload.State.Settings)
	}
	if payload.State.ItemOverrides["opening_1"]["quality"] != "旧小说覆盖" || payload.State.ItemOverrides["opening_1"]["qualityEnabled"] != false {
		t.Fatalf("item overrides = %#v", payload.State.ItemOverrides)
	}
	if payload.State.VideoOverrides["opening_1"]["3"]["restriction"] != "旧 VIDEO 限制" || payload.State.VideoOverrides["opening_1"]["3"]["negativeEnabled"] != false {
		t.Fatalf("video overrides = %#v", payload.State.VideoOverrides)
	}
}

func TestBatchFactorySettingsBootstrapNeverOverwritesOwnedMySQLState(t *testing.T) {
	api := newBatchFactoryPersistenceTestAPI(t)
	path := "/api/shuihuo-production/batch-factory/batches/batch_legacy/settings-state/bootstrap"
	first := batchFactoryPersistenceRequest(t, api, http.MethodPut, path, `{"state":{"settings":{"videoModelId":18,"aspectRatio":"16:9","quality":"MySQL 第一版"},"itemOverrides":{},"videoOverrides":{}}}`)
	if first.Code != http.StatusOK {
		t.Fatalf("first bootstrap = %d %s", first.Code, first.Body.String())
	}
	second := batchFactoryPersistenceRequest(t, api, http.MethodPut, path, `{"state":{"settings":{"videoModelId":18,"aspectRatio":"9:16","quality":"过期 legacy"},"itemOverrides":{"opening_1":{"quality":"过期覆盖"}},"videoOverrides":{}}}`)
	if second.Code != http.StatusOK {
		t.Fatalf("second bootstrap = %d %s", second.Code, second.Body.String())
	}
	var payload struct {
		State struct {
			Settings      map[string]any            `json:"settings"`
			ItemOverrides map[string]map[string]any `json:"itemOverrides"`
		} `json:"state"`
	}
	if err := json.NewDecoder(second.Body).Decode(&payload); err != nil {
		t.Fatalf("decode second bootstrap: %v", err)
	}
	if payload.State.Settings["quality"] != "MySQL 第一版" || payload.State.Settings["aspectRatio"] != "16:9" {
		t.Fatalf("existing MySQL state was overwritten: %#v", payload.State.Settings)
	}
	if len(payload.State.ItemOverrides) != 0 {
		t.Fatalf("stale legacy overrides must not be re-imported: %#v", payload.State.ItemOverrides)
	}
}
