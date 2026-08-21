package providers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/store"
)

type imageConfigResolver struct {
	config store.ImageAPIConfig
	userID int64
}

func (r *imageConfigResolver) Get(_ context.Context, userID int64) (store.ImageAPIConfig, error) {
	r.userID = userID
	return r.config, nil
}

func TestOpenAICompatibleImageSubmitUsesOwnerConfiguration(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/images/generations" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer owner-secret" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		var body struct {
			Model  string `json:"model"`
			Prompt string `json:"prompt"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "image-model" || body.Prompt != "雨夜车站" {
			t.Fatalf("body = %#v", body)
		}
		_, _ = w.Write([]byte("{\"data\":[{\"url\":\"https://cdn.example/image.png\"}]}"))
	}))
	defer server.Close()

	resolver := &imageConfigResolver{config: store.ImageAPIConfig{
		Provider: store.OpenAICompatibleImageProvider, BaseURL: server.URL + "/v1", Model: "image-model", APIKeyCiphertext: "owner-secret",
	}}
	provider := NewOpenAICompatibleImage(server.Client(), resolver)
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }

	result, err := provider.Submit(context.Background(), models.Definition{
		Kind: models.KindImage, AdapterKind: models.AdapterAccountOpenAICompatibleImage,
	}, models.Request{OwnerID: 42, Prompt: "雨夜车站"})
	if err != nil {
		t.Fatal(err)
	}
	if result.ResultURL != "https://cdn.example/image.png" {
		t.Fatalf("result = %#v", result)
	}
	if resolver.userID != 42 {
		t.Fatalf("resolver user ID = %d", resolver.userID)
	}
}

func TestOpenAICompatibleImageSubmitAcceptsInlineBase64Image(t *testing.T) {
	image := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(image)}}})
	}))
	defer server.Close()

	provider := NewOpenAICompatibleImage(server.Client(), &imageConfigResolver{config: store.ImageAPIConfig{
		Provider: store.OpenAICompatibleImageProvider, BaseURL: server.URL, Model: "image-model", APIKeyCiphertext: "owner-secret",
	}})
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }

	result, err := provider.Submit(context.Background(), models.Definition{
		Kind: models.KindImage, AdapterKind: models.AdapterAccountOpenAICompatibleImage,
	}, models.Request{OwnerID: 42, Prompt: "雨夜车站"})
	if err != nil {
		t.Fatal(err)
	}
	if result.ResultURL != "" || string(result.ResultData) != string(image) || result.ResultContentType != "image/png" {
		t.Fatalf("result = %#v, want inline PNG image", result)
	}
}

func TestOpenAICompatibleImageDoesNotExposeCredentialOnHTTPFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("owner-secret rejected"))
	}))
	defer server.Close()

	provider := NewOpenAICompatibleImage(server.Client(), &imageConfigResolver{config: store.ImageAPIConfig{
		Provider: store.OpenAICompatibleImageProvider, BaseURL: server.URL, Model: "image-model", APIKeyCiphertext: "owner-secret",
	}})
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }

	_, err := provider.Submit(context.Background(), models.Definition{
		Kind: models.KindImage, AdapterKind: models.AdapterAccountOpenAICompatibleImage,
	}, models.Request{OwnerID: 42, Prompt: "雨夜车站"})
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") || strings.Contains(err.Error(), "owner-secret") {
		t.Fatalf("error = %v", err)
	}
}
