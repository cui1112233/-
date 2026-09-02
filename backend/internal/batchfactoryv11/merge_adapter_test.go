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

func TestHTTPMergeAdapterSubmitsOrderedSourcesAndPolls(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			if r.Header.Get("Authorization") != "Bearer secret" { t.Fatalf("auth=%q", r.Header.Get("Authorization")) }
			if err := json.NewDecoder(r.Body).Decode(&received); err != nil { t.Fatal(err) }
			_, _ = w.Write([]byte(`{"data":{"id":"merge-task-1"}}`))
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/merge-task-1") { t.Fatalf("path=%s", r.URL.Path) }
		_, _ = w.Write([]byte(`{"status":"completed","outputUrl":"https://media.example/merged.mp4"}`))
	}))
	defer server.Close()
	adapter := &HTTPMergeAdapter{Endpoint: server.URL + "/merge", PollEndpoint: server.URL + "/merge/{id}", APIKey: "secret", Client: server.Client(), ValidateURL: func(raw string) (*url.URL, error) { return url.Parse(raw) }}
	sources := []MergeMedia{{VideoID: "v1", URL: "https://media.example/1.mp4"}, {VideoID: "v2", URL: "https://media.example/2.mp4"}}
	job, err := adapter.Submit(context.Background(), "batch-1", sources, MergeOptions{TimingMode: "speed", Speed: 1.5})
	if err != nil { t.Fatal(err) }
	if job.Status != MergeQueued || job.ProviderTaskID != "merge-task-1" { t.Fatalf("job=%+v", job) }
	if received["batchId"] != "batch-1" || received["timingMode"] != "speed" { t.Fatalf("payload=%+v", received) }
	result, err := adapter.Poll(context.Background(), "batch-1", job)
	if err != nil { t.Fatal(err) }
	if result.Status != MergeSucceeded || result.OutputURL != "https://media.example/merged.mp4" { t.Fatalf("result=%+v", result) }
}

func TestHTTPMergeAdapterRejectsUnsafeSource(t *testing.T) {
	adapter := &HTTPMergeAdapter{Endpoint: "https://merge.example/submit", APIKey: "secret"}
	if _, err := adapter.Submit(context.Background(), "batch-1", []MergeMedia{{VideoID: "v1", URL: "http://media.example/1.mp4"}}, MergeOptions{}); err == nil { t.Fatal("expected unsafe source rejection") }
}
