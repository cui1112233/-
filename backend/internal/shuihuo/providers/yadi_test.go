package providers

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"qiantie/backend/internal/shuihuo/models"
)

type yadiRoundTripper func(*http.Request) (*http.Response, error)

func (fn yadiRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

type yadiCredentialStub struct{ value string }

func (store yadiCredentialStub) Get(context.Context, int64, string) (string, error) { return store.value, nil }

func yadiTestModel() models.Definition {
	return models.Definition{
		Kind:            models.KindVideo,
		AdapterKind:     models.AdapterYadiVideo,
		CredentialRef:   "user:yadi",
		Endpoint:        "https://ydapi.yadiai.cn/openapi/v1/video/create",
		ParameterSchema: `{"upstreamModel":"yd2.0-fast","defaultResolution":"720p","maxVideoDuration":15}`,
	}
}

func TestYadiSubmitUsesDocumentedOpenAPIShape(t *testing.T) {
	client := &http.Client{Transport: yadiRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.String() != "https://ydapi.yadiai.cn/openapi/v1/video/create" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.String())
		}
		if got := request.Header.Get("Authorization"); got != "Bearer sk-yadi-test" {
			t.Fatalf("unexpected authorization: %q", got)
		}
		body, _ := io.ReadAll(request.Body)
		text := string(body)
		for _, expected := range []string{
			`"model":"yd2.0-fast"`,
			`"prompt":"电影感运镜"`,
			`"duration":"15"`,
			`"resolution":"720p"`,
			`"aspect_ratio":"16:9"`,
			`"image_urls":[]`,
			`"video_urls":[]`,
			`"audio_urls":[]`,
		} {
			if !strings.Contains(text, expected) {
				t.Fatalf("request body missing %s: %s", expected, text)
			}
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"taskId":"task-yadi-1"}`)),
		}, nil
	})}
	provider := NewYadi(client, yadiCredentialStub{value: "sk-yadi-test"})
	ctx := models.WithUserID(context.Background(), 9)
	result, err := provider.Submit(ctx, yadiTestModel(), models.Request{Prompt: "电影感运镜", Duration: "15", AspectRatio: "16:9"})
	if err != nil {
		t.Fatal(err)
	}
	if result.ProviderTaskID != "task-yadi-1" {
		t.Fatalf("unexpected task id: %q", result.ProviderTaskID)
	}
}

func TestYadiPollUsesResultEndpoint(t *testing.T) {
	client := &http.Client{Transport: yadiRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodGet || request.URL.Path != "/openapi/v1/video/tasks/task-2/result" {
			t.Fatalf("unexpected poll request: %s %s", request.Method, request.URL.String())
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"data":{"status":"completed","video_url":"https://cdn.example.com/out.mp4"}}`)),
		}, nil
	})}
	provider := NewYadi(client, yadiCredentialStub{value: "sk-yadi-test"})
	ctx := models.WithUserID(context.Background(), 9)
	result, err := provider.Poll(ctx, yadiTestModel(), "task-2")
	if err != nil {
		t.Fatal(err)
	}
	if result.State != ViduTaskSucceeded || result.ResultURL != "https://cdn.example.com/out.mp4" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestParseYadiTaskHandlesNestedAndFailureStates(t *testing.T) {
	success, err := ParseYadiTask("task-3", []byte(`{"result":{"state":"success","videos":[{"url":"https://cdn.example.com/v.mp4"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	if success.State != ViduTaskSucceeded || success.ResultURL == "" {
		t.Fatalf("unexpected success: %#v", success)
	}

	failed, err := ParseYadiTask("task-4", []byte(`{"status":"failed","message":"quota exhausted"}`))
	if err != nil {
		t.Fatal(err)
	}
	if failed.State != ViduTaskFailed || failed.Message != "quota exhausted" {
		t.Fatalf("unexpected failure: %#v", failed)
	}
}

func TestYadiRequiresTaskOwnerContext(t *testing.T) {
	provider := NewYadi(&http.Client{}, yadiCredentialStub{value: "sk-yadi-test"})
	_, err := provider.Submit(context.Background(), yadiTestModel(), models.Request{Prompt: "test"})
	if err == nil || !strings.Contains(err.Error(), "task owner") {
		t.Fatalf("expected owner context error, got %v", err)
	}
}
