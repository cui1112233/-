package models

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestGenericHTTPAdapterPollMapsCompletedVideo(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Path, "/tasks/doubao-42"; got != want {
			t.Fatalf("path = %q, want %q", got, want)
		}
		if got, want := r.Header.Get("Authorization"), "Bearer model-secret"; got != want {
			t.Fatalf("authorization = %q, want %q", got, want)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"succeeded","content":{"videos":[{"url":"https://cdn.example.com/result.mp4"}]}}`))
	}))
	defer server.Close()

	adapter := NewGenericHTTPAdapter(server.Client(), func(string) (string, error) { return "model-secret", nil })
	adapter.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	result, err := adapter.Poll(context.Background(), Definition{
		Kind:          KindVideo,
		AdapterKind:   AdapterGenericHTTP,
		CredentialRef: "VIDEO_TOKEN",
		PollingTemplate: `{"method":"GET","endpoint":"` + server.URL + `/tasks/{{provider_task_id}}","headers":{"Authorization":"Bearer {{credential}}"},"statusPath":"status","resultUrl":"content.videos[0].url"}`,
	}, "doubao-42")
	if err != nil {
		t.Fatalf("Poll() error = %v", err)
	}
	if result.State != GenericTaskSucceeded || result.ResultURL != "https://cdn.example.com/result.mp4" {
		t.Fatalf("result = %#v", result)
	}
}

func TestGenericHTTPAdapterPollTreatsProvider5xxAsTransient(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "busy", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	adapter := NewGenericHTTPAdapter(server.Client(), nil)
	adapter.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	_, err := adapter.Poll(context.Background(), Definition{
		Kind:            KindVideo,
		AdapterKind:     AdapterGenericHTTP,
		PollingTemplate: `{"endpoint":"` + server.URL + `/tasks/{{provider_task_id}}","resultUrl":"video_url"}`,
	}, "doubao-42")
	if err == nil || !IsTransientGenericPollError(err) {
		t.Fatalf("Poll() error = %v, want transient", err)
	}
}
