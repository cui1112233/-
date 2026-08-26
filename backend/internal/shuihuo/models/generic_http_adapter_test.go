package models

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestGenericHTTPAdapterSubmitsRenderedPromptAndReadsImmediateResult(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		if got, want := string(body), `{"prompt":"雨夜车站"}`; got != want {
			t.Fatalf("body = %s, want %s", got, want)
		}
		if got, want := r.Header.Get("Authorization"), "Bearer model-secret"; got != want {
			t.Fatalf("authorization = %q, want %q", got, want)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"url":"https://cdn.example.com/result.png"}}`))
	}))
	defer server.Close()

	adapter := NewGenericHTTPAdapter(server.Client(), func(string) (string, error) { return "model-secret", nil })
	adapter.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	response, err := adapter.Submit(context.Background(), Definition{
		Kind:            KindImage,
		AdapterKind:     AdapterGenericHTTP,
		Endpoint:        server.URL,
		CredentialRef:   "IMAGE_TOKEN",
		RequestTemplate: `{"method":"POST","headers":{"Authorization":"Bearer {{credential}}"},"body":{"prompt":"{{prompt}}"}}`,
		ResponseMapping: `{"resultUrl":"data.url"}`,
	}, Request{Prompt: "雨夜车站"})
	if err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
	if response.ResultURL != "https://cdn.example.com/result.png" {
		t.Fatalf("result URL = %q", response.ResultURL)
	}
}

func TestGenericHTTPAdapterUsesBaseDomainPathAndVideoSettings(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Path, "/api/video/tasks"; got != want {
			t.Fatalf("path = %q, want %q", got, want)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		if got, want := string(body), `{"prompt":"运镜","duration":"5","ratio":"16:9","resolution":"1080p"}`; got != want {
			t.Fatalf("body = %s, want %s", got, want)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"tasks":[{"id":"doubao-42"}]}}`))
	}))
	defer server.Close()

	adapter := NewGenericHTTPAdapter(server.Client(), func(string) (string, error) { return "model-secret", nil })
	adapter.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	response, err := adapter.Submit(context.Background(), Definition{
		Kind:            KindVideo,
		AdapterKind:     AdapterGenericHTTP,
		BaseDomain:      server.URL,
		BasePath:        "/api/video/tasks",
		CredentialRef:   "VIDEO_TOKEN",
		RequestTemplate: `{"method":"POST","body":{"prompt":"{{prompt}}","duration":"{{duration}}","ratio":"{{aspect_ratio}}","resolution":"{{resolution}}"}}`,
		ResponseMapping: `{"providerTaskId":"data.tasks[0].id"}`,
	}, Request{Prompt: "运镜", Duration: "5", AspectRatio: "16:9", Resolution: "1080p"})
	if err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
	if response.ProviderTaskID != "doubao-42" {
		t.Fatalf("provider task ID = %q", response.ProviderTaskID)
	}
}

func TestGenericHTTPAdapterRejectsTemplateWithoutResultMapping(t *testing.T) {
	adapter := NewGenericHTTPAdapter(http.DefaultClient, func(string) (string, error) { return "", nil })
	_, err := adapter.Submit(context.Background(), Definition{
		Kind:            KindImage,
		AdapterKind:     AdapterGenericHTTP,
		Endpoint:        "https://models.example.com/generate",
		RequestTemplate: `{"body":{"prompt":"{{prompt}}"}}`,
		ResponseMapping: `{}`,
	}, Request{Prompt: "x"})
	if err == nil {
		t.Fatal("Submit() accepted a response mapping without resultUrl or providerTaskId")
	}
}
