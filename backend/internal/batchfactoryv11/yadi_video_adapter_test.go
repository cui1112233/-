package batchfactoryv11

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestYadiResultMediaURLReadsCompletedResultURLsArray(t *testing.T) {
	raw := []byte(`{
  "code": 200,
  "data": {
    "status": "SUCCESS",
    "urls": ["https://media.example/generated.mp4"],
    "outputs": []
  }
}`)
	if got := yadiResultMediaURL(raw); got != "https://media.example/generated.mp4" {
		t.Fatalf("yadiResultMediaURL() = %q", got)
	}
}

func TestYadiResultMediaURLKeepsLegacySingleURLResponses(t *testing.T) {
	if got := yadiResultMediaURL([]byte(`{"data":{"mediaUrl":"https://media.example/legacy.mp4"}}`)); got != "https://media.example/legacy.mp4" {
		t.Fatalf("yadiResultMediaURL() = %q", got)
	}
}

func TestYadiSubmitAcceptsImmediateMediaURLArray(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method=%s", r.Method)
		}
		_, _ = w.Write([]byte(`{"code":200,"data":{"urls":["https://media.example/direct.mp4"]}}`))
	}))
	defer server.Close()
	adapter := &YadiVideoAdapter{CreateURL: server.URL + "/create", TasksURL: server.URL + "/tasks", ResultURL: server.URL + "/result/{id}", APIKey: "secret", Model: "yd2.0-mini", Client: server.Client(), ValidateURL: testAdapterURL}
	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "yd2.0-mini", MaxDuration: 10}, FinalPrompt{CompiledPrompt: "分镜", DurationSeconds: 10})
	if err != nil {
		t.Fatal(err)
	}
	if ref.State != ProductionSucceeded || ref.MediaURL != "https://media.example/direct.mp4" {
		t.Fatalf("ref=%+v", ref)
	}
}

func TestYadiSubmitReadsTaskIDNestedInProviderList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":200,"data":{"items":[{"task_id":"queued-123"}]}}`))
	}))
	defer server.Close()
	adapter := &YadiVideoAdapter{CreateURL: server.URL + "/create", TasksURL: server.URL + "/tasks", ResultURL: server.URL + "/result/{id}", APIKey: "secret", Model: "yd2.0-mini", Client: server.Client(), ValidateURL: testAdapterURL}
	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "yd2.0-mini", MaxDuration: 10}, FinalPrompt{CompiledPrompt: "分镜", DurationSeconds: 10})
	if err != nil {
		t.Fatal(err)
	}
	if ref.State != ProductionQueued || ref.ProviderTaskID != "queued-123" {
		t.Fatalf("ref=%+v", ref)
	}
}

func TestYadiSubmitReturnsProviderMessageWhenNoTaskOrMediaWasCreated(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":429,"message":"quota exhausted","data":{}}`))
	}))
	defer server.Close()
	adapter := &YadiVideoAdapter{CreateURL: server.URL + "/create", TasksURL: server.URL + "/tasks", ResultURL: server.URL + "/result/{id}", APIKey: "secret", Model: "yd2.0-mini", Client: server.Client(), ValidateURL: testAdapterURL}
	_, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "yd2.0-mini", MaxDuration: 10}, FinalPrompt{CompiledPrompt: "分镜", DurationSeconds: 10})
	if err == nil || !strings.Contains(err.Error(), "quota exhausted") {
		t.Fatalf("err=%v", err)
	}
}
