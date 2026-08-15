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
		AdapterKind:     "generic_http",
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

func TestGenericHTTPAdapterRejectsTemplateWithoutResultMapping(t *testing.T) {
	adapter := NewGenericHTTPAdapter(http.DefaultClient, func(string) (string, error) { return "", nil })
	_, err := adapter.Submit(context.Background(), Definition{
		Kind:            KindImage,
		AdapterKind:     "generic_http",
		Endpoint:        "https://models.example.com/generate",
		RequestTemplate: `{"body":{"prompt":"{{prompt}}"}}`,
		ResponseMapping: `{}`,
	}, Request{Prompt: "x"})
	if err == nil {
		t.Fatal("Submit() accepted a response mapping without resultUrl or providerTaskId")
	}
}
