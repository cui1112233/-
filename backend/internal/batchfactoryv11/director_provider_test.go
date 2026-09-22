package batchfactoryv11

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAICompatibleProviderRequestsJSONObjectResponse(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		format, ok := request["response_format"].(map[string]any)
		if !ok || format["type"] != "json_object" {
			t.Fatalf("response_format=%#v, want json_object", request["response_format"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{}"}}]}`))
	}))
	defer server.Close()

	provider := OpenAICompatibleProvider{
		Endpoint: server.URL,
		APIKey:   "test-key",
		Model:    "test-model",
		Client:   server.Client(),
	}
	if _, err := provider.Complete(context.Background(), TextCompletionRequest{}); err != nil {
		t.Fatalf("complete: %v", err)
	}
}

func TestOpenAICompatibleProviderReportsTruncatedStructuredOutput(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"length","message":{"content":"{\"director_cards\":["}}]}`))
	}))
	defer server.Close()

	provider := OpenAICompatibleProvider{
		Endpoint: server.URL,
		APIKey:   "test-key",
		Model:    "test-model",
		Client:   server.Client(),
	}
	_, err := provider.Complete(context.Background(), TextCompletionRequest{})
	if err == nil || !strings.Contains(err.Error(), "finish_reason=length") {
		t.Fatalf("error=%v, want explicit truncation diagnostic", err)
	}
}
