package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"qiantie/backend/internal/shuihuo/models"
)

func TestTextCompletionRejectsNonJSONArray(t *testing.T) {
	_, err := ParseSegmentCandidates(`{"subtitle":"not array"}`)
	if err == nil {
		t.Fatal("accepted non-array response")
	}
}

func TestTextCompletionParsesNonEmptyCandidateArray(t *testing.T) {
	candidates, err := ParseSegmentCandidates(`[{"text":"第一段"},{"text":"第二段"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 2 || candidates[0].Text != "第一段" || candidates[1].Text != "第二段" {
		t.Fatalf("candidates = %#v", candidates)
	}
}

func TestTextCompletionOpenAIChat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Fatal("missing authorization")
		}
		var body struct {
			Model       string  `json:"model"`
			Temperature float64 `json:"temperature"`
			Messages    []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "gpt-4o" || body.Temperature != 0.2 || len(body.Messages) != 1 || body.Messages[0].Role != "user" || body.Messages[0].Content != "生成候选" {
			t.Fatalf("body = %#v", body)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[]"}}]}`))
	}))
	defer server.Close()

	provider := NewTextCompletion(server.Client(), func(ref string) (string, error) { return "test-secret", nil })
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := models.Definition{AdapterKind: models.AdapterTextCompletion, Endpoint: server.URL + "/v1/", CredentialRef: "TEXT", Name: "gpt-4o"}
	result, err := provider.Complete(context.Background(), model, "生成候选")
	if err != nil {
		t.Fatal(err)
	}
	if result != "[]" {
		t.Fatalf("result = %q", result)
	}
}

func TestTextCompletionUsesKnownDisplayNameAsUpstreamModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "gpt-4o" {
			t.Fatalf("model = %q", body.Model)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[]"}}]}`))
	}))
	defer server.Close()

	provider := NewTextCompletion(server.Client(), func(ref string) (string, error) { return "test-secret", nil })
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := models.Definition{AdapterKind: models.AdapterTextCompletion, Endpoint: server.URL, CredentialRef: "TEXT", Name: "GPT-4o 文本模型"}
	if _, err := provider.Complete(context.Background(), model, "生成候选"); err != nil {
		t.Fatal(err)
	}
}

func TestTextCompletionUsesConfiguredUpstreamModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "gpt-4o" {
			t.Fatalf("model = %q", body.Model)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[]"}}]}`))
	}))
	defer server.Close()

	provider := NewTextCompletion(server.Client(), func(ref string) (string, error) { return "test-secret", nil })
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := models.Definition{AdapterKind: models.AdapterTextCompletion, Endpoint: server.URL, CredentialRef: "TEXT", Name: "显示名称", ParameterSchema: `{"upstreamModel":"gpt-4o"}`}
	if _, err := provider.Complete(context.Background(), model, "生成候选"); err != nil {
		t.Fatal(err)
	}
}

func TestTextCompletionDoesNotExposeCredentialOnHTTPFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("credential rejected"))
	}))
	defer server.Close()

	provider := NewTextCompletion(server.Client(), func(ref string) (string, error) { return "test-secret", nil })
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := models.Definition{AdapterKind: models.AdapterTextCompletion, Endpoint: server.URL, CredentialRef: "TEXT", Name: "gpt-4o"}
	_, err := provider.Complete(context.Background(), model, "生成候选")
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") || strings.Contains(err.Error(), "test-secret") {
		t.Fatalf("error = %v", err)
	}
}
