package providers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"

	"qiantie/backend/internal/credentials"
	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/store"
)

var ydModel = models.Definition{
	Kind:          models.KindVideo,
	AdapterKind:   models.AdapterYDVideo,
	CredentialRef: "yd-credential",
}

func newYDTestProvider(transport roundTripFunc) *YD {
	return NewYD(&http.Client{Transport: transport}, func(context.Context, int64) (string, error) {
		return "yd-secret", nil
	})
}

type ydConfigStore struct {
	configs map[int64]store.VideoAPIConfig
}

func (s ydConfigStore) Get(_ context.Context, ownerID int64) (store.VideoAPIConfig, error) {
	return s.configs[ownerID], nil
}

func ydTestCipher(t *testing.T) *credentials.Cipher {
	t.Helper()
	cipher, err := credentials.NewFromBase64("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatal(err)
	}
	return cipher
}

func TestYDSubmitIgnoresHistoricGlobalCredentialReference(t *testing.T) {
	const ownerAKey = "test-owner-a-key"
	const historicReference = "historic-yd-global-reference"
	cipher := ydTestCipher(t)
	ownerACiphertext, err := cipher.Encrypt(ownerAKey)
	if err != nil {
		t.Fatal(err)
	}
	provider := NewYD(&http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "Bearer "+ownerAKey {
			t.Fatal("YD submit authorization did not ignore the historic global credential reference")
		}
		return jsonResponse(http.StatusOK, `{"task_id":"yd-owner-a"}`), nil
	})}, NewYDAccountCredentialResolver(ydConfigStore{configs: map[int64]store.VideoAPIConfig{
		101: {Provider: store.YDVideoProvider, APIKeyCiphertext: ownerACiphertext},
	}}, cipher))

	_, err = provider.Submit(context.Background(), models.Definition{
		Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo, CredentialRef: historicReference,
	}, models.Request{OwnerID: 101, Prompt: "镜头推进", ImageURL: "https://example.com/scene.png", AspectRatio: "9:16"})
	if err != nil {
		t.Fatal(err)
	}
}

func TestYDAccountCredentialStaysOutOfTaskSnapshotAndModelDefinition(t *testing.T) {
	const accountKey = "test-snapshot-account-key"
	cipher := ydTestCipher(t)
	ciphertext, err := cipher.Encrypt(accountKey)
	if err != nil {
		t.Fatal(err)
	}
	task := domain.Task{UserID: 101, Input: `{"prompt":"镜头推进","aspectRatio":"9:16"}`}
	model := models.Definition{Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo}
	modelJSON, err := json.Marshal(model)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(task.Input, accountKey) || strings.Contains(task.Input, ciphertext) || strings.Contains(string(modelJSON), accountKey) || strings.Contains(string(modelJSON), ciphertext) {
		t.Fatal("account credential appeared in a task snapshot or model definition")
	}
	provider := NewYD(&http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "Bearer "+accountKey {
			t.Fatal("YD submit did not use the account credential for outbound authentication")
		}
		return jsonResponse(http.StatusOK, `{"task_id":"yd-snapshot"}`), nil
	})}, NewYDAccountCredentialResolver(ydConfigStore{configs: map[int64]store.VideoAPIConfig{
		task.UserID: {Provider: store.YDVideoProvider, APIKeyCiphertext: ciphertext},
	}}, cipher))

	_, err = provider.Submit(context.Background(), model, models.Request{OwnerID: task.UserID, Prompt: "镜头推进", ImageURL: "https://example.com/scene.png", AspectRatio: "9:16"})
	if err != nil {
		t.Fatal(err)
	}
}

func TestYDPollUsesTaskOwnerCredentialInsteadOfModelCredential(t *testing.T) {
	const ownerAKey = "test-poll-owner-a-key"
	const ownerBKey = "test-poll-owner-b-key"
	cipher := ydTestCipher(t)
	ownerACiphertext, err := cipher.Encrypt(ownerAKey)
	if err != nil {
		t.Fatal(err)
	}
	ownerBCiphertext, err := cipher.Encrypt(ownerBKey)
	if err != nil {
		t.Fatal(err)
	}
	provider := NewYD(&http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "Bearer "+ownerAKey {
			t.Fatal("YD poll authorization did not use the task owner's credential")
		}
		return jsonResponse(http.StatusOK, `{"status":"RUNNING"}`), nil
	})}, NewYDAccountCredentialResolver(ydConfigStore{configs: map[int64]store.VideoAPIConfig{
		101: {Provider: store.YDVideoProvider, APIKeyCiphertext: ownerACiphertext},
		202: {Provider: store.YDVideoProvider, APIKeyCiphertext: ownerBCiphertext},
	}}, cipher))

	_, err = provider.Poll(context.Background(), models.Definition{
		Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo, CredentialRef: "owner-b",
	}, 101, "yd-owner-a")
	if err != nil {
		t.Fatal(err)
	}
}

func TestYDPollRedactsAccountCredentialFromProviderFailure(t *testing.T) {
	const ownerKey = "test-redaction-owner-key"
	cipher := ydTestCipher(t)
	ciphertext, err := cipher.Encrypt(ownerKey)
	if err != nil {
		t.Fatal(err)
	}
	provider := NewYD(&http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusOK, `{"status":"FAILED","errorMessage":"provider rejected test-redaction-owner-key"}`), nil
	})}, NewYDAccountCredentialResolver(ydConfigStore{configs: map[int64]store.VideoAPIConfig{
		101: {Provider: store.YDVideoProvider, APIKeyCiphertext: ciphertext},
	}}, cipher))

	result, err := provider.Poll(context.Background(), ydModel, 101, "yd-redacted")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(result.Message, ownerKey) || !strings.Contains(result.Message, "[redacted]") {
		t.Fatal("YD provider failure did not redact the account credential")
	}
}

func TestYDSubmitBuildsFixedPayloadWithAuthAndImageOrder(t *testing.T) {
	provider := newYDTestProvider(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.String() != ydCreateEndpoint {
			t.Fatalf("request = %s %s, want POST %s", request.Method, request.URL, ydCreateEndpoint)
		}
		if request.Header.Get("Authorization") != "Bearer yd-secret" {
			t.Fatal("YD submit authorization was not set")
		}
		if request.Header.Get("Cookie") != "" {
			t.Fatal("YD request must not use a cookie")
		}
		var payload struct {
			Model       string   `json:"model"`
			Prompt      string   `json:"prompt"`
			ImageURLs   []string `json:"image_urls"`
			Duration    string   `json:"duration"`
			AspectRatio string   `json:"aspect_ratio"`
			Resolution  string   `json:"resolution"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		wantImages := []string{ydEmptyImageURL, "https://example.com/ref-1.png", "https://example.com/ref-2.png", "https://example.com/scene.png"}
		if payload.Model != ydModelName || payload.Prompt != "镜头推进" || payload.Duration != "1" || payload.AspectRatio != "16:9" || payload.Resolution != "720p" {
			t.Fatalf("payload = %#v", payload)
		}
		if len(payload.ImageURLs) != len(wantImages) {
			t.Fatalf("image_urls = %#v", payload.ImageURLs)
		}
		for index := range wantImages {
			if payload.ImageURLs[index] != wantImages[index] {
				t.Fatalf("image_urls[%d] = %q, want %q", index, payload.ImageURLs[index], wantImages[index])
			}
		}
		return jsonResponse(http.StatusOK, `{"taskId":"yd-42"}`), nil
	})

	result, err := provider.Submit(context.Background(), ydModel, models.Request{
		Prompt:             "镜头推进",
		ImageURL:           "https://example.com/scene.png",
		ReferenceImageURLs: []string{"https://example.com/ref-1.png", "https://example.com/ref-2.png"},
		Duration:           "10",
		Resolution:         "1080p",
		AspectRatio:        "16:9",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ProviderTaskID != "yd-42" {
		t.Fatalf("result = %#v", result)
	}
}

func TestYDSubmitRejectsInvalidRequestsBeforeHTTP(t *testing.T) {
	tests := []struct {
		name    string
		request models.Request
		model   models.Definition
		want    string
	}{
		{name: "missing prompt", request: models.Request{ImageURL: "https://example.com/scene.png", AspectRatio: "9:16"}, want: "prompt"},
		{name: "missing scene", request: models.Request{Prompt: "p", AspectRatio: "9:16"}, want: "scene image"},
		{name: "bad ratio", request: models.Request{Prompt: "p", ImageURL: "https://example.com/scene.png", AspectRatio: "1:1"}, want: "aspect ratio"},
		{name: "bad scene URL", request: models.Request{Prompt: "p", ImageURL: "http://example.com/scene.png", AspectRatio: "9:16"}, want: "image URL"},
		{name: "too many references", request: models.Request{Prompt: "p", ImageURL: "https://example.com/scene.png", AspectRatio: "9:16", ReferenceImageURLs: []string{"https://example.com/1", "https://example.com/2", "https://example.com/3", "https://example.com/4"}}, want: "reference"},
		{name: "wrong adapter", model: models.Definition{Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo, CredentialRef: ydModel.CredentialRef}, request: models.Request{Prompt: "p", ImageURL: "https://example.com/scene.png", AspectRatio: "9:16"}, want: "adapter"},
		{name: "wrong kind", model: models.Definition{Kind: models.KindImage, AdapterKind: models.AdapterYDVideo, CredentialRef: ydModel.CredentialRef}, request: models.Request{Prompt: "p", ImageURL: "https://example.com/scene.png", AspectRatio: "9:16"}, want: "adapter"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			model := test.model
			if model.AdapterKind == "" {
				model = ydModel
			}
			called := false
			provider := newYDTestProvider(func(*http.Request) (*http.Response, error) {
				called = true
				return nil, io.ErrUnexpectedEOF
			})
			_, err := provider.Submit(context.Background(), model, test.request)
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(test.want)) {
				t.Fatalf("Submit() error = %v, want %q", err, test.want)
			}
			if called {
				t.Fatal("invalid request reached HTTP transport")
			}
		})
	}
}

func TestYDPollMapsStatusesAndFetchesResult(t *testing.T) {
	for _, test := range []struct {
		status string
		state  AsyncVideoState
	}{
		{status: "QUEUED", state: AsyncVideoRunning},
		{status: "SUBMITTED", state: AsyncVideoRunning},
		{status: "RUNNING", state: AsyncVideoRunning},
		{status: "FAILED", state: AsyncVideoFailed},
	} {
		t.Run(test.status, func(t *testing.T) {
			calls := 0
			provider := newYDTestProvider(func(request *http.Request) (*http.Response, error) {
				calls++
				if request.URL.String() != ydStatusEndpoint+"/yd-42" {
					t.Fatalf("status URL = %s", request.URL)
				}
				return jsonResponse(http.StatusOK, `{"status":"`+test.status+`","errorMessage":"  failed safely  "}`), nil
			})
			result, err := provider.Poll(context.Background(), ydModel, 17, "yd-42")
			if err != nil {
				t.Fatal(err)
			}
			if result.State != test.state || calls != 1 {
				t.Fatalf("result = %#v, calls = %d", result, calls)
			}
			if test.status == "FAILED" && result.Message != "failed safely" {
				t.Fatalf("Message = %q", result.Message)
			}
		})
	}
}

func TestYDPollUsesFirstValidURLFromURLsThenOutputs(t *testing.T) {
	for _, test := range []struct {
		name       string
		resultBody string
		wantURL    string
	}{
		{name: "urls win before outputs", resultBody: `{"urls":["http://invalid.example/clip.mp4","https://example.com/from-urls.mp4"],"outputs":[{"url":"https://example.com/from-output.mp4"}]}`, wantURL: "https://example.com/from-urls.mp4"},
		{name: "outputs when urls are absent", resultBody: `{"urls":[],"outputs":[{"url":"http://invalid.example/clip.mp4"},{"url":"https://example.com/from-output.mp4"}]}`, wantURL: "https://example.com/from-output.mp4"},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := newYDTestProvider(func(request *http.Request) (*http.Response, error) {
				if strings.HasSuffix(request.URL.Path, "/result") {
					return jsonResponse(http.StatusOK, test.resultBody), nil
				}
				return jsonResponse(http.StatusOK, `{"status":"SUCCESS"}`), nil
			})
			result, err := provider.Poll(context.Background(), ydModel, 17, "yd-42")
			if err != nil {
				t.Fatal(err)
			}
			if result.State != AsyncVideoSucceeded || result.ResultURL != test.wantURL {
				t.Fatalf("result = %#v", result)
			}
		})
	}
}

func TestYDWrapsHTTPClientCancellationErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		call func(*YD) error
	}{
		{name: "submit", call: func(provider *YD) error {
			_, err := provider.Submit(context.Background(), ydModel, models.Request{Prompt: "p", ImageURL: "https://example.com/scene.png", AspectRatio: "9:16"})
			return err
		}},
		{name: "poll", call: func(provider *YD) error {
			_, err := provider.Poll(context.Background(), ydModel, 17, "yd-42")
			return err
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := newYDTestProvider(func(*http.Request) (*http.Response, error) {
				return nil, context.DeadlineExceeded
			})
			if err := test.call(provider); !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("error = %v, want wrapped deadline exceeded", err)
			}
		})
	}
}

func TestYDValidatesResultURLWithRequestContextAndInjectedResolver(t *testing.T) {
	type contextKey struct{}
	ctx := context.WithValue(context.Background(), contextKey{}, "request-context")
	seenResultHost := false
	provider := newYDTestProvider(func(request *http.Request) (*http.Response, error) {
		if strings.HasSuffix(request.URL.Path, "/result") {
			return jsonResponse(http.StatusOK, `{"urls":["https://result.example/clip.mp4"]}`), nil
		}
		return jsonResponse(http.StatusOK, `{"status":"SUCCESS"}`), nil
	})
	provider.resolver = ydResolverFunc(func(resolverCtx context.Context, host string) ([]net.IPAddr, error) {
		if resolverCtx.Value(contextKey{}) != "request-context" {
			t.Fatal("URL validation did not receive the request context")
		}
		if host == "result.example" {
			seenResultHost = true
		}
		return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
	})

	result, err := provider.Poll(ctx, ydModel, 17, "yd-42")
	if err != nil {
		t.Fatal(err)
	}
	if !seenResultHost || result.ResultURL != "https://result.example/clip.mp4" {
		t.Fatalf("result = %#v, result URL resolver called = %t", result, seenResultHost)
	}
}

func TestYDPollRejectsUnknownMalformedHTTPAndLeakyResponses(t *testing.T) {
	tests := []struct {
		name string
		resp *http.Response
	}{
		{name: "unknown status", resp: jsonResponse(http.StatusOK, `{"status":"MYSTERY"}`)},
		{name: "malformed JSON", resp: jsonResponse(http.StatusOK, `{`)},
		{name: "non-2xx", resp: jsonResponse(http.StatusBadGateway, `provider-secret-body`)},
		{name: "oversized", resp: jsonResponse(http.StatusOK, strings.Repeat("x", maxYDReplyBytes+1))},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			provider := newYDTestProvider(func(*http.Request) (*http.Response, error) { return test.resp, nil })
			_, err := provider.Poll(context.Background(), ydModel, 17, "yd-42")
			if err == nil {
				t.Fatal("Poll() unexpectedly succeeded")
			}
			if strings.Contains(err.Error(), "provider-secret-body") || strings.Contains(err.Error(), "yd-secret") {
				t.Fatalf("Poll() leaked sensitive data: %v", err)
			}
		})
	}
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}

type ydResolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (fn ydResolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return fn(ctx, host)
}
