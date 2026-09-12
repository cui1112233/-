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

func TestYadiVideoAdapterMapsGenericReferenceImages(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(`{"data":{"task_id":"yd-task-1"}}`))
	}))
	defer server.Close()

	adapter := &YadiVideoAdapter{
		CreateURL: server.URL + "/create",
		TasksURL: server.URL + "/tasks",
		ResultURL: server.URL + "/tasks/{id}/result",
		APIKey: "secret",
		Model: "yd2.0-mini",
		Client: server.Client(),
		ValidateURL: func(raw string) (*url.URL, error) { return url.Parse(raw) },
	}
	prompt := FinalPrompt{
		CompiledPrompt: "当前 Shot 视频提示词",
		DurationSeconds: 6,
		ReferenceImages: []string{"https://assets.example/shot.png", "https://assets.example/character.png"},
		EffectiveSettings: EffectiveSettings{Values: SettingsPatch{
			"aspectRatio": json.RawMessage(`"9:16"`),
			"resolution": json.RawMessage(`"720p"`),
		}},
	}
	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "yd2.0-mini", MaxDuration: 15}, prompt)
	if err != nil {
		t.Fatal(err)
	}
	if ref.ProviderTaskID != "yd-task-1" {
		t.Fatalf("ref=%+v", ref)
	}
	images, ok := received["image_urls"].([]any)
	if !ok || len(images) != 3 {
		t.Fatalf("image_urls=%#v", received["image_urls"])
	}
	if images[1] != "https://assets.example/shot.png" || images[2] != "https://assets.example/character.png" {
		t.Fatalf("image_urls=%#v", images)
	}
	if received["duration"] != "6" || received["prompt"] != prompt.CompiledPrompt {
		t.Fatalf("payload=%+v", received)
	}
}

func TestYadiVideoAdapterRejectsReferencesBeyondCapacity(t *testing.T) {
	adapter := &YadiVideoAdapter{
		CreateURL: "https://ydapi.yadiai.cn/openapi/v1/video/create",
		TasksURL: "https://ydapi.yadiai.cn/openapi/v1/video/tasks",
		ResultURL: "https://ydapi.yadiai.cn/openapi/v1/video/tasks/{id}/result",
		APIKey: "secret",
		Model: "yd2.0-mini",
	}
	images := []string{
		"https://assets.example/1.png",
		"https://assets.example/2.png",
		"https://assets.example/3.png",
		"https://assets.example/4.png",
	}
	_, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "yd2.0-mini", MaxDuration: 15}, FinalPrompt{
		CompiledPrompt: "test", DurationSeconds: 6, ReferenceImages: images,
	})
	if err == nil || !strings.Contains(err.Error(), "at most 3") {
		t.Fatalf("expected explicit reference capacity error, got %v", err)
	}
}
