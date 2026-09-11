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

func testAdapterURL(raw string) (*url.URL, error) { return url.Parse(raw) }

func TestHTTPVideoAdapterSubmitsFrozenPromptAndReadsTaskID(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("request=%s auth=%q", r.Method, r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil { t.Fatal(err) }
		_, _ = w.Write([]byte(`{"data":{"id":"task-1"}}`))
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{Endpoint: server.URL, APIKey: "secret", Model: "video-v1", Client: server.Client(), ValidateURL: testAdapterURL}
	prompt := FinalPrompt{CompiledPrompt: "人物：林晚\n画幅 9:16；时长 8 秒", EffectiveSettings: EffectiveSettings{Values: SettingsPatch{
		"duration": json.RawMessage(`8`), "aspectRatio": json.RawMessage(`"9:16"`),
	}}}
	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "video-v1", MaxDuration: 15}, prompt)
	if err != nil { t.Fatal(err) }
	if ref.ProviderTaskID != "task-1" || ref.State != ProductionQueued { t.Fatalf("ref=%+v", ref) }
	if received["model"] != "video-v1" || received["prompt"] != prompt.CompiledPrompt || received["duration"] != float64(8) || received["aspectRatio"] != "9:16" {
		t.Fatalf("payload=%+v", received)
	}
}

func TestHTTPVideoAdapterPollsCompletedMedia(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !strings.HasSuffix(r.URL.Path, "/task-1") { t.Fatalf("request=%s %s", r.Method, r.URL.Path) }
		_, _ = w.Write([]byte(`{"status":"completed","url":"https://media.example/video.mp4"}`))
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{Endpoint: server.URL + "/submit", PollEndpoint: server.URL + "/tasks/{id}", APIKey: "secret", Model: "video-v1", Client: server.Client(), ValidateURL: testAdapterURL}
	ref, err := adapter.Poll(context.Background(), FrozenVideoModel{ID: "video-v1"}, ProviderTaskRef{ProviderTaskID: "task-1", State: ProductionRunning})
	if err != nil { t.Fatal(err) }
	if ref.State != ProductionSucceeded || ref.MediaURL != "https://media.example/video.mp4" { t.Fatalf("ref=%+v", ref) }
}

func TestHTTPVideoAdapterRequiresHTTPSAndCredentials(t *testing.T) {
	if err := (&HTTPVideoAdapter{Endpoint: "http://example.com", APIKey: "secret", Model: "video"}).Validate(); err == nil { t.Fatal("expected HTTPS validation") }
	if err := (&HTTPVideoAdapter{Endpoint: "https://example.com", Model: "video"}).Validate(); err == nil { t.Fatal("expected API key validation") }
	if err := (&HTTPVideoAdapter{Endpoint: "https://example.com", APIKey: "secret"}).Validate(); err == nil { t.Fatal("expected model validation") }
}
