package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRuntimeBuildInfoReportsInjectedReleaseSHA(t *testing.T) {
	handler := NewRouter(RouterOptions{BridgeSecret: "test-secret", ReleaseSHA: "abc123"})
	req := httptest.NewRequest(http.MethodGet, "/api/runtime-build-info", nil)
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["service"] != "go-api" || body["git_sha"] != "abc123" {
		t.Fatalf("body = %#v, want go-api with injected SHA", body)
	}
}

func TestWechatMiniProgramSessionRouteReportsExplicitUnavailableState(t *testing.T) {
	handler := NewRouter(RouterOptions{BridgeSecret: "test-secret"})
	req := httptest.NewRequest(http.MethodPost, "/api/wechat-miniprogram/session", nil)
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d when WeChat authentication is not configured", res.Code, http.StatusServiceUnavailable)
	}
}

func TestWechatMiniProgramSessionLookupRejectsMissingBearerToken(t *testing.T) {
	handler := NewRouter(RouterOptions{BridgeSecret: "test-secret"})
	req := httptest.NewRequest(http.MethodGet, "/api/wechat-miniprogram/session", nil)
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d when WeChat authentication is not configured", res.Code, http.StatusServiceUnavailable)
	}
}
