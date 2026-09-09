package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestV11VideoModelsReturnsUnifiedCatalogWithH3(t *testing.T) {
	now := time.Unix(1700000000, 0)
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }})
	req := httptest.NewRequest(http.MethodGet, "/api/batch-factory/v11/video-models", nil)
	SignBridgeRequest(req, "alpha-user", false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, required := range []string{
		`"id":"yd2.0-mini"`,
		`"provider":"personal_api"`,
		`"id":"doubao-seedance"`,
		`"provider":"doubao_local_executor"`,
		`"id":"minimax-h3"`,
		`"label":"MiniMax H3"`,
		`"provider":"autodl_comfyui"`,
		`"maxDuration":15`,
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("missing %q in %s", required, body)
		}
	}
	lower := strings.ToLower(body)
	for _, forbidden := range []string{"lightx2v", "workflow", "token", "apikey", "authorization", "secret"} {
		if strings.Contains(lower, forbidden) {
			t.Fatalf("public catalog leaked %q: %s", forbidden, body)
		}
	}
}
