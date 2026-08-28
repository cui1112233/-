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

func TestGenericHTTPAdapterSubmitsNumericDurationAndAspectRatio(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		if got, want := string(body), `{"aspect_ratio":"9:16","duration":13,"prompt":"镜头推进"}`; got != want {
			t.Fatalf("body = %s, want %s", got, want)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"url":"https://cdn.example.com/result.mp4"}}`))
	}))
	defer server.Close()

	adapter := NewGenericHTTPAdapter(server.Client(), func(string) (string, error) { return "", nil })
	adapter.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	_, err := adapter.Submit(context.Background(), Definition{
		Kind:            KindVideo,
		AdapterKind:     AdapterGenericHTTP,
		Endpoint:        server.URL,
		RequestTemplate: `{"method":"POST","body":{"prompt":"{{prompt}}","duration":"{{duration}}","aspect_ratio":"{{aspect_ratio}}"}}`,
		ResponseMapping: `{"resultUrl":"data.url"}`,
	}, Request{Prompt: "镜头推进", Duration: "13", AspectRatio: "9:16"})
	if err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
}

func TestGenericHTTPAdapterPollsConfiguredAsyncVideoTask(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Path, "/tasks/task-42"; got != want {
			t.Fatalf("poll path = %q, want %q", got, want)
		}
		if got, want := r.Header.Get("Authorization"), "Bearer model-secret"; got != want {
			t.Fatalf("authorization = %q, want %q", got, want)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"status":"completed","url":"https://cdn.example.com/final.mp4"}}`))
	}))
	defer server.Close()

	adapter := NewGenericHTTPAdapter(server.Client(), func(string) (string, error) { return "model-secret", nil })
	adapter.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := Definition{
		Kind:          KindVideo,
		AdapterKind:   AdapterGenericHTTP,
		CredentialRef: "VIDEO_TOKEN",
		PollingTemplate: `{"method":"GET","url":"` + server.URL + `/tasks/{{provider_task_id}}","headers":{"Authorization":"Bearer {{credential}}"},"statusPath":"data.status","resultUrlPath":"data.url","running":["queued","running"],"succeeded":["completed"],"failed":["failed"]}`,
	}
	result, err := adapter.Poll(context.Background(), model, "task-42")
	if err != nil {
		t.Fatalf("Poll() error = %v", err)
	}
	if result.State != GenericPollSucceeded || result.ResultURL != "https://cdn.example.com/final.mp4" {
		t.Fatalf("poll result = %#v", result)
	}
}

func TestGenericVideoInputCapabilityComesFromTemplate(t *testing.T) {
	textVideo := Definition{Kind: KindVideo, AdapterKind: AdapterGenericHTTP, RequestTemplate: `{"body":{"prompt":"{{prompt}}"}}`}
	if textVideo.RequiresImageInput() {
		t.Fatal("text-to-video generic model unexpectedly requires an image")
	}
	imageVideo := Definition{Kind: KindVideo, AdapterKind: AdapterGenericHTTP, RequestTemplate: `{"body":{"image":"{{image_url}}"}}`}
	if !imageVideo.RequiresImageInput() {
		t.Fatal("generic template consuming image_url must require an image")
	}
	vidu := Definition{Kind: KindVideo, AdapterKind: AdapterViduImageToVideo}
	if !vidu.RequiresImageInput() {
		t.Fatal("Vidu image-to-video must require an image")
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
