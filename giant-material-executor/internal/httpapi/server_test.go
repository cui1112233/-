package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"qiantie/giant-material-executor/internal/agent"
)

func TestLoopbackServerRejectsNonLoopbackBind(t *testing.T) {
	if _, err := NewServer(ServerConfig{Addr: "0.0.0.0:17861", Origin: "https://example.com", Nonce: "nonce"}); err == nil {
		t.Fatal("expected non-loopback bind rejection")
	}
}

func TestLoopbackServerRejectsUnknownOrigin(t *testing.T) {
	server, err := NewServer(ServerConfig{Addr: "127.0.0.1:17861", Origin: "https://example.com", Nonce: "nonce"})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("X-Giant-Executor-Nonce", "nonce")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHealthShowsMissingModelWithoutLeakingCredentials(t *testing.T) {
	server, err := NewServer(ServerConfig{Addr: "127.0.0.1:17861", Origin: "https://example.com", Nonce: "nonce", Version: "0.1.0", Snapshot: func() agent.Snapshot {
		return agent.Snapshot{State: agent.StateDownloadingModel, WorkerResident: true}
	}})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("Origin", "https://example.com")
	req.Header.Set("X-Giant-Executor-Nonce", "nonce")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"modelReady":false`) || !strings.Contains(body, `"state":"downloading_model"`) {
		t.Fatalf("body=%s", body)
	}
	if strings.Contains(strings.ToLower(body), "token") || strings.Contains(strings.ToLower(body), "cookie") {
		t.Fatalf("credentials leaked: %s", body)
	}
}

func TestPairingCanBootstrapNonceAndReturnsItToBrowser(t *testing.T) {
	server, err := NewServer(ServerConfig{Addr: "127.0.0.1:17861", Origin: "https://example.com", Nonce: "nonce", Callbacks: Callbacks{
		Pair: func(context.Context, string) error { return nil },
	}})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/pair", strings.NewReader(`{"code":"one-time-code"}`))
	req.Header.Set("Origin", "https://example.com")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"nonce":"nonce"`) {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}
