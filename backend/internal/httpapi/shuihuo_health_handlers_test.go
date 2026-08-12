package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"qiantie/backend/internal/store"
)

func TestShuihuoHealthReportsMissingRedisAndModels(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	api.deps.Health = NewShuihuoHealth(
		ShuihuoDependencyHealth{Ready: true},
		ShuihuoDependencyHealth{Reason: "Redis 未配置"},
		ShuihuoDependencyHealth{Ready: true},
		nil,
	)
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/health", "owner", true))

	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "Redis") {
		t.Fatalf("GET health = %d %s, want 503 with Redis reason", response.Code, response.Body.String())
	}
}

func TestShuihuoHealthReturnsReadyKindsWithoutRuntimeConfiguration(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	api.deps.Health = NewShuihuoHealth(
		ShuihuoDependencyHealth{Ready: true},
		ShuihuoDependencyHealth{Ready: true},
		ShuihuoDependencyHealth{Ready: true},
		[]string{"video", "text", "image"},
	)
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/health", "owner", true))

	if response.Code != http.StatusOK {
		t.Fatalf("GET health = %d %s, want 200", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode health: %v", err)
	}
	if _, found := payload["endpoint"]; found {
		t.Fatalf("health leaked an endpoint: %s", response.Body.String())
	}
}
