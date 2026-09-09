package batchfactoryv11

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestAutoDLH3VideoAdapterUsesTextWorkflowWhenNoReferenceImages(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_no_pic" {
			t.Fatalf("request=%s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "autodl-secret" {
			t.Fatalf("authorization=%q", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(`{"code":"Success","data":{"task_id":"h3-task-1","status":"QUEUED"}}`))
	}))
	defer server.Close()

	adapter := &AutoDLH3VideoAdapter{
		CreateURL: server.URL + "/api/v1/comfyui/comfyui_workflow/{workflow}",
		TasksURL:  server.URL + "/api/v1/comfyui/comfyui_workflow/result/{id}",
		APIKey:    "autodl-secret",
		Model:     AutoDLH3Model,
		Client:    server.Client(),
		ValidateURL: func(raw string) (*url.URL, error) {
			return url.Parse(raw)
		},
	}
	prompt := FinalPrompt{
		CompiledPrompt:  "夜晚的街道，电影感运镜",
		DurationSeconds: 15,
		EffectiveSettings: EffectiveSettings{Values: SettingsPatch{
			"resolution":  json.RawMessage(`"480p竖"`),
			"aspectRatio": json.RawMessage(`"9:16"`),
		}},
	}

	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: AutoDLH3Model, MaxDuration: 15}, prompt)
	if err != nil {
		t.Fatal(err)
	}
	if ref.ProviderTaskID != "h3-task-1" || ref.State != ProductionQueued {
		t.Fatalf("ref=%+v", ref)
	}
	if received["prompt"] != prompt.CompiledPrompt || received["duration"] != float64(15) || received["resolution"] != "480p竖" {
		t.Fatalf("payload=%+v", received)
	}
	for key := range received {
		if strings.HasPrefix(key, "ref_image_") {
			t.Fatalf("text workflow unexpectedly received reference image: %+v", received)
		}
	}
}

func TestAutoDLH3VideoAdapterUsesReferenceWorkflowAndPollsResult(t *testing.T) {
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.Path)
		if r.Method == http.MethodPost {
			var received map[string]any
			if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
				t.Fatal(err)
			}
			if received["ref_image_0"] != "https://assets.example/ref.png" {
				t.Fatalf("payload=%+v", received)
			}
			_, _ = w.Write([]byte(`{"code":"Success","data":{"task_id":"h3-task-2","status":"QUEUED"}}`))
			return
		}
		if r.URL.Path != "/api/v1/comfyui/comfyui_workflow/result/h3-task-2" {
			t.Fatalf("poll path=%s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"code":"Success","data":{"task_id":"h3-task-2","status":"SUCCESS","results":["https://media.example/h3.mp4"]}}`))
	}))
	defer server.Close()

	adapter := &AutoDLH3VideoAdapter{
		CreateURL: server.URL + "/api/v1/comfyui/comfyui_workflow/{workflow}",
		TasksURL:  server.URL + "/api/v1/comfyui/comfyui_workflow/result/{id}",
		APIKey:    "autodl-secret",
		Model:     AutoDLH3Model,
		Client:    server.Client(),
		ValidateURL: func(raw string) (*url.URL, error) {
			return url.Parse(raw)
		},
	}
	prompt := FinalPrompt{
		CompiledPrompt:  "人物转身，镜头推进",
		DurationSeconds: 10,
		EffectiveSettings: EffectiveSettings{Values: SettingsPatch{
			"imageUrls":  json.RawMessage(`["https://assets.example/ref.png"]`),
			"resolution": json.RawMessage(`"768p横"`),
		}},
	}

	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: AutoDLH3Model, MaxDuration: 15}, prompt)
	if err != nil {
		t.Fatal(err)
	}
	result, err := adapter.Poll(context.Background(), FrozenVideoModel{ID: AutoDLH3Model, MaxDuration: 15}, ref)
	if err != nil {
		t.Fatal(err)
	}
	if result.State != ProductionSucceeded || result.MediaURL != "https://media.example/h3.mp4" {
		t.Fatalf("result=%+v", result)
	}
	if len(requests) != 2 || !strings.Contains(requests[0], "minimax_h3_lightx2v_v5_15s") {
		t.Fatalf("requests=%v", requests)
	}
}

func TestAutoDLH3VideoProviderNormalizesAndKeepsKeyOutOfView(t *testing.T) {
	registry := NewMemoryVideoProviderRegistry()
	if err := registry.Put(context.Background(), "alice", VideoProviderConfig{
		Provider: VideoProviderAutoDLH3,
		APIKey:   "autodl-secret",
	}); err != nil {
		t.Fatal(err)
	}
	view, err := registry.View(context.Background(), "alice", "h3")
	if err != nil {
		t.Fatal(err)
	}
	if view.Provider != VideoProviderAutoDLH3 || view.Model != AutoDLH3Model || !view.Configured {
		t.Fatalf("view=%+v", view)
	}
}
