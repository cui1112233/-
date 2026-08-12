package providers

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"qiantie/backend/internal/shuihuo/models"
)

func TestParseViduTaskMapsRunningAndCompletedStates(t *testing.T) {
	running, err := ParseViduTask(`{"id":"vidu-42","state":"processing"}`)
	if err != nil {
		t.Fatal(err)
	}
	if running.State != ViduTaskRunning || running.ID != "vidu-42" {
		t.Fatalf("running task = %#v", running)
	}

	completed, err := ParseViduTask(`{"id":"vidu-42","state":"success","creations":[{"url":"https://cdn.vidu.example/clip.mp4"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if completed.State != ViduTaskSucceeded || completed.ResultURL != "https://cdn.vidu.example/clip.mp4" {
		t.Fatalf("completed task = %#v", completed)
	}
}

func TestViduRejectsNonHTTPSConfiguredEndpoint(t *testing.T) {
	adapter := NewVidu(nil, func(string) (string, error) { return "token", nil }, func(string) string { return "http://127.0.0.1:8000" })
	_, err := adapter.Submit(context.Background(), models.Definition{
		Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo, CredentialRef: "VIDU_CREDENTIAL",
	}, models.Request{Prompt: "镜头推进", ImageURL: "https://storage.example.com/main.png"})
	if err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("Submit() error = %v, want HTTPS rejection", err)
	}
}

func TestViduUsesServerEndpointAndMapsTaskID(t *testing.T) {
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://api.vidu.example/ent/v2/img2video" {
			t.Fatalf("URL = %s", request.URL)
		}
		if request.Header.Get("Authorization") != "Token token" {
			t.Fatalf("authorization header = %q", request.Header.Get("Authorization"))
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"task_id":"vidu-42"}`))}, nil
	})
	adapter := NewVidu(&http.Client{Transport: transport}, func(string) (string, error) { return "token", nil }, func(string) string { return "https://api.vidu.example/ent/v2" })
	result, err := adapter.Submit(context.Background(), models.Definition{Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo, CredentialRef: "VIDU_CREDENTIAL", Name: "vidu-q1"}, models.Request{Prompt: "镜头推进", ImageURL: "https://storage.example.com/main.png"})
	if err != nil {
		t.Fatal(err)
	}
	if result.ProviderTaskID != "vidu-42" || result.ResultURL != "" {
		t.Fatalf("result = %#v", result)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }
