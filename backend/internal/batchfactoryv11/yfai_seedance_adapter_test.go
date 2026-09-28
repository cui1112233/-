package batchfactoryv11

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestYFAISeedanceAdapterUsesOfficialPayloadAndCredential(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/media/generate" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer seedance-key" {
			t.Fatalf("authorization=%q", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"task_id": "seedance-task-1"}})
	}))
	defer server.Close()
	adapter := &YFAISeedanceAdapter{BaseURL: server.URL, APIKey: "seedance-key", Model: "seedance-2-0-official", Client: server.Client(), ValidateURL: func(raw string) (*url.URL, error) { return url.Parse(raw) }}
	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "seedance-2-0-official", MaxDuration: 15}, FinalPrompt{CompiledPrompt: "雨夜奔跑", DurationSeconds: 6, EffectiveSettings: EffectiveSettings{Values: SettingsPatch{"videoAspectRatio": json.RawMessage(`"9:16"`), "videoResolution": json.RawMessage(`"480p"`)}}})
	if err != nil {
		t.Fatal(err)
	}
	if ref.ProviderTaskID != "seedance-task-1" {
		t.Fatalf("task=%q", ref.ProviderTaskID)
	}
	params := got["params"].(map[string]any)
	if got["model"] != "seedance-2-0-official" || params["duration"] != "6" || params["aspect_ratio"] != "9:16" || params["resolution"] != "480p" || params["mode"] != "text-to-video" {
		t.Fatalf("payload=%#v", got)
	}
}
